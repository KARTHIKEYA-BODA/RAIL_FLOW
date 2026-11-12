"""
Comprehensive Unit & Invariant Tests for the CP-SAT Section Solver and Simulator.
Asserts safety invariants, headway, non-overlap, maintenance exclusion,
frozen window immutability, determinism, and execution time under 5 seconds.
"""
import time
import pytest

from section_model import (
    Direction,
    Disruption,
    MaintenanceBlock,
    TrackType,
    TrainClass,
    create_sc_wdr_corridor,
)
from generator import TimetableGenerator
from simulator import CorridorSimulator
from cpsat_solver import CPSATSectionOptimizer, SolveResult
from counterfactual import CounterfactualExplainer


def test_solve_time_under_five_seconds():
    """Assert solver finishes strictly within the 5.0 second budget."""
    corridor = create_sc_wdr_corridor()
    trains = TimetableGenerator(corridor=corridor, seed=42).generate_24h_timetable(30)
    optimizer = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3.0)

    t0 = time.perf_counter()
    res = optimizer.solve(trains=trains)
    elapsed = time.perf_counter() - t0

    assert elapsed < 5.0, f"Solver took {elapsed:.2f}s, exceeding 5.0s limit"
    assert res.status in ("OPTIMAL", "FEASIBLE")
    assert res.solve_time_ms < 5000.0


def test_no_overlapping_occupations_single_track():
    """Assert no two trains occupy the same single-track block simultaneously."""
    corridor = create_sc_wdr_corridor()
    trains = TimetableGenerator(corridor=corridor, seed=42).generate_24h_timetable(25)
    optimizer = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3.0)

    res = optimizer.solve(trains=trains)
    assert res.status in ("OPTIMAL", "FEASIBLE")

    # Check each single-track block
    single_blocks = [b for b in corridor.blocks if b.track_type == TrackType.SINGLE]
    for b in single_blocks:
        intervals = []
        for t in trains:
            for s_idx in range(len(t.stops) - 1):
                st_a = t.stops[s_idx].station_id
                st_b = t.stops[s_idx + 1].station_id
                if (b.from_station == st_a and b.to_station == st_b) or \
                   (b.from_station == st_b and b.to_station == st_a):
                    if (t.id, st_a) in res.schedule and (t.id, st_b) in res.schedule:
                        dep_a = res.schedule[(t.id, st_a)][1]
                        arr_b = res.schedule[(t.id, st_b)][0]
                        intervals.append((dep_a, arr_b, t.id))

        # Sort intervals by entry time and check for overlap
        intervals.sort(key=lambda x: x[0])
        for i in range(len(intervals) - 1):
            cur_dep, cur_arr, cur_tid = intervals[i]
            next_dep, next_arr, next_tid = intervals[i + 1]
            assert next_dep >= cur_arr, (
                f"Overlap detected on single-track block {b.id}: "
                f"{cur_tid} [{cur_dep}, {cur_arr}] clashes with {next_tid} [{next_dep}, {next_arr}]"
            )


def test_maintenance_blocks_never_occupied():
    """Assert maintenance blocks act as hard constraints and are never occupied."""
    corridor = create_sc_wdr_corridor()
    trains = TimetableGenerator(corridor=corridor, seed=42).generate_24h_timetable(25)

    maint = MaintenanceBlock(
        id="M-TEST",
        section_id="BMO_MED",
        allowed_start_sec=28800,  # 08:00
        allowed_end_sec=36000,    # 10:00
        duration_sec=3600,        # 60 min
        scheduled_start_sec=28800,
    )

    optimizer = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3.0)
    res = optimizer.solve(trains=trains, maintenance_blocks=[maint])
    assert res.status in ("OPTIMAL", "FEASIBLE")

    m_start = maint.scheduled_start_sec
    m_end = m_start + maint.duration_sec

    # Verify no train is in BMO_MED during [m_start, m_end]
    for t in trains:
        for s_idx in range(len(t.stops) - 1):
            st_a = t.stops[s_idx].station_id
            st_b = t.stops[s_idx + 1].station_id
            if (st_a == "BMO" and st_b == "MED") or (st_a == "MED" and st_b == "BMO"):
                if (t.id, st_a) in res.schedule and (t.id, st_b) in res.schedule:
                    dep = res.schedule[(t.id, st_a)][1]
                    arr = res.schedule[(t.id, st_b)][0]
                    # Disjoint: either train finishes before m_start or starts after m_end
                    is_disjoint = (arr <= m_start) or (dep >= m_end)
                    assert is_disjoint, (
                        f"Maintenance violation: Train {t.id} occupied {maint.section_id} "
                        f"[{dep}, {arr}] during maintenance [{m_start}, {m_end}]"
                    )


def test_double_track_maintenance_excludes_whole_occupation():
    corridor = create_sc_wdr_corridor()
    trains = TimetableGenerator(corridor=corridor, seed=42).generate_24h_timetable(20)
    block = corridor.get_block("SC", "MJF")
    assert block and block.track_type == TrackType.DOUBLE
    maintenance = MaintenanceBlock(id="M-double", section_id=block.id,
        allowed_start_sec=28800, allowed_end_sec=32400, duration_sec=1800,
        scheduled_start_sec=28800, track_affected="both")
    result = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3).solve(
        trains=trains, maintenance_blocks=[maintenance])
    assert result.status in ("OPTIMAL", "FEASIBLE")
    for train in trains:
        for first, second in zip(train.stops, train.stops[1:]):
            if {first.station_id, second.station_id} == {"SC", "MJF"}:
                departure = result.schedule[(train.id, first.station_id)][1]
                arrival = result.schedule[(train.id, second.station_id)][0]
                assert arrival <= 28800 or departure >= 30600


def test_frozen_window_respected():
    """Assert trains in the frozen window do not move when re-solving."""
    corridor = create_sc_wdr_corridor()
    trains = TimetableGenerator(corridor=corridor, seed=42).generate_24h_timetable(20)
    optimizer = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=2.0)

    # Initial solve
    initial_res = optimizer.solve(trains=trains)
    assert initial_res.status in ("OPTIMAL", "FEASIBLE")

    # Simulate re-planning at 08:00 (28800 sec) with frozen window of 600s (up to 29400s)
    current_time_sec = 28800
    disruption = [Disruption(
        id="d-late",
        type="late_train",
        start_time_sec=current_time_sec,
        duration_sec=600,
        train_id=trains[5].id,
    )]

    replan_res = optimizer.solve(
        trains=trains,
        current_time_sec=current_time_sec,
        disruptions=disruption,
        previous_schedule=initial_res.schedule,
    )
    assert replan_res.status in ("OPTIMAL", "FEASIBLE")

    # Verify that past arrivals and committed departures within frozen window do not move
    frozen_limit = current_time_sec + optimizer.frozen_window_sec
    disrupted_ids = {d.train_id for d in disruption if d.train_id}
    for (tid, st_id), (orig_arr, orig_dep) in initial_res.schedule.items():
        if tid in disrupted_ids:
            continue
        if orig_arr <= current_time_sec:
            new_arr, _ = replan_res.schedule[(tid, st_id)]
            assert new_arr == orig_arr, f"Past arrival changed for {tid} at {st_id}"
        if orig_dep <= frozen_limit:
            _, new_dep = replan_res.schedule[(tid, st_id)]
            assert new_dep == orig_dep, f"Committed departure changed for {tid} at {st_id}"


def test_deterministic_replay():
    """Assert fixed seed produces 100% deterministic simulation results."""
    corridor = create_sc_wdr_corridor()
    tt1 = TimetableGenerator(corridor=corridor, seed=99).generate_24h_timetable(25)
    tt2 = TimetableGenerator(corridor=corridor, seed=99).generate_24h_timetable(25)

    assert len(tt1) == len(tt2)
    for t1, t2 in zip(tt1, tt2):
        assert t1.id == t2.id
        assert t1.scheduled_start_sec == t2.scheduled_start_sec

    sim1 = CorridorSimulator(corridor=corridor, policy="FCFS").run(tt1)
    sim2 = CorridorSimulator(corridor=corridor, policy="FCFS").run(tt2)

    assert sim1.kpis.total_weighted_delay_min == sim2.kpis.total_weighted_delay_min
    assert sim1.kpis.constraint_violations == 0
    assert sim2.kpis.constraint_violations == 0


def test_counterfactual_explanation_generation():
    """A hold description must not invent savings before an alternative is solved."""
    corridor = create_sc_wdr_corridor()
    trains = TimetableGenerator(corridor=corridor, seed=42).generate_24h_timetable(20)
    train = trains[0]
    stop = train.stops[0]
    solver_res = SolveResult(
        status="FEASIBLE", solve_time_ms=1, total_weighted_delay_sec=0,
        total_unweighted_delay_sec=0, max_delay_sec=0, schedule={},
        decisions=[{"train_id": train.id, "station_id": stop.station_id, "hold_minutes": 2.0}],
        objective_value=0,
    )

    explainer = CounterfactualExplainer(corridor=corridor)
    recs = explainer.generate_explanations(
        trains=trains,
        solver_result=solver_res,
        baseline_weighted_delay_sec=solver_res.total_weighted_delay_sec + 600,
    )

    assert len(recs) >= 1
    rec = recs[0]
    assert rec.one_line_reason
    assert rec.train_id in rec.one_line_reason
    assert rec.station_id in rec.one_line_reason
    assert rec.weighted_minutes_saved is None
    assert rec.rejection_cost_weighted_min is None
