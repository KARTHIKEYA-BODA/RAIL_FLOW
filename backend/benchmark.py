"""
Benchmark Harness for PS-09 Railway Brain.
Evaluates FCFS baseline, Priority Rule baseline, and CP-SAT Solver
identically across reproducible seeds and disruption scenarios.
Computes real KPIs and generates summary tables and JSON reports.
"""
import json
import hashlib
import os
import statistics
import time
from typing import Dict, List, Optional

from generator import TimetableGenerator
from section_model import (
    CorridorSection,
    Disruption,
    MaintenanceBlock,
    TrainClass,
    TrainRun,
    create_sc_wdr_corridor,
)
from simulator import CorridorSimulator, SimulationKPIs
from cpsat_solver import CPSATSectionOptimizer


def benchmark_source_fingerprint() -> str:
    digest = hashlib.sha256()
    for name in ("benchmark.py", "cpsat_solver.py", "simulator.py", "generator.py", "section_model.py"):
        with open(os.path.join(os.path.dirname(__file__), name), "rb") as source:
            digest.update(source.read())
    return digest.hexdigest()


def run_single_comparison(
    corridor: CorridorSection,
    trains: List[TrainRun],
    disruptions: Optional[List[Disruption]] = None,
    maintenance_blocks: Optional[List[MaintenanceBlock]] = None,
) -> Dict[str, SimulationKPIs]:
    """Runs FCFS, Priority Rule, and CP-SAT Solver on the identical problem instance."""
    disruptions = disruptions or []
    maintenance_blocks = maintenance_blocks or []

    # 1. FCFS Baseline
    sim_fcfs = CorridorSimulator(
        corridor=corridor,
        policy="FCFS",
        disruptions=disruptions,
        maintenance_blocks=maintenance_blocks,
    )
    res_fcfs = sim_fcfs.run(trains)

    # 2. Priority Rule Baseline
    sim_pri = CorridorSimulator(
        corridor=corridor,
        policy="PRIORITY",
        disruptions=disruptions,
        maintenance_blocks=maintenance_blocks,
    )
    res_pri = sim_pri.run(trains)
    if res_fcfs.kpis.completed_trains != len(trains) or res_pri.kpis.completed_trains != len(trains):
        raise RuntimeError("A baseline did not complete every train within the replay horizon.")

    # 3. CP-SAT Solver
    t0 = time.perf_counter()
    optimizer = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3.0)
    train_lookup = {train.id: train for train in trains}
    priority_hint = {}
    for train_id, stops in res_pri.train_trajectories.items():
        train = train_lookup[train_id]
        for index, stop in enumerate(stops):
            arrival, departure = stop["actual_arrival"], stop["actual_departure"]
            if index == 0 and departure > 0:
                # Replay introduces a train at departure; CP-SAT models its
                # minimum origin dwell before that departure.
                arrival = departure - train.stops[0].min_dwell_sec
            if arrival >= 0 and departure > 0:
                priority_hint[(train_id, stop["station_id"])] = (arrival, departure)
    solver_res = optimizer.solve(
        trains=trains,
        disruptions=disruptions,
        maintenance_blocks=maintenance_blocks,
        hint_schedule=priority_hint,
    )
    if solver_res.status not in ("OPTIMAL", "FEASIBLE"):
        raise RuntimeError(f"Solver produced no schedule: {solver_res.status}")
    solver_time_ms = (time.perf_counter() - t0) * 1000.0

    # Evaluate solver schedule through the simulator
    sim_solver = CorridorSimulator(
        corridor=corridor,
        policy="SOLVER",
        disruptions=disruptions,
        maintenance_blocks=maintenance_blocks,
        solver_schedule=solver_res.schedule,
    )
    res_solver = sim_solver.run(trains)
    if res_solver.kpis.completed_trains != len(trains):
        raise RuntimeError("Solver replay did not complete every train within the replay horizon.")
    res_solver.kpis.solve_time_ms = round(solver_time_ms, 1)
    res_solver.kpis.solver_status = solver_res.status

    return {
        "FCFS": res_fcfs.kpis,
        "PRIORITY": res_pri.kpis,
        "SOLVER": res_solver.kpis,
    }


def run_benchmark_suite(
    seeds: Optional[List[int]] = None,
    train_count: int = 30,
    output_path: Optional[str] = None,
) -> Dict:
    """
    Executes benchmark across multiple seeds and concrete disruption scenarios.
    """
    seeds = seeds or [42, 101, 2024]
    corridor = create_sc_wdr_corridor()

    scenarios = [
        ("normal", "Nominal Timetable", []),
        ("late_express", "Late Priority Express (+15m)", [
            Disruption(
                id="dis_exp",
                type="late_train",
                start_time_sec=25200,  # 07:00
                duration_sec=900,      # 15 min
                description="Late entry of morning Express 12003",
            )
        ]),
        ("loco_failure", "Locomotive Failure in Single-Track", [
            Disruption(
                id="dis_loco",
                type="loco_failure",
                start_time_sec=32400,  # 09:00
                duration_sec=1200,     # 20 min breakdown
                description="Freight loco failure in BMO-MED single-track section",
            )
        ]),
        ("signal_failure", "Signal Failure & TSR (25 km/h)", [
            Disruption(
                id="dis_sig",
                type="signal_failure",
                start_time_sec=43200,  # 12:00
                duration_sec=1800,     # 30 min caution aspect
                block_id="MED_MOB",
                additional_headway_sec=300,
                description="Signal failure at MED_MOB block",
            )
        ]),
    ]

    results_by_scenario = {}
    aggregated_kpis = {"FCFS": {}, "PRIORITY": {}, "SOLVER": {}}

    for scen_key, scen_name, disruptions in scenarios:
        scenario_runs = []
        for s in seeds:
            generator = TimetableGenerator(corridor=corridor, seed=s)
            trains = generator.generate_24h_timetable(total_trains=train_count)

            # Assign specific train_id for late_express or loco_failure if needed
            dis_instances = []
            for d in disruptions:
                target = None
                scenario_start = d.start_time_sec
                scenario_block = d.block_id
                if d.type == "late_train":
                    candidates = [t for t in trains if t.train_class == TrainClass.EXPRESS]
                    target = min(candidates or trains, key=lambda t: abs(t.scheduled_start_sec - d.start_time_sec))
                    scenario_start = target.scheduled_start_sec
                elif d.type == "loco_failure":
                    candidates = [t for t in trains if any({a.station_id, b.station_id} == {"BMO", "MED"} for a, b in zip(t.stops, t.stops[1:]))]
                    freight = [t for t in candidates if t.train_class == TrainClass.FREIGHT]
                    target = min(freight or candidates, key=lambda t: abs(t.scheduled_start_sec - d.start_time_sec))
                    scenario_block = "BMO_MED"
                    departure_stop = next(a for a, b in zip(target.stops, target.stops[1:]) if {a.station_id, b.station_id} == {"BMO", "MED"})
                    scenario_start = departure_stop.scheduled_departure_sec
                d_copy = Disruption(
                    id=d.id,
                    type=d.type,
                    start_time_sec=scenario_start,
                    duration_sec=d.duration_sec,
                    train_id=target.id if target else None,
                    block_id=scenario_block,
                    speed_restriction_kmh=d.speed_restriction_kmh,
                    additional_headway_sec=d.additional_headway_sec,
                    description=d.description,
                )
                dis_instances.append(d_copy)

            run_res = run_single_comparison(corridor, trains, dis_instances)
            scenario_runs.append({
                "seed": s,
                "FCFS": run_res["FCFS"].__dict__,
                "PRIORITY": run_res["PRIORITY"].__dict__,
                "SOLVER": run_res["SOLVER"].__dict__,
            })

        # Compute scenario averages
        def avg(policy_name: str, metric: str) -> float:
            vals = [r[policy_name][metric] for r in scenario_runs]
            return round(statistics.mean(vals), 2)

        results_by_scenario[scen_key] = {
            "name": scen_name,
            "runs": scenario_runs,
            "averages": {
                "FCFS": {
                    "weighted_delay_min": avg("FCFS", "total_weighted_delay_min"),
                    "avg_delay_min": avg("FCFS", "avg_delay_min"),
                    "delayed_over_5m": avg("FCFS", "trains_delayed_over_5m"),
                    "max_delay_min": avg("FCFS", "max_delay_min"),
                    "cascade_count": avg("FCFS", "cascade_count"),
                    "violations": avg("FCFS", "constraint_violations"),
                    "solve_time_ms": 0.0,
                },
                "PRIORITY": {
                    "weighted_delay_min": avg("PRIORITY", "total_weighted_delay_min"),
                    "avg_delay_min": avg("PRIORITY", "avg_delay_min"),
                    "delayed_over_5m": avg("PRIORITY", "trains_delayed_over_5m"),
                    "max_delay_min": avg("PRIORITY", "max_delay_min"),
                    "cascade_count": avg("PRIORITY", "cascade_count"),
                    "violations": avg("PRIORITY", "constraint_violations"),
                    "solve_time_ms": 0.0,
                },
                "SOLVER": {
                    "weighted_delay_min": avg("SOLVER", "total_weighted_delay_min"),
                    "avg_delay_min": avg("SOLVER", "avg_delay_min"),
                    "delayed_over_5m": avg("SOLVER", "trains_delayed_over_5m"),
                    "max_delay_min": avg("SOLVER", "max_delay_min"),
                    "cascade_count": avg("SOLVER", "cascade_count"),
                    "violations": avg("SOLVER", "constraint_violations"),
                    "solve_time_ms": avg("SOLVER", "solve_time_ms"),
                },
            },
        }

    # Summary report
    summary = {
        "benchmark_version": 2,
        "source_fingerprint": benchmark_source_fingerprint(),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "corridor": corridor.name,
        "trains_per_instance": train_count,
        "seeds_evaluated": seeds,
        "scenarios": results_by_scenario,
    }

    if output_path:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(summary, f, indent=2)

    return summary


if __name__ == "__main__":
    print("Running Railway Brain Benchmark Suite...")
    res = run_benchmark_suite(seeds=[42, 101], train_count=30,
                              output_path=os.path.join(os.path.dirname(__file__), "data", "benchmark_verified.json"))
    for scen_key, scen in res["scenarios"].items():
        print(f"\nScenario: {scen['name']}")
        avg = scen["averages"]
        print(f"  FCFS:     {avg['FCFS']['weighted_delay_min']} min weighted delay | {avg['FCFS']['delayed_over_5m']} delayed >5m")
        print(f"  PRIORITY: {avg['PRIORITY']['weighted_delay_min']} min weighted delay | {avg['PRIORITY']['delayed_over_5m']} delayed >5m")
        print(f"  SOLVER:   {avg['SOLVER']['weighted_delay_min']} min weighted delay | {avg['SOLVER']['delayed_over_5m']} delayed >5m | Solve time: {avg['SOLVER']['solve_time_ms']} ms")
