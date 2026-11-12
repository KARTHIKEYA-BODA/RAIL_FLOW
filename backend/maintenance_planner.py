"""
Maintenance Block Placement Optimizer for PS-09 Railway Brain.
Evaluates candidate maintenance block start times within an allowed window
as hard constraints, computes the delay cost curve, and identifies the
placement that minimizes weighted delay and throughput loss.
"""
from dataclasses import dataclass
import time
from typing import Dict, List, Optional, Tuple

from section_model import (
    BlockSection,
    CorridorSection,
    MaintenanceBlock,
    TrainRun,
    create_sc_wdr_corridor,
)
from cpsat_solver import CPSATSectionOptimizer


@dataclass
class CandidateSlotResult:
    start_sec: int
    start_time_str: str
    end_time_str: str
    weighted_delay_min: float
    unweighted_delay_min: float
    affected_trains_count: int
    is_feasible: bool


@dataclass
class MaintenancePlanResult:
    maintenance_id: str
    section_id: str
    duration_minutes: int
    allowed_window_start: str
    allowed_window_end: str
    optimal_start_sec: int
    optimal_start_time_str: str
    optimal_end_time_str: str
    optimal_weighted_delay_min: float
    next_best_start_time_str: Optional[str]
    next_best_weighted_delay_min: Optional[float]
    delay_saved_vs_next_best_min: float
    cost_curve: List[CandidateSlotResult]
    recommendation_text: str


def _sec_to_hhmm(seconds: int) -> str:
    h = (seconds // 3600) % 24
    m = (seconds % 3600) // 60
    return f"{h:02d}:{m:02d}"


class MaintenancePlanner:
    def __init__(self, corridor: Optional[CorridorSection] = None):
        self.corridor = corridor or create_sc_wdr_corridor()

    def optimize_placement(
        self,
        trains: List[TrainRun],
        maintenance: MaintenanceBlock,
        step_minutes: int = 15,
        eval_time_limit_sec: float = 1.0,
        disruptions: Optional[List] = None,
        existing_blocks: Optional[List[MaintenanceBlock]] = None,
        max_dwell_sec: Optional[Dict[Tuple[str, str], int]] = None,
    ) -> MaintenancePlanResult:
        """
        Evaluates candidate start times across the allowed window [allowed_start, allowed_end - duration]
        at `step_minutes` intervals to plot the cost curve and select the optimal slot.
        """
        candidate_slots: List[CandidateSlotResult] = []
        max_start = maintenance.allowed_end_sec - maintenance.duration_sec
        step_sec = step_minutes * 60

        # Compare all candidates against the same complete timetable.
        relevant_trains = trains

        optimizer = CPSATSectionOptimizer(corridor=self.corridor, time_limit_sec=eval_time_limit_sec)

        cur_start = maintenance.allowed_start_sec
        while cur_start <= max_start:
            candidate_m = MaintenanceBlock(
                id=maintenance.id,
                section_id=maintenance.section_id,
                allowed_start_sec=maintenance.allowed_start_sec,
                allowed_end_sec=maintenance.allowed_end_sec,
                duration_sec=maintenance.duration_sec,
                scheduled_start_sec=cur_start,
                track_affected=maintenance.track_affected,
            )

            res = optimizer.solve(
                trains=relevant_trains,
                disruptions=disruptions,
                maintenance_blocks=[*(existing_blocks or []), candidate_m],
                max_dwell_sec=max_dwell_sec,
            )

            w_del_min = round(res.total_weighted_delay_sec / 60.0, 1) if res.status in ("OPTIMAL", "FEASIBLE") else 9999.0
            unw_del_min = round(res.total_unweighted_delay_sec / 60.0, 1) if res.status in ("OPTIMAL", "FEASIBLE") else 9999.0

            # Count trains delayed > 2 min in this slot
            delayed_count = 0
            if res.status in ("OPTIMAL", "FEASIBLE"):
                for t in relevant_trains:
                    last_idx = len(t.stops) - 1
                    dest_st = t.stops[last_idx].station_id
                    if (t.id, dest_st) in res.schedule:
                        act_arr = res.schedule[(t.id, dest_st)][0]
                        sched_arr = t.stops[last_idx].scheduled_arrival_sec
                        if (act_arr - sched_arr) > 120:
                            delayed_count += 1

            candidate_slots.append(CandidateSlotResult(
                start_sec=cur_start,
                start_time_str=_sec_to_hhmm(cur_start),
                end_time_str=_sec_to_hhmm(cur_start + maintenance.duration_sec),
                weighted_delay_min=w_del_min,
                unweighted_delay_min=unw_del_min,
                affected_trains_count=delayed_count,
                is_feasible=(res.status in ("OPTIMAL", "FEASIBLE")),
            ))

            cur_start += step_sec

        # Rank feasible candidate slots by weighted delay
        feasible_slots = [s for s in candidate_slots if s.is_feasible]
        if not feasible_slots:
            raise ValueError("No feasible maintenance slot was found in the requested window.")

        sorted_slots = sorted(feasible_slots, key=lambda s: s.weighted_delay_min)
        optimal = sorted_slots[0]
        next_best = sorted_slots[1] if len(sorted_slots) > 1 else None

        saved = round((next_best.weighted_delay_min - optimal.weighted_delay_min), 1) if next_best else 0.0
        dur_min = int(round(maintenance.duration_sec / 60.0))

        if next_best:
            rec_text = (
                f"Placing {dur_min}-min maintenance on {maintenance.section_id} at {optimal.start_time_str} "
                f"costs {optimal.weighted_delay_min} weighted minutes; next-best option ({next_best.start_time_str}) "
                f"costs {next_best.weighted_delay_min} min (saves {saved} min)."
            )
        else:
            rec_text = (
                f"Placing {dur_min}-min maintenance on {maintenance.section_id} at {optimal.start_time_str} "
                f"costs {optimal.weighted_delay_min} weighted minutes."
            )

        return MaintenancePlanResult(
            maintenance_id=maintenance.id,
            section_id=maintenance.section_id,
            duration_minutes=dur_min,
            allowed_window_start=_sec_to_hhmm(maintenance.allowed_start_sec),
            allowed_window_end=_sec_to_hhmm(maintenance.allowed_end_sec),
            optimal_start_sec=optimal.start_sec,
            optimal_start_time_str=optimal.start_time_str,
            optimal_end_time_str=optimal.end_time_str,
            optimal_weighted_delay_min=optimal.weighted_delay_min,
            next_best_start_time_str=next_best.start_time_str if next_best else None,
            next_best_weighted_delay_min=next_best.weighted_delay_min if next_best else None,
            delay_saved_vs_next_best_min=saved,
            cost_curve=candidate_slots,
            recommendation_text=rec_text,
        )
