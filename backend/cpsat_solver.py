"""
Google OR-Tools CP-SAT Railway Section Optimizer for PS-09 Railway Brain.
Solves precedence, crossings, holds, and maintenance placement as hard
interval constraints within a 3-second time budget.
"""
from dataclasses import dataclass
import time
from typing import Dict, List, Optional, Set, Tuple

from ortools.sat.python import cp_model

from section_model import (
    BlockSection,
    CorridorSection,
    Direction,
    Disruption,
    MaintenanceBlock,
    StationNode,
    TrackType,
    TrainClass,
    TrainRun,
    TrainStop,
    create_sc_wdr_corridor,
)


@dataclass
class SolveResult:
    status: str  # "OPTIMAL", "FEASIBLE", "INFEASIBLE", "TIME_LIMIT"
    solve_time_ms: float
    total_weighted_delay_sec: float
    total_unweighted_delay_sec: float
    max_delay_sec: float
    schedule: Dict[Tuple[str, str], Tuple[int, int]]  # (train_id, station_id) -> (actual_arr, actual_dep)
    decisions: List[Dict]  # List of precedence, crossing, and hold recommendations
    objective_value: float


class CPSATSectionOptimizer:
    def __init__(
        self,
        corridor: Optional[CorridorSection] = None,
        time_limit_sec: float = 3.0,
        frozen_window_sec: int = 300,  # 5 minutes frozen window
    ):
        self.corridor = corridor or create_sc_wdr_corridor()
        self.time_limit_sec = time_limit_sec
        self.frozen_window_sec = frozen_window_sec

    def solve(
        self,
        trains: List[TrainRun],
        current_time_sec: int = 0,
        disruptions: Optional[List[Disruption]] = None,
        maintenance_blocks: Optional[List[MaintenanceBlock]] = None,
        previous_schedule: Optional[Dict[Tuple[str, str], Tuple[int, int]]] = None,
        fixed_overrides: Optional[Dict[str, int]] = None,
        max_dwell_sec: Optional[Dict[Tuple[str, str], int]] = None,
        hint_schedule: Optional[Dict[Tuple[str, str], Tuple[int, int]]] = None,
        blocked_platforms: Optional[Dict[str, Set[int]]] = None,
    ) -> SolveResult:
        """
        Formulates and solves the train scheduling problem using CP-SAT.
        """
        start_clock = time.perf_counter()
        disruptions = disruptions or []
        maintenance_blocks = maintenance_blocks or []
        fixed_overrides = fixed_overrides or {}

        model = cp_model.CpModel()

        # Horizon: 30 hours in seconds (to handle spillover)
        max_horizon = 108000

        # Decision variables
        # arr_vars[(train_id, stop_idx)] -> IntVar
        # dep_vars[(train_id, stop_idx)] -> IntVar
        # station_intervals[(train_id, stop_idx)] -> IntervalVar
        # block_intervals[(train_id, stop_idx)] -> IntervalVar
        arr_vars: Dict[Tuple[str, int], cp_model.IntVar] = {}
        dep_vars: Dict[Tuple[str, int], cp_model.IntVar] = {}
        station_intervals: Dict[Tuple[str, int], cp_model.IntervalVar] = {}
        block_intervals: Dict[Tuple[str, int], cp_model.IntervalVar] = {}
        block_headway_intervals: Dict[Tuple[str, int], cp_model.IntervalVar] = {}

        # 1. Create variables for each train and stop
        for t in trains:
            # Check for late start disruption
            extra_start_delay = 0
            for d in disruptions:
                if d.type == "late_train" and d.train_id == t.id:
                    extra_start_delay += d.duration_sec

            for s_idx, stop in enumerate(t.stops):
                sched_arr = stop.scheduled_arrival_sec
                sched_dep = stop.scheduled_departure_sec

                # Bounds
                min_arr = sched_arr if s_idx > 0 else (sched_dep + extra_start_delay - stop.min_dwell_sec)
                min_dep = sched_dep + extra_start_delay if s_idx == 0 else sched_dep

                arr_v = model.NewIntVar(max(0, min_arr), max_horizon, f"arr_{t.id}_{stop.station_id}")
                dep_v = model.NewIntVar(max(0, min_dep), max_horizon, f"dep_{t.id}_{stop.station_id}")

                arr_vars[(t.id, s_idx)] = arr_v
                dep_vars[(t.id, s_idx)] = dep_v

                dwell_limit = (max_dwell_sec or {}).get((t.id, stop.station_id))
                if dwell_limit is not None:
                    model.Add(dep_v - arr_v <= dwell_limit)

                # Station dwell constraint: dep >= arr + min_dwell
                dwell_dur = stop.min_dwell_sec
                station_intervals[(t.id, s_idx)] = model.NewIntervalVar(
                    arr_v, model.NewIntVar(dwell_dur, max_horizon, f"dwell_{t.id}_{s_idx}"), dep_v, f"dwell_int_{t.id}_{stop.station_id}"
                )

                # Link previous stop's departure to this stop's arrival across block section
                if s_idx > 0:
                    prev_st = t.stops[s_idx - 1].station_id
                    cur_st = stop.station_id
                    block = self.corridor.get_block(prev_st, cur_st)

                    if block:
                        # Model restrictions at actual entry time, matching replay.
                        extra_runtime = 0
                        for d in disruptions:
                            if d.type == "loco_failure" and d.train_id == t.id and (d.block_id == block.id or (not d.block_id and s_idx == 1)):
                                extra_runtime += d.duration_sec

                        min_run = block.min_runtime_sec(t.train_class) + extra_runtime
                        prev_dep = dep_vars[(t.id, s_idx - 1)]
                        model.Add(arr_v >= prev_dep + min_run)
                        signal_headways = []
                        for d_idx, d in enumerate(disruptions):
                            if d.type not in ("speed_restriction", "signal_failure") or d.block_id != block.id or d.duration_sec <= 0:
                                continue
                            before = model.NewBoolVar(f"before_{t.id}_{s_idx}_{d_idx}")
                            during = model.NewBoolVar(f"during_{t.id}_{s_idx}_{d_idx}")
                            after = model.NewBoolVar(f"after_{t.id}_{s_idx}_{d_idx}")
                            model.AddExactlyOne(before, during, after)
                            model.Add(prev_dep < d.start_time_sec).OnlyEnforceIf(before)
                            model.Add(prev_dep >= d.start_time_sec).OnlyEnforceIf(during)
                            model.Add(prev_dep < d.start_time_sec + d.duration_sec).OnlyEnforceIf(during)
                            model.Add(prev_dep >= d.start_time_sec + d.duration_sec).OnlyEnforceIf(after)
                            speed = d.speed_restriction_kmh if d.type == "speed_restriction" else 25.0
                            restricted_run = block.min_runtime_sec(t.train_class, speed_restriction_kmh=speed) + extra_runtime
                            model.Add(arr_v >= prev_dep + restricted_run).OnlyEnforceIf(during)
                            if d.type == "signal_failure":
                                signal_headways.append((during, d.additional_headway_sec or 300))

                        # Create block occupancy interval
                        dur_var = model.NewIntVar(min_run, max_horizon, f"blk_dur_{t.id}_{block.id}")
                        model.Add(arr_v - prev_dep == dur_var)
                        b_interval = model.NewIntervalVar(prev_dep, dur_var, arr_v, f"blk_int_{t.id}_{block.id}")
                        block_intervals[(t.id, s_idx - 1)] = b_interval

                        # Headway interval for double track
                        headway_sec = block.default_headway_sec
                        headway = model.NewIntVar(headway_sec, headway_sec + sum(amount for _, amount in signal_headways), f"headway_{t.id}_{s_idx}")
                        model.Add(headway == headway_sec + sum(active * amount for active, amount in signal_headways))
                        headway_end = model.NewIntVar(0, max_horizon + headway_sec + sum(amount for _, amount in signal_headways), f"hw_end_{t.id}_{s_idx}")
                        hw_int = model.NewIntervalVar(prev_dep, headway, headway_end, f"hw_int_{t.id}_{block.id}")
                        block_headway_intervals[(t.id, s_idx - 1)] = hw_int

        # 2. Hard Constraints: Single-Track Block No-Overlap
        for block in self.corridor.blocks:
            if block.track_type == TrackType.SINGLE:
                single_track_intervals = []
                for t in trains:
                    for s_idx in range(len(t.stops) - 1):
                        st_a = t.stops[s_idx].station_id
                        st_b = t.stops[s_idx + 1].station_id
                        if (block.from_station == st_a and block.to_station == st_b) or \
                           (block.from_station == st_b and block.to_station == st_a):
                            if (t.id, s_idx) in block_intervals:
                                single_track_intervals.append(block_intervals[(t.id, s_idx)])

                # Add maintenance block interval if placed on this single-track section
                for m in maintenance_blocks:
                    if m.section_id == block.id and m.scheduled_start_sec is not None:
                        m_int = model.NewIntervalVar(
                            m.scheduled_start_sec,
                            m.duration_sec,
                            m.scheduled_start_sec + m.duration_sec,
                            f"maint_{m.id}_{block.id}",
                        )
                        single_track_intervals.append(m_int)

                if len(single_track_intervals) > 1:
                    model.AddNoOverlap(single_track_intervals)

            elif block.track_type == TrackType.DOUBLE:
                # Double track: headway separation for trains traveling in the same direction
                for d_dir in (Direction.UP, Direction.DOWN):
                    dir_hw_intervals = []
                    dir_occupancy_intervals = []
                    maintenance_intervals = []
                    for t in trains:
                        if t.direction != d_dir:
                            continue
                        for s_idx in range(len(t.stops) - 1):
                            st_a = t.stops[s_idx].station_id
                            st_b = t.stops[s_idx + 1].station_id
                            if (block.from_station == st_a and block.to_station == st_b) or \
                               (block.from_station == st_b and block.to_station == st_a):
                                if (t.id, s_idx) in block_headway_intervals:
                                    dir_hw_intervals.append(block_headway_intervals[(t.id, s_idx)])
                                    dir_occupancy_intervals.append(block_intervals[(t.id, s_idx)])

                    # Maintenance on double track
                    for m in maintenance_blocks:
                        if m.section_id == block.id and m.scheduled_start_sec is not None:
                            if m.track_affected in ("both", d_dir.value):
                                m_int = model.NewIntervalVar(
                                    m.scheduled_start_sec,
                                    m.duration_sec,
                                    m.scheduled_start_sec + m.duration_sec,
                                    f"maint_{m.id}_{block.id}_{d_dir.value}",
                                )
                                dir_hw_intervals.append(m_int)
                                maintenance_intervals.append(m_int)

                    if len(dir_hw_intervals) > 1:
                        model.AddNoOverlap(dir_hw_intervals)
                    # Trains may overlap on double track, but none may occupy it
                    # during a possession. Pairwise constraints avoid imposing
                    # single-track separation between trains in the same direction.
                    for maintenance_interval in maintenance_intervals:
                        for interval in dir_occupancy_intervals:
                            model.AddNoOverlap([interval, maintenance_interval])

        # 3. Station Capacity Constraints
        for st_node in self.corridor.stations:
            st_intervals = []
            for t in trains:
                for s_idx, stop in enumerate(t.stops):
                    if stop.station_id == st_node.id:
                        if (t.id, s_idx) in station_intervals:
                            st_intervals.append(station_intervals[(t.id, s_idx)])

            if st_intervals:
                # Cumulative constraint: capacity = platforms + passing loops minus blocked platforms
                blocked_count = len(blocked_platforms.get(st_node.id, set())) if blocked_platforms else 0
                effective_cap = max(1, st_node.total_capacity - blocked_count)
                model.AddCumulative(st_intervals, [1] * len(st_intervals), effective_cap)

        # 4. Frozen Window Constraints (Committed Movements)
        if current_time_sec > 0 and previous_schedule:
            frozen_limit = current_time_sec + self.frozen_window_sec
            disrupted_train_ids = {d.train_id for d in disruptions if d.train_id}
            for t in trains:
                if t.id in disrupted_train_ids:
                    continue  # The disrupted train itself is being rescheduled
                for s_idx, stop in enumerate(t.stops):
                    key = (t.id, stop.station_id)
                    if key in previous_schedule:
                        prev_arr, prev_dep = previous_schedule[key]
                        if prev_arr <= current_time_sec:
                            model.Add(arr_vars[(t.id, s_idx)] == prev_arr)
                        if prev_dep <= frozen_limit:
                            model.Add(dep_vars[(t.id, s_idx)] == prev_dep)

        # 5. Objective Function: Minimize Total Weighted Delay + Regularization
        # delay_i = max(0, arr_dest - sched_arr_dest)
        delay_terms = []
        hold_terms = []
        stability_terms = []

        for t in trains:
            last_idx = len(t.stops) - 1
            dest_stop = t.stops[last_idx]
            arr_dest = arr_vars[(t.id, last_idx)]
            sched_dest = dest_stop.scheduled_arrival_sec

            # delay_var >= arr_dest - sched_dest, delay_var >= 0
            delay_var = model.NewIntVar(0, max_horizon, f"delay_{t.id}")
            model.Add(delay_var >= arr_dest - sched_dest)

            # Integer scaling: scale weight by 10
            int_weight = int(round(t.weight * 10))
            delay_terms.append(delay_var * int_weight)

            # Hold minimization: keep holds minimal unless needed for crossing/precedence
            for s_idx in range(len(t.stops)):
                dwell_v = dep_vars[(t.id, s_idx)] - arr_vars[(t.id, s_idx)]
                hold_v = model.NewIntVar(0, max_horizon, f"hold_{t.id}_{s_idx}")
                model.Add(hold_v >= dwell_v - t.stops[s_idx].min_dwell_sec)
                hold_terms.append(hold_v)

            # Stability: minimize deviation from previous plan if available
            if previous_schedule:
                for s_idx, stop in enumerate(t.stops):
                    key = (t.id, stop.station_id)
                    if key in previous_schedule:
                        prev_arr, _ = previous_schedule[key]
                        diff_v = model.NewIntVar(0, max_horizon, f"diff_{t.id}_{s_idx}")
                        model.Add(diff_v >= arr_vars[(t.id, s_idx)] - prev_arr)
                        model.Add(diff_v >= prev_arr - arr_vars[(t.id, s_idx)])
                        stability_terms.append(diff_v)

        # Weighted destination delay is the benchmark objective. During a
        # replan, stability remains a secondary operational consideration.
        total_obj = sum(delay_terms)
        if stability_terms:
            total_obj += sum(stability_terms)

        model.Minimize(total_obj)

        # Warm start / Hinting from previous schedule or priority simulation
        hints = previous_schedule or hint_schedule
        if hints:
            for t in trains:
                for s_idx, stop in enumerate(t.stops):
                    key = (t.id, stop.station_id)
                    if key in hints:
                        prev_arr, prev_dep = hints[key]
                        model.AddHint(arr_vars[(t.id, s_idx)], prev_arr)
                        model.AddHint(dep_vars[(t.id, s_idx)], prev_dep)

        # Configure Solver
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.time_limit_sec
        solver.parameters.num_workers = 4
        solver.parameters.log_search_progress = False

        status_code = solver.Solve(model)
        elapsed_ms = (time.perf_counter() - start_clock) * 1000.0

        status_map = {
            cp_model.OPTIMAL: "OPTIMAL",
            cp_model.FEASIBLE: "FEASIBLE",
            cp_model.INFEASIBLE: "INFEASIBLE",
            cp_model.MODEL_INVALID: "MODEL_INVALID",
            cp_model.UNKNOWN: "TIME_LIMIT",
        }
        res_status = status_map.get(status_code, "UNKNOWN")

        # Extract solution
        result_schedule: Dict[Tuple[str, str], Tuple[int, int]] = {}
        total_weighted_sec = 0.0
        total_unweighted_sec = 0.0
        max_del_sec = 0.0
        decisions: List[Dict] = []

        if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            for t in trains:
                last_idx = len(t.stops) - 1
                for s_idx, stop in enumerate(t.stops):
                    act_arr = int(solver.Value(arr_vars[(t.id, s_idx)]))
                    act_dep = int(solver.Value(dep_vars[(t.id, s_idx)]))
                    result_schedule[(t.id, stop.station_id)] = (act_arr, act_dep)

                    # Identify intentional holds (hold > 60s above min dwell)
                    dwell = act_dep - act_arr
                    if dwell > stop.min_dwell_sec + 60:
                        hold_sec = dwell - stop.min_dwell_sec
                        decisions.append({
                            "type": "HOLD",
                            "train_id": t.id,
                            "train_name": t.name,
                            "station_id": stop.station_id,
                            "hold_minutes": round(hold_sec / 60.0, 1),
                            "scheduled_dep": stop.scheduled_departure_sec,
                            "recommended_dep": act_dep,
                        })

                # End delay
                dest_arr = int(solver.Value(arr_vars[(t.id, last_idx)]))
                sched_arr = t.stops[last_idx].scheduled_arrival_sec
                del_sec = max(0, dest_arr - sched_arr)
                total_unweighted_sec += del_sec
                total_weighted_sec += del_sec * t.weight
                max_del_sec = max(max_del_sec, del_sec)

        return SolveResult(
            status=res_status,
            solve_time_ms=round(elapsed_ms, 1),
            total_weighted_delay_sec=round(total_weighted_sec, 1),
            total_unweighted_delay_sec=round(total_unweighted_sec, 1),
            max_delay_sec=round(max_del_sec, 1),
            schedule=result_schedule,
            decisions=decisions,
            objective_value=solver.ObjectiveValue() if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE) else float("inf"),
        )
