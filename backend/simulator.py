"""
Discrete-Event Railway Corridor Simulator for PS-09 Railway Brain.
Simulates train movements across block sections and stations under
FCFS, Priority-Rule, or Solver-planned dispatching policies.
Computes standard KPIs and supports event replay.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple
import heapq

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


class EventType(str, Enum):
    TRAIN_APPEAR = "TRAIN_APPEAR"
    READY_TO_DEPART = "READY_TO_DEPART"
    ENTER_BLOCK = "ENTER_BLOCK"
    EXIT_BLOCK_ARRIVE_STATION = "EXIT_BLOCK_ARRIVE_STATION"
    LOCO_REPAIRED = "LOCO_REPAIRED"


@dataclass(order=True)
class SimEvent:
    time_sec: int
    priority: int = field(init=False, compare=True)
    event_type: EventType = field(compare=False)
    train_id: str = field(compare=False)
    stop_idx: int = field(compare=False, default=0)
    extra: Dict = field(compare=False, default_factory=dict)

    def __post_init__(self):
        # Release the block before processing entries at the same instant.
        self.priority = 0 if self.event_type == EventType.EXIT_BLOCK_ARRIVE_STATION else 1


@dataclass
class TrainSimState:
    train_id: str
    run: TrainRun
    current_stop_idx: int = 0
    actual_arrivals: List[int] = field(default_factory=list)
    actual_departures: List[int] = field(default_factory=list)
    status: str = "SCHEDULED"  # SCHEDULED, AT_STATION, IN_BLOCK, DELAYED, FINISHED
    current_station: Optional[str] = None
    current_block: Optional[str] = None
    is_broken_down: bool = False


@dataclass
class SimulationKPIs:
    policy: str
    total_trains: int
    completed_trains: int
    total_weighted_delay_min: float
    total_unweighted_delay_min: float
    avg_delay_min: float
    trains_delayed_over_5m: int
    max_delay_min: float
    cascade_count: int
    throughput_per_hour: float
    constraint_violations: int
    solve_time_ms: float = 0.0
    solver_status: Optional[str] = None


@dataclass
class SimulationResult:
    policy: str
    kpis: SimulationKPIs
    train_trajectories: Dict[str, List[Dict]]  # station_id, arr_sec, dep_sec
    events_log: List[Dict]
    violations: List[str]


class CorridorSimulator:
    def __init__(
        self,
        corridor: Optional[CorridorSection] = None,
        policy: str = "FCFS",  # "FCFS", "PRIORITY", "SOLVER"
        disruptions: Optional[List[Disruption]] = None,
        maintenance_blocks: Optional[List[MaintenanceBlock]] = None,
        solver_schedule: Optional[Dict[Tuple[str, str], Tuple[int, int]]] = None, # (train_id, station_id) -> (arr, dep)
    ):
        self.corridor = corridor or create_sc_wdr_corridor()
        self.policy = policy.upper()
        self.disruptions = disruptions or []
        self.maintenance_blocks = maintenance_blocks or []
        self.solver_schedule = solver_schedule or {}

    def run(self, trains: List[TrainRun], end_time_sec: int = 108000) -> SimulationResult:
        """
        Executes the discrete-event simulation up to `end_time_sec`.
        """
        event_queue: List[SimEvent] = []
        train_states: Dict[str, TrainSimState] = {}
        events_log: List[Dict] = []
        violations: List[str] = []

        # Resources occupancy tracking
        # station_id -> list of train_ids currently occupying platform/loop
        station_occupancy: Dict[str, Set[str]] = {s.id: set() for s in self.corridor.stations}
        station_reservations: Dict[str, Set[str]] = {s.id: set() for s in self.corridor.stations}
        # block_id -> list of train_ids currently in block
        block_occupancy: Dict[str, List[str]] = {b.id: [] for b in self.corridor.blocks}
        # track last entry time for headway: (block_id, direction) -> last_time_sec
        block_last_entry: Dict[Tuple[str, Direction], int] = {}
        block_last_headway: Dict[Tuple[str, Direction], int] = {}

        # Waiting queues for blocks: block_id -> list of train_ids
        block_waiting: Dict[str, List[str]] = {b.id: [] for b in self.corridor.blocks}

        # Initialize trains
        for t in trains:
            state = TrainSimState(
                train_id=t.id,
                run=t,
                actual_arrivals=[0] * len(t.stops),
                actual_departures=[0] * len(t.stops),
            )
            train_states[t.id] = state

            # Check if train has a late start disruption
            start_time = t.stops[0].scheduled_departure_sec
            for d in self.disruptions:
                if d.type == "late_train" and d.train_id == t.id:
                    start_time += d.duration_sec

            heapq.heappush(event_queue, SimEvent(
                time_sec=start_time,
                event_type=EventType.TRAIN_APPEAR,
                train_id=t.id,
                stop_idx=0,
            ))

        sim_time = 0

        while event_queue:
            ev = heapq.heappop(event_queue)
            sim_time = ev.time_sec
            if sim_time > end_time_sec:
                break

            train = train_states[ev.train_id]
            run = train.run

            if ev.event_type == EventType.TRAIN_APPEAR:
                # Train appears at origin station
                orig_station = run.stops[0].station_id
                origin = self.corridor.get_station(orig_station)
                if origin and len(station_occupancy[orig_station]) + len(station_reservations[orig_station]) >= origin.total_capacity:
                    heapq.heappush(event_queue, SimEvent(time_sec=sim_time + 30,
                        event_type=EventType.TRAIN_APPEAR, train_id=train.train_id, stop_idx=0))
                    continue
                train.current_station = orig_station
                train.status = "AT_STATION"
                station_occupancy[orig_station].add(train.train_id)
                train.actual_arrivals[0] = ev.time_sec

                # Ready to depart immediately or after scheduled departure
                dep_target = max(ev.time_sec, run.stops[0].scheduled_departure_sec)
                heapq.heappush(event_queue, SimEvent(
                    time_sec=dep_target,
                    event_type=EventType.READY_TO_DEPART,
                    train_id=train.train_id,
                    stop_idx=0,
                ))

                events_log.append({
                    "time": sim_time,
                    "event": "APPEAR",
                    "train_id": train.train_id,
                    "station": orig_station,
                })

            elif ev.event_type == EventType.READY_TO_DEPART:
                stop_idx = ev.stop_idx
                cur_st = run.stops[stop_idx].station_id

                if stop_idx >= len(run.stops) - 1:
                    # Train completed run at destination
                    train.actual_departures[stop_idx] = ev.time_sec
                    train.status = "FINISHED"
                    station_occupancy[cur_st].discard(train.train_id)
                    events_log.append({
                        "time": sim_time,
                        "event": "FINISHED",
                        "train_id": train.train_id,
                        "station": cur_st,
                    })
                    continue

                next_st = run.stops[stop_idx + 1].station_id
                block = self.corridor.get_block(cur_st, next_st)
                if not block:
                    violations.append(f"No block between {cur_st} and {next_st}")
                    continue

                # Check if train can enter block according to dispatch policy & constraints
                can_enter, reason = self._can_enter_block(
                    train=train,
                    block=block,
                    current_time=sim_time,
                    block_occupancy=block_occupancy,
                    block_last_entry=block_last_entry,
                    block_last_headway=block_last_headway,
                    station_occupancy=station_occupancy,
                    station_reservations=station_reservations,
                    next_station_id=next_st,
                    train_states=train_states,
                )

                if can_enter:
                    # Check if queue has higher priority train waiting under priority rule
                    if self.policy == "PRIORITY" and block_waiting[block.id]:
                        # Evaluate if any waiting train has higher priority
                        waiting_trains = [train_states[tid] for tid in block_waiting[block.id]]
                        higher_pri = [wt for wt in waiting_trains if wt.run.weight > train.run.weight]
                        if higher_pri:
                            # Higher priority train should go first
                            if train.train_id not in block_waiting[block.id]:
                                block_waiting[block.id].append(train.train_id)
                            # Retry after 30 seconds
                            heapq.heappush(event_queue, SimEvent(
                                time_sec=sim_time + 30,
                                event_type=EventType.READY_TO_DEPART,
                                train_id=train.train_id,
                                stop_idx=stop_idx,
                            ))
                            continue

                    # If solver schedule is provided, follow solver departure recommendation
                    if self.policy == "SOLVER" and (train.train_id, cur_st) in self.solver_schedule:
                        planned_dep = self.solver_schedule[(train.train_id, cur_st)][1]
                        if sim_time < planned_dep:
                            # Hold train until planned departure
                            heapq.heappush(event_queue, SimEvent(
                                time_sec=planned_dep,
                                event_type=EventType.READY_TO_DEPART,
                                train_id=train.train_id,
                                stop_idx=stop_idx,
                            ))
                            continue

                    # Grant access to block
                    if train.train_id in block_waiting[block.id]:
                        block_waiting[block.id].remove(train.train_id)

                    train.actual_departures[stop_idx] = sim_time
                    station_occupancy[cur_st].discard(train.train_id)
                    station_reservations[next_st].add(train.train_id)
                    block_occupancy[block.id].append(train.train_id)
                    block_last_entry[(block.id, run.direction)] = sim_time
                    headway = block.default_headway_sec
                    for disruption in self.disruptions:
                        if disruption.type == "signal_failure" and disruption.block_id == block.id and disruption.start_time_sec <= sim_time < disruption.start_time_sec + disruption.duration_sec:
                            headway += disruption.additional_headway_sec or 300
                    block_last_headway[(block.id, run.direction)] = headway
                    train.status = "IN_BLOCK"
                    train.current_block = block.id
                    train.current_station = None

                    runtime = self._block_runtime(train, block, sim_time, stop_idx)
                    arr_next_time = max(sim_time + runtime, run.stops[stop_idx + 1].scheduled_arrival_sec)

                    heapq.heappush(event_queue, SimEvent(
                        time_sec=arr_next_time,
                        event_type=EventType.EXIT_BLOCK_ARRIVE_STATION,
                        train_id=train.train_id,
                        stop_idx=stop_idx + 1,
                    ))

                    events_log.append({
                        "time": sim_time,
                        "event": "DEPART",
                        "train_id": train.train_id,
                        "from_station": cur_st,
                        "block": block.id,
                        "runtime_sec": runtime,
                    })
                else:
                    # Cannot enter block now (resource busy or headway)
                    if train.train_id not in block_waiting[block.id]:
                        block_waiting[block.id].append(train.train_id)
                    # Retry in 30 seconds
                    heapq.heappush(event_queue, SimEvent(
                        time_sec=sim_time + 30,
                        event_type=EventType.READY_TO_DEPART,
                        train_id=train.train_id,
                        stop_idx=stop_idx,
                    ))

            elif ev.event_type == EventType.EXIT_BLOCK_ARRIVE_STATION:
                stop_idx = ev.stop_idx
                arr_st = run.stops[stop_idx].station_id
                prev_st = run.stops[stop_idx - 1].station_id
                block = self.corridor.get_block(prev_st, arr_st)

                # A platform can fill while this train is travelling. Keep the
                # train in the block until a berth is actually available.
                destination = self.corridor.get_station(arr_st)
                if destination and len(station_occupancy[arr_st]) >= destination.total_capacity:
                    heapq.heappush(event_queue, SimEvent(time_sec=sim_time + 30,
                        event_type=EventType.EXIT_BLOCK_ARRIVE_STATION,
                        train_id=train.train_id, stop_idx=stop_idx))
                    continue

                station_reservations[arr_st].discard(train.train_id)

                if block and train.train_id in block_occupancy[block.id]:
                    block_occupancy[block.id].remove(train.train_id)

                train.status = "AT_STATION"
                train.current_block = None
                train.current_station = arr_st
                train.actual_arrivals[stop_idx] = sim_time
                station_occupancy[arr_st].add(train.train_id)

                events_log.append({
                    "time": sim_time,
                    "event": "ARRIVE",
                    "train_id": train.train_id,
                    "station": arr_st,
                })

                # Schedule next departure
                min_dwell = run.stops[stop_idx].min_dwell_sec
                sched_dep = run.stops[stop_idx].scheduled_departure_sec
                ready_time = max(sim_time + min_dwell, sched_dep)

                heapq.heappush(event_queue, SimEvent(
                    time_sec=ready_time,
                    event_type=EventType.READY_TO_DEPART,
                    train_id=train.train_id,
                    stop_idx=stop_idx,
                ))

        # Compute KPIs
        kpis = self._compute_kpis(train_states, violations)

        trajectories = {}
        for tid, state in train_states.items():
            trajectories[tid] = [
                {
                    "station_id": state.run.stops[i].station_id,
                    "scheduled_arrival": state.run.stops[i].scheduled_arrival_sec,
                    "scheduled_departure": state.run.stops[i].scheduled_departure_sec,
                    "actual_arrival": state.actual_arrivals[i],
                    "actual_departure": state.actual_departures[i],
                }
                for i in range(len(state.run.stops))
            ]

        return SimulationResult(
            policy=self.policy,
            kpis=kpis,
            train_trajectories=trajectories,
            events_log=events_log,
            violations=violations,
        )

    def _block_runtime(self, train: TrainSimState, block: BlockSection, departure: int, stop_idx: int) -> int:
        speed_restriction = None
        extra_delay = 0
        for disruption in self.disruptions:
            if disruption.block_id == block.id and disruption.start_time_sec <= departure < disruption.start_time_sec + disruption.duration_sec:
                if disruption.type == "speed_restriction":
                    candidate = disruption.speed_restriction_kmh
                    if candidate is not None:
                        speed_restriction = min(speed_restriction, candidate) if speed_restriction is not None else candidate
                elif disruption.type == "signal_failure":
                    speed_restriction = min(speed_restriction, 25.0) if speed_restriction is not None else 25.0
            if disruption.type == "loco_failure" and disruption.train_id == train.train_id and (disruption.block_id == block.id or (not disruption.block_id and stop_idx == 0)):
                extra_delay += disruption.duration_sec
        return block.min_runtime_sec(train.run.train_class, speed_restriction_kmh=speed_restriction) + extra_delay

    def _can_enter_block(
        self,
        train: TrainSimState,
        block: BlockSection,
        current_time: int,
        block_occupancy: Dict[str, List[str]],
        block_last_entry: Dict[Tuple[str, Direction], int],
        block_last_headway: Dict[Tuple[str, Direction], int],
        station_occupancy: Dict[str, Set[str]],
        station_reservations: Dict[str, Set[str]],
        next_station_id: str,
        train_states: Dict[str, TrainSimState],
    ) -> Tuple[bool, str]:
        """Validates all physical constraints for entering a block section."""
        # 1. Maintenance block constraint
        for m in self.maintenance_blocks:
            if m.section_id == block.id and m.scheduled_start_sec is not None:
                m_start = m.scheduled_start_sec
                m_end = m_start + m.duration_sec
                affects_direction = block.track_type == TrackType.SINGLE or m.track_affected in ("both", train.run.direction.value)
                stop_idx = next(i for i, stop in enumerate(train.run.stops) if stop.station_id == train.current_station)
                exit_time = max(current_time + self._block_runtime(train, block, current_time, stop_idx), train.run.stops[stop_idx + 1].scheduled_arrival_sec)
                if affects_direction and current_time < m_end and exit_time > m_start:
                    return False, "Train would occupy the section during maintenance"

        # 2. Next station capacity constraint (avoid gridlock)
        next_st = self.corridor.get_station(next_station_id)
        if next_st:
            current_st_trains = len(station_occupancy[next_station_id]) + len(station_reservations[next_station_id])
            if current_st_trains >= next_st.total_capacity:
                return False, f"Station {next_station_id} is at full capacity"

        # 3. Single-track safety: NO opposing trains allowed!
        if block.track_type == TrackType.SINGLE:
            occupants = block_occupancy[block.id]
            if occupants:
                # Any occupant in single track means block is busy
                return False, "Single track block occupied"

        # 4. Double-track headway constraint
        if block.track_type == TrackType.DOUBLE:
            key = (block.id, train.run.direction)
            last_entry = block_last_entry.get(key)
            headway = block_last_headway.get(key, block.default_headway_sec)
            if last_entry is not None and current_time < last_entry + headway:
                return False, f"Headway separation: must wait {last_entry + headway - current_time}s"

        return True, "OK"

    def _compute_kpis(self, train_states: Dict[str, TrainSimState], violations: List[str]) -> SimulationKPIs:
        total_trains = len(train_states)
        completed = 0
        total_weighted_delay_sec = 0.0
        total_delay_sec = 0.0
        delayed_over_5m = 0
        max_delay_sec = 0.0
        cascade_count = 0

        for state in train_states.values():
            if state.status == "FINISHED":
                completed += 1

            # End-to-end arrival delay at last station
            last_idx = len(state.run.stops) - 1
            sched_arr = state.run.stops[last_idx].scheduled_arrival_sec
            act_arr = state.actual_arrivals[last_idx]

            if act_arr > 0:
                delay = max(0, act_arr - sched_arr)
            else:
                delay = 0

            delay_min = delay / 60.0
            if delay_min > 5.0:
                delayed_over_5m += 1
            if delay_min > 2.0:
                cascade_count += 1

            max_delay_sec = max(max_delay_sec, delay)
            total_delay_sec += delay
            total_weighted_delay_sec += delay * state.run.weight

        hours = 24.0
        throughput = completed / hours if hours > 0 else 0.0
        avg_delay = (total_delay_sec / 60.0) / max(1, completed)

        return SimulationKPIs(
            policy=self.policy,
            total_trains=total_trains,
            completed_trains=completed,
            total_weighted_delay_min=round(total_weighted_delay_sec / 60.0, 2),
            total_unweighted_delay_min=round(total_delay_sec / 60.0, 2),
            avg_delay_min=round(avg_delay, 2),
            trains_delayed_over_5m=delayed_over_5m,
            max_delay_min=round(max_delay_sec / 60.0, 2),
            cascade_count=cascade_count,
            throughput_per_hour=round(throughput, 2),
            constraint_violations=len(violations),
        )
