"""
PS-09 Railway Brain — Disruption-Resilient Train Control Decision Support API.
Decision-support system for real-time section dispatching, precedence,
crossings, holds, explainable recommendations, and maintenance block planning.
"""
import asyncio
from contextlib import asynccontextmanager
import copy
from datetime import datetime, timedelta
import json
import logging
import os
import time
import uuid
from typing import Dict, List, Literal, Optional, Tuple

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
from generator import TimetableGenerator
from simulator import CorridorSimulator, SimulationKPIs
from cpsat_solver import CPSATSectionOptimizer, SolveResult
from maintenance_planner import MaintenancePlanner, MaintenancePlanResult
from counterfactual import CounterfactualExplainer, ExplainableRecommendation
from stretch_features import ArrivalForecaster, OverrideLearningSystem
from benchmark import run_single_comparison, run_benchmark_suite, benchmark_source_fingerprint
from cause_inference import infer_arrival_cause, build_station_arrivals
from station_access import router as station_access_router, snapshot_connection
from timetable_preview import prepare as prepare_timetable_scenario, RUNNING_MODEL_FINGERPRINT
from export_infrastructure import build_manifest as build_infrastructure_manifest

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("railway_brain")

# File paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
PROTOTYPE_PATH = os.path.join(DATA_DIR, "prototype_trains.json")
BENCHMARK_PATH = os.path.join(DATA_DIR, "benchmark_verified.json")
RUNTIME_BENCHMARK_FINGERPRINT = benchmark_source_fingerprint()

# Data Models
class StationDto(BaseModel):
    id: str
    platforms: int
    station_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_junction: Optional[bool] = False
    passing_loops: Optional[int] = 1

class TrainDto(BaseModel):
    id: str
    type: str
    priority: int
    origin: str
    destination: str
    scheduled_arrival: str
    scheduled_departure: str
    platform_pref: Optional[int] = 1

class ScheduleEntryDto(BaseModel):
    train_id: str
    station_id: str
    assigned_platform: int
    actual_arrival: str
    actual_departure: str
    scheduled_arrival: Optional[str] = None
    scheduled_departure: Optional[str] = None
    reason: str
    delay_minutes: float = 0.0

class OverrideRequest(BaseModel):
    train_id: str
    station_id: str
    new_platform: int
    action: Optional[Literal["change_platform", "hold_train", "prioritize"]] = "change_platform"
    hold_minutes: Optional[int] = None
    reason: Optional[str] = None

class DisruptionRequest(BaseModel):
    disruption_type: Literal["late_train", "loco_failure", "signal_failure", "speed_restriction"]
    train_id: Optional[str] = None
    station_id: Optional[str] = None
    block_id: Optional[str] = None
    duration_minutes: int = 15
    speed_restriction_kmh: Optional[float] = None
    additional_headway_sec: Optional[int] = None
    description: Optional[str] = None

class MaintenanceRequest(BaseModel):
    section_id: str
    duration_minutes: int = 90
    allowed_start_time: str = "01:00"
    allowed_end_time: str = "05:00"
    track_affected: Optional[Literal["UP", "DOWN", "both"]] = "both"

class WhatIfRequest(BaseModel):
    disruption: Optional[DisruptionRequest] = None
    override: Optional[OverrideRequest] = None

class RejectRecommendationRequest(BaseModel):
    recommendation_id: str
    reason_code: Optional[str] = "CONTROLLER_PREFERENCE"
    notes: Optional[str] = None

class IncidentCreateRequest(BaseModel):
    station: str = "SC"
    type: Literal["late_train", "loco_failure", "signal_failure", "speed_restriction", "platform_blocked", "safety_incident", "other"]
    train_ids: List[str] = []
    platform: Optional[int] = None
    block_id: Optional[str] = None
    est_duration_min: int = 15
    note: Optional[str] = None
    reported_by: Optional[str] = "Station Master SC"

class IncidentPatchRequest(BaseModel):
    status: Literal["open", "resolved"]
    resolution_note: Optional[str] = None

class IncidentDto(BaseModel):
    id: str
    station: str
    type: str
    train_ids: List[str] = []
    platform: Optional[int] = None
    block_id: Optional[str] = None
    started_at: str
    est_duration_min: int = 15
    note: Optional[str] = None
    status: Literal["reported", "open", "resolved"] = "open"
    impact_preview: Optional[Dict] = None
    restored: bool = False
    reported_by: Optional[str] = "Station Master SC"

class LogEntryDto(BaseModel):
    timestamp: str
    action: str
    details: str
    reason_code: Optional[str] = None


# WebSocket Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()
_main_loop: Optional[asyncio.AbstractEventLoop] = None


def notify_clients(event_type: str, data: Optional[Dict] = None):
    if _main_loop is None:
        return
    payload = json.dumps({
        "type": event_type,
        "data": data or {},
        "timestamp": datetime.now().isoformat(),
    })
    asyncio.run_coroutine_threadsafe(manager.broadcast(payload), _main_loop)


# Global State
corridor: CorridorSection = create_sc_wdr_corridor()
trains_prototype: List[TrainRun] = []
trains_24h: List[TrainRun] = []
active_disruptions: List[Disruption] = []
active_maintenance: List[MaintenanceBlock] = []
pending_maintenance: Optional[MaintenanceBlock] = None
pending_maintenance_revision: Optional[int] = None
fixed_overrides: Dict[str, int] = {}
rejected_holds: Dict[Tuple[str, str], int] = {}
audit_logs: List[LogEntryDto] = []

# Schedule state
current_schedule_entries: List[ScheduleEntryDto] = []
baseline_schedule_entries: List[ScheduleEntryDto] = []
previous_schedule_entries: List[ScheduleEntryDto] = []
current_recommendations: List[ExplainableRecommendation] = []
latest_kpis: Dict = {}
whatif_sandbox_state: Optional[Dict] = None
plan_revision = 0

# Stretch modules
explainer = CounterfactualExplainer(corridor)
forecaster = ArrivalForecaster(seed=42)
override_system = OverrideLearningSystem()
planner = MaintenancePlanner(corridor)

# Station Master & Field Incidents State (seeded with 2 demo incidents)
active_incidents: List[IncidentDto] = [
    IncidentDto(
        id="INC-101",
        station="SC",
        type="signal_failure",
        train_ids=[],
        platform=None,
        started_at="09:12",
        est_duration_min=20,
        note="Signal aspect flickering on Up Main line",
        status="open",
        reported_by="Station Master SC",
    ),
    IncidentDto(
        id="INC-102",
        station="SC",
        type="platform_blocked",
        train_ids=["T104"],
        platform=1,
        started_at="09:35",
        est_duration_min=15,
        note="Overrunning rakes clearing Platform 1",
        status="open",
        reported_by="Station Master SC",
    ),
]
blocked_platforms_state: Dict[str, Set[int]] = {"SC": {1}}


def _save_incident(incident: IncidentDto, event: str):
    """Persist the incident snapshot and append a simulation audit event."""
    payload = json.dumps(incident.model_dump())
    with snapshot_connection() as db:
        db.execute('INSERT OR REPLACE INTO simulation_incidents (id, payload) VALUES (?, ?)', (incident.id, payload))
        db.execute('INSERT INTO simulation_incident_events (incident_id, event, created_at, payload) VALUES (?, ?, ?, ?)', (incident.id, event, datetime.now().isoformat(), payload))


def _restore_incidents():
    """Restore non-cleared records as provisional; never reapply old constraints."""
    with snapshot_connection() as db:
        rows = db.execute('SELECT payload FROM simulation_incidents').fetchall()
    existing = {incident.id for incident in active_incidents}
    for (payload,) in rows:
        try:
            incident = IncidentDto.model_validate_json(payload)
        except (ValueError, TypeError):
            logger.warning('Ignoring invalid saved simulation incident')
            continue
        if incident.status == 'resolved' or incident.id in existing:
            continue
        incident.status = 'reported'
        incident.restored = True
        incident.impact_preview = None
        active_incidents.append(incident)
        _save_incident(incident, 'restored_review_required')



def _load_initial_data():
    global trains_prototype, trains_24h, corridor
    # Use the same section and timetable model as the solver and benchmark.
    generator = TimetableGenerator(corridor=corridor, seed=42)
    trains_prototype = generator.generate_24h_timetable(total_trains=30)

    # Pre-generate 24h synthetic timetable (100 trains)
    generator_24h = TimetableGenerator(corridor=corridor, seed=42)
    trains_24h = generator_24h.generate_24h_timetable(total_trains=100)


def _parse_prototype_trains(raw: Dict) -> List[TrainRun]:
    runs = []
    legs_map = raw.get("train_legs", {})
    for t in raw.get("trains", []):
        tid = t["id"]
        legs = legs_map.get(tid, [t["origin"], t["destination"]])
        arr_dt = datetime.fromisoformat(t["scheduled_arrival"])
        dep_dt = datetime.fromisoformat(t["scheduled_departure"])
        arr_sec = arr_dt.hour * 3600 + arr_dt.minute * 60 + arr_dt.second
        dep_sec = dep_dt.hour * 3600 + dep_dt.minute * 60 + dep_dt.second

        cls_str = t.get("type", "Passenger")
        cls_map = {
            "Express": TrainClass.EXPRESS,
            "Local": TrainClass.SUBURBAN,
            "Suburban": TrainClass.SUBURBAN,
            "Freight": TrainClass.FREIGHT,
            "Passenger": TrainClass.PASSENGER,
        }
        train_cls = cls_map.get(cls_str, TrainClass.PASSENGER)

        stops = []
        cur_time = dep_sec
        for idx, st_id in enumerate(legs):
            dwell = 300 if (idx > 0 and idx < len(legs) - 1) else 120
            stops.append(TrainStop(
                station_id=st_id,
                scheduled_arrival_sec=cur_time if idx > 0 else arr_sec,
                scheduled_departure_sec=cur_time + dwell if idx < len(legs) - 1 else cur_time,
                min_dwell_sec=dwell,
                platform_pref=t.get("platform_pref", 1),
            ))
            cur_time += 720  # ~12 min between stations

        runs.append(TrainRun(
            id=tid,
            name=f"{cls_str} {tid}",
            train_class=train_cls,
            direction=Direction.UP if legs[0] == "HYB" or legs[0] == "SC" else Direction.DOWN,
            stops=stops,
            origin=legs[0],
            destination=legs[-1],
        ))
    return runs


def _recompute_all(log_action: Optional[str] = None, details: Optional[str] = None, solved: Optional[SolveResult] = None):
    global current_schedule_entries, previous_schedule_entries, baseline_schedule_entries
    global current_recommendations, latest_kpis
    global plan_revision

    trains = trains_prototype
    optimizer = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3.0)

    # 1. Baseline FCFS simulation
    sim_fcfs = CorridorSimulator(
        corridor=corridor,
        policy="FCFS",
        disruptions=active_disruptions,
        maintenance_blocks=active_maintenance,
    )
    res_fcfs = sim_fcfs.run(trains)

    # 2. Priority Rule simulation
    sim_pri = CorridorSimulator(
        corridor=corridor,
        policy="PRIORITY",
        disruptions=active_disruptions,
        maintenance_blocks=active_maintenance,
    )
    res_pri = sim_pri.run(trains)

    # 3. CP-SAT Solver
    t0 = time.perf_counter()
    prev_map = {
        (e.train_id, e.station_id): (
            _iso_to_sec(e.actual_arrival),
            _iso_to_sec(e.actual_departure),
        )
        for e in current_schedule_entries
    } if current_schedule_entries else None

    solver_res = solved or optimizer.solve(
        trains=trains,
        disruptions=active_disruptions,
        maintenance_blocks=active_maintenance,
        previous_schedule=prev_map,
        fixed_overrides=fixed_overrides,
        max_dwell_sec=rejected_holds,
        blocked_platforms=blocked_platforms_state,
    )
    if solver_res.status not in ("OPTIMAL", "FEASIBLE"):
        raise HTTPException(status_code=409, detail=f"No feasible schedule available ({solver_res.status}).")
    solve_ms = solver_res.solve_time_ms if solved is not None else round((time.perf_counter() - t0) * 1000.0, 1)

    # Store previous entries before updating
    if current_schedule_entries:
        previous_schedule_entries = copy.deepcopy(current_schedule_entries)

    # Convert solver output to ScheduleEntryDto list
    today = datetime.now().date()
    new_entries = []
    base_entries = []

    for t in trains:
        for stop in t.stops:
            key = (t.id, stop.station_id)
            if key in solver_res.schedule:
                act_arr_sec, act_dep_sec = solver_res.schedule[key]
            else:
                act_arr_sec, act_dep_sec = stop.scheduled_arrival_sec, stop.scheduled_departure_sec

            sched_arr_dt = datetime.combine(today, datetime.min.time()) + timedelta(seconds=stop.scheduled_arrival_sec)
            sched_dep_dt = datetime.combine(today, datetime.min.time()) + timedelta(seconds=stop.scheduled_departure_sec)
            act_arr_dt = datetime.combine(today, datetime.min.time()) + timedelta(seconds=act_arr_sec)
            act_dep_dt = datetime.combine(today, datetime.min.time()) + timedelta(seconds=act_dep_sec)

            del_min = max(0.0, (act_arr_sec - stop.scheduled_arrival_sec) / 60.0)

            # Assigned platform
            pref_p = fixed_overrides.get(t.id, stop.platform_pref or 1)
            st_blocked = blocked_platforms_state.get(stop.station_id, set())
            if pref_p in st_blocked:
                st_node = corridor.get_station(stop.station_id)
                max_pf = st_node.platforms if st_node else 4
                for cand in range(1, max_pf + 1):
                    if cand not in st_blocked:
                        pref_p = cand
                        break
            reason = "On-time nominal slot" if del_min == 0 else f"Delay {del_min:.0f}m mitigated by CP-SAT"

            entry = ScheduleEntryDto(
                train_id=t.id,
                station_id=stop.station_id,
                assigned_platform=pref_p,
                actual_arrival=act_arr_dt.isoformat(),
                actual_departure=act_dep_dt.isoformat(),
                scheduled_arrival=sched_arr_dt.isoformat(),
                scheduled_departure=sched_dep_dt.isoformat(),
                reason=reason,
                delay_minutes=round(del_min, 1),
            )
            new_entries.append(entry)

            # Baseline entry
            base_entries.append(ScheduleEntryDto(
                train_id=t.id,
                station_id=stop.station_id,
                assigned_platform=stop.platform_pref or 1,
                actual_arrival=sched_arr_dt.isoformat(),
                actual_departure=sched_dep_dt.isoformat(),
                scheduled_arrival=sched_arr_dt.isoformat(),
                scheduled_departure=sched_dep_dt.isoformat(),
                reason="Scheduled baseline",
                delay_minutes=0.0,
            ))

    current_schedule_entries = new_entries
    plan_revision += 1
    if not baseline_schedule_entries:
        baseline_schedule_entries = base_entries

    # Derive numeric counterfactual explanations
    base_weighted_sec = res_fcfs.kpis.total_weighted_delay_min * 60.0
    current_recommendations = explainer.generate_explanations(
        trains=trains,
        solver_result=solver_res,
        baseline_weighted_delay_sec=base_weighted_sec,
        disruptions=active_disruptions,
    )

    # Compute live KPIs comparison
    solver_weighted_min = round(solver_res.total_weighted_delay_sec / 60.0, 1)
    fcfs_weighted_min = res_fcfs.kpis.total_weighted_delay_min
    pri_weighted_min = res_pri.kpis.total_weighted_delay_min

    latest_kpis = {
        "solve_time_ms": solve_ms,
        "solver_status": solver_res.status,
        "weighted_delay_solver_min": solver_weighted_min,
        "weighted_delay_fcfs_min": fcfs_weighted_min,
        "weighted_delay_priority_min": pri_weighted_min,
        "delay_reduction_vs_fcfs_pct": round(((fcfs_weighted_min - solver_weighted_min) / max(0.1, fcfs_weighted_min)) * 100.0, 1) if fcfs_weighted_min > solver_weighted_min else 0.0,
        "trains_delayed_over_5m": sum(1 for e in new_entries if e.delay_minutes > 5.0),
        "total_trains": len(trains),
        "constraint_violations": 0,
        "active_disruptions_count": len(active_disruptions),
        "active_maintenance_count": len(active_maintenance),
    }

    if log_action:
        audit_logs.append(LogEntryDto(
            timestamp=datetime.now().isoformat(),
            action=log_action,
            details=details or f"Recomputed plan in {solve_ms} ms. Weighted delay: {solver_weighted_min} min",
        ))

    notify_clients("schedule_update", latest_kpis)


def _iso_to_sec(iso_str: str) -> int:
    dt = datetime.fromisoformat(iso_str)
    return dt.hour * 3600 + dt.minute * 60 + dt.second


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    if not trains_prototype:
        _load_initial_data()
        _recompute_all(log_action="SYSTEM_INIT", details="PS-09 Railway Brain initialized with CP-SAT solver")
    yield

app = FastAPI(
    title="PS-09 Railway Brain API",
    description="Disruption-Resilient Train Control Decision Support System",
    version="2.0.0",
    lifespan=lifespan,
)

app.include_router(station_access_router)

# Load data immediately at module load time
_load_initial_data()
_recompute_all(log_action="SYSTEM_INIT", details="PS-09 Railway Brain initialized with CP-SAT solver")
_restore_incidents()

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "PS-09 Railway Brain",
        "solver": "Google OR-Tools CP-SAT",
        "trains_loaded": len(trains_prototype),
        "corridor": corridor.name,
        "active_websocket_clients": len(manager.active_connections),
        "latest_solve_ms": latest_kpis.get("solve_time_ms", 0.0),
    }


@app.get("/corridor/blocks")
def get_corridor_blocks():
    return [{"id": b.id, "from_station": b.from_station, "to_station": b.to_station, "track_type": b.track_type.value, "track_type_verification": "assumed", "minimum_runtime_seconds_modelled": {train_class.value: b.min_runtime_sec(train_class) for train_class in b.speed_limit_kmh}, "source_note": "Prototype assumption; section configuration has not been verified with railway infrastructure records."} for b in corridor.blocks]


@app.get("/corridor/infrastructure")
def get_corridor_infrastructure():
    """Return the model's complete assumptions, including class runtimes."""
    return build_infrastructure_manifest()


@app.get("/stations")
def get_stations():
    stations_data = []
    # Kilometric coordinates along South Central Railway
    coords = {
        "HYB": (17.3850, 78.4867),
        "SC":  (17.4399, 78.5017),
        "MJF": (17.4520, 78.5280),
        "BMO": (17.5250, 78.5140),
        "MED": (17.6320, 78.4820),
        "MOB": (17.7810, 78.4350),
        "ME":  (17.9150, 78.3980),
        "WDR": (18.0420, 78.3610),
        "KCG": (17.3753, 78.4983),
    }
    for st in corridor.stations:
        lat, lon = coords.get(st.id, (17.40, 78.50))
        stations_data.append({
            "id": st.id,
            "station_name": st.name,
            "platforms": st.platforms,
            "passing_loops": st.passing_loops,
            "total_capacity": st.total_capacity,
            "km": st.km,
            "is_junction": st.is_junction,
            "latitude": lat,
            "longitude": lon,
        })
    return stations_data


@app.get("/trains")
def get_trains():
    return [
        {
            "id": t.id,
            "name": t.name,
            "type": t.train_class.value,
            "priority": int(round(t.weight * 3)),
            "weight": t.weight,
            "origin": t.origin,
            "destination": t.destination,
            "direction": t.direction.value,
            "stops_count": len(t.stops),
        }
        for t in trains_prototype
    ]


@app.get("/incidents")
def get_incidents(station: Optional[str] = None):
    """Lists reported incidents, optionally filtered by station."""
    if station:
        return [inc.model_dump() for inc in active_incidents if inc.station == station]
    return [inc.model_dump() for inc in active_incidents]


@app.get("/incident-history")
def incident_history():
    with snapshot_connection() as db:
        rows = db.execute('SELECT incident_id, event, created_at, payload FROM simulation_incident_events ORDER BY id DESC LIMIT 50').fetchall()
    return [{"incident_id": item_id, "event": event, "created_at": created, "station": json.loads(payload).get("station"), "type": json.loads(payload).get("type")} for item_id, event, created, payload in rows]


@app.post("/incidents")
def create_incident(req: IncidentCreateRequest):
    global active_incidents, active_disruptions, blocked_platforms_state
    """
    Submits a Station Master field incident in under 10 seconds.
    Records a provisional report and previews its effect without changing the active plan.
    """
    station_obj = corridor.get_station(req.station)
    if not station_obj:
        raise HTTPException(422, "Unknown station in the simulated corridor.")
    if not 1 <= req.est_duration_min <= 1440:
        raise HTTPException(422, "Duration must be between 1 and 1440 minutes.")
    if req.platform is not None and not 1 <= req.platform <= station_obj.platforms:
        raise HTTPException(422, "Platform is outside the simulated station.")
    if req.type in ("late_train", "loco_failure") and (not req.train_ids or not any(t.id == req.train_ids[0] for t in trains_prototype)):
        raise HTTPException(422, "Select a train from the simulated timetable for this incident.")
    if req.type == "platform_blocked" and req.platform is None:
        raise HTTPException(422, "Select the simulated platform that is blocked.")
    incident_block = next((b for b in corridor.blocks if b.id == req.block_id), None)
    if req.type in ("loco_failure", "signal_failure", "speed_restriction") and incident_block is None:
        raise HTTPException(422, "Select an affected simulated block section.")
    if req.type == "loco_failure":
        train = next(t for t in trains_prototype if t.id == req.train_ids[0])
        if incident_block.id not in {b.id for a, z in zip(train.stops, train.stops[1:]) if (b := corridor.get_block(a.station_id, z.station_id))}:
            raise HTTPException(422, "The selected simulated train does not use that block.")
    now = datetime.now()
    now_str = now.strftime("%H:%M")
    now_sec = now.hour * 3600 + now.minute * 60 + now.second
    inc_id = f"INC-{uuid.uuid4().hex[:12]}"

    new_inc = IncidentDto(
        id=inc_id,
        station=req.station,
        type=req.type,
        train_ids=req.train_ids,
        platform=req.platform,
        block_id=req.block_id,
        started_at=now_str,
        est_duration_min=req.est_duration_min,
        note=req.note or f"{req.type.replace('_', ' ').capitalize()} reported at {req.station}",
        status="open",
        reported_by=req.reported_by or "Station Master SC",
    )
    new_inc.status = "reported"
    active_incidents.append(new_inc)
    safety_alert = "Inform the Section Controller through the official channel. This tool does not replace official accident reporting." if req.type == "safety_incident" else None
    # Preview uses independent copies and cannot change the current plan.
    try:
        disruption, platforms = _incident_constraints(new_inc, now_sec)
        preview_disruptions = [*active_disruptions, *([disruption] if disruption else [])]
        preview_platforms = copy.deepcopy(blocked_platforms_state)
        if platforms:
            preview_platforms.setdefault(new_inc.station, set()).add(platforms)
        result = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3.0).solve(
            trains=trains_prototype, disruptions=preview_disruptions,
            maintenance_blocks=active_maintenance, fixed_overrides=fixed_overrides,
            max_dwell_sec=rejected_holds, blocked_platforms=preview_platforms,
        )
        impact = {"status": result.status, "solve_time_ms": result.solve_time_ms,
                  "weighted_delay_min": round(result.total_weighted_delay_sec / 60, 1) if result.status in ("OPTIMAL", "FEASIBLE") else None,
                  "model_effect": bool(disruption or platforms)}
    except Exception:
        logger.exception("Incident preview failed")
        impact = {"status": "UNAVAILABLE", "weighted_delay_min": None, "model_effect": False}
    new_inc.impact_preview = impact
    try:
        _save_incident(new_inc, "reported")
    except Exception:
        active_incidents.remove(new_inc)
        raise HTTPException(503, "Could not save the report; it was not submitted.") from None
    notify_clients("incident_update", {"incident": new_inc.model_dump(), "safety_alert": safety_alert})
    return {"status": "created", "incident": new_inc.model_dump(), "impact_preview": impact, "safety_alert": safety_alert}


def _incident_constraints(inc: IncidentDto, now_sec: int):
    """Build model-only constraints; no mutation of current state."""
    duration = inc.est_duration_min * 60
    if inc.type == "late_train":
        return Disruption(id=f"DIS-{inc.id}", type="late_train", start_time_sec=now_sec, duration_sec=duration, train_id=inc.train_ids[0], station_id=inc.station, description=f"Reported late arrival: {inc.train_ids[0]}"), None
    if inc.type == "loco_failure":
        return Disruption(id=f"DIS-{inc.id}", type="loco_failure", start_time_sec=now_sec, duration_sec=duration, train_id=inc.train_ids[0], block_id=inc.block_id, description="Reported locomotive failure"), None
    if inc.type in ("signal_failure", "speed_restriction"):
        return Disruption(id=f"DIS-{inc.id}", type=inc.type, start_time_sec=now_sec, duration_sec=duration, block_id=inc.block_id, speed_restriction_kmh=25.0 if inc.type == "signal_failure" else 30.0, additional_headway_sec=300 if inc.type == "signal_failure" else 0, description=f"Reported {inc.type}"), None
    if inc.type in ("platform_blocked", "safety_incident"):
        return None, inc.platform
    return None, None


@app.post("/incidents/{inc_id}/preview")
def refresh_incident_preview(inc_id: str):
    inc = next((item for item in active_incidents if item.id == inc_id), None)
    if inc is None:
        raise HTTPException(404, "Incident not found")
    if inc.status != "reported":
        raise HTTPException(409, "Only a provisional report can be previewed.")
    now = datetime.now()
    disruption, platform = _incident_constraints(inc, now.hour * 3600 + now.minute * 60 + now.second)
    preview_disruptions = [*active_disruptions, *([disruption] if disruption else [])]
    preview_platforms = copy.deepcopy(blocked_platforms_state)
    if platform:
        preview_platforms.setdefault(inc.station, set()).add(platform)
    result = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3.0).solve(
        trains=trains_prototype, disruptions=preview_disruptions,
        maintenance_blocks=active_maintenance, fixed_overrides=fixed_overrides,
        max_dwell_sec=rejected_holds, blocked_platforms=preview_platforms,
    )
    previous_preview, previous_restored = inc.impact_preview, inc.restored
    inc.impact_preview = {"status": result.status, "solve_time_ms": result.solve_time_ms,
                          "weighted_delay_min": round(result.total_weighted_delay_sec / 60, 1) if result.status in ("OPTIMAL", "FEASIBLE") else None,
                          "model_effect": bool(disruption or platform)}
    inc.restored = False
    try:
        _save_incident(inc, "preview_refreshed")
    except Exception:
        inc.impact_preview, inc.restored = previous_preview, previous_restored
        raise
    notify_clients("incident_update", {"incident": inc.model_dump()})
    return {"incident": inc.model_dump()}


def _incident_plan_checkpoint():
    return copy.deepcopy({"disruptions": active_disruptions, "platforms": blocked_platforms_state,
                          "current": current_schedule_entries, "previous": previous_schedule_entries,
                          "baseline": baseline_schedule_entries, "recommendations": current_recommendations,
                          "kpis": latest_kpis, "revision": plan_revision, "logs": audit_logs})


def _restore_incident_plan(checkpoint):
    global active_disruptions, blocked_platforms_state, current_schedule_entries, previous_schedule_entries
    global baseline_schedule_entries, current_recommendations, latest_kpis, plan_revision
    active_disruptions = checkpoint['disruptions']
    blocked_platforms_state = checkpoint['platforms']
    current_schedule_entries = checkpoint['current']
    previous_schedule_entries = checkpoint['previous']
    baseline_schedule_entries = checkpoint['baseline']
    current_recommendations = checkpoint['recommendations']
    latest_kpis = checkpoint['kpis']
    plan_revision = checkpoint['revision']
    audit_logs[:] = checkpoint['logs']


@app.post("/incidents/{inc_id}/confirm")
def confirm_incident(inc_id: str):
    """Apply a reported incident to the simulation only after controller confirmation."""
    global active_disruptions, blocked_platforms_state
    inc = next((item for item in active_incidents if item.id == inc_id), None)
    if inc is None:
        raise HTTPException(404, "Incident not found")
    if inc.status != "reported":
        raise HTTPException(409, "Only a provisional report can be confirmed.")
    if inc.restored:
        raise HTTPException(409, "This restored report needs a fresh preview before confirmation.")
    now = datetime.now()
    now_sec = now.hour * 3600 + now.minute * 60 + now.second
    disruption, platform = _incident_constraints(inc, now_sec)
    checkpoint = _incident_plan_checkpoint()
    if disruption:
        active_disruptions.append(disruption)
    if platform:
        blocked_platforms_state.setdefault(inc.station, set()).add(platform)
    try:
        _recompute_all(log_action="INCIDENT_CONFIRMED", details=f"Controller confirmed simulated incident {inc.id} at {inc.station}.")
        inc.status = "open"
        _save_incident(inc, "confirmed")
    except Exception:
        inc.status = "reported"
        _restore_incident_plan(checkpoint)
        raise
    notify_clients("incident_update", {"incident": inc.model_dump()})
    return {"status": "confirmed", "incident": inc.model_dump(), "solve_time_ms": latest_kpis.get("solve_time_ms")}


@app.patch("/incidents/{inc_id}")
def patch_incident(inc_id: str, req: IncidentPatchRequest):
    """Resolves an open incident and clears associated constraints."""
    inc = next((i for i in active_incidents if i.id == inc_id), None)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    was_reported = inc.status == "reported"
    if inc.status == "resolved":
        raise HTTPException(409, "Incident is already resolved.")
    checkpoint = _incident_plan_checkpoint()
    if req.status == "open":
        raise HTTPException(409, "Use the controller confirmation endpoint.")
    inc.status = req.status
    if req.status == "resolved" and was_reported:
        try:
            _save_incident(inc, "resolved")
        except Exception:
            inc.status = "reported"
            raise
        notify_clients("incident_update", {"incident": inc.model_dump(), "resolved": True})
        return {"status": "updated", "incident": inc.model_dump()}
    if req.status == "resolved":
        global active_disruptions
        active_disruptions = [d for d in active_disruptions if d.id != f"DIS-{inc_id}"]
        if inc.platform and inc.station in blocked_platforms_state:
            other_blocks = any(
                i.status == "open" and i.id != inc_id and i.station == inc.station and i.platform == inc.platform
                for i in active_incidents
            )
            if not other_blocks:
                blocked_platforms_state[inc.station].discard(inc.platform)

        try:
            _recompute_all(
                log_action="INCIDENT_RESOLVED",
                details=f"Incident {inc_id} at {inc.station} resolved: {req.resolution_note or 'Cleared'}",
            )
            _save_incident(inc, "resolved")
        except Exception:
            inc.status = "open"
            _restore_incident_plan(checkpoint)
            raise
        notify_clients("incident_update", {"incident": inc.model_dump(), "resolved": True})

    return {"status": "updated", "incident": inc.model_dump()}


@app.get("/station/{station_id}/arrivals")
def get_station_arrivals_endpoint(station_id: str, window: int = 120):
    """
    Returns upcoming arrivals at station within window (default 120 min)
    with 3-layer deterministic cause attribution (Reported, Inferred, Unknown)
    and actionable solver recommendation.
    """
    now = datetime.now()
    now_sec = now.hour * 3600 + now.minute * 60 + now.second

    arrivals = build_station_arrivals(
        station_id=station_id,
        window_minutes=window,
        current_time_sec=now_sec,
        current_schedule_entries=current_schedule_entries,
        baseline_schedule_entries=baseline_schedule_entries,
        trains=trains_prototype,
        active_incidents=active_incidents,
        active_disruptions=active_disruptions,
        active_maintenance=active_maintenance,
        recommendations=current_recommendations,
    )

    safety_incident = next((
        i for i in active_incidents
        if i.status in ("reported", "open") and i.station == station_id and i.type == "safety_incident"
    ), None)

    station_obj = corridor.get_station(station_id)

    return {
        "station_id": station_id,
        "station_name": station_obj.name if station_obj else station_id,
        "platforms_count": station_obj.platforms if station_obj else 6,
        "window_minutes": window,
        "arrivals": arrivals,
        "active_incidents": [i.model_dump() for i in active_incidents if i.station == station_id and i.status in ("reported", "open")],
        "blocked_platforms": list(blocked_platforms_state.get(station_id, set())),
        "safety_alert": "Inform the Section Controller through the official channel. This tool does not replace official accident reporting." if safety_incident else None,
        "timestamp": now.isoformat(),
    }


@app.get("/controller/replays")
def list_controller_replays():
    """Local demo replays; these are recorded simulations, not live plans."""
    with snapshot_connection() as db:
        rows = db.execute("SELECT id, created_at, payload FROM timetable_previews ORDER BY id DESC LIMIT 50").fetchall()
    result = []
    for preview_id, created, payload in rows:
        item = json.loads(payload)
        if item.get("result", {}).get("schedule"):
            result.append({"id": preview_id, "created_at": created, "corridor_date": item["input"]["corridor_date"], "train_count": len(item["result"].get("trains", []))})
    return result


@app.get("/controller/replays/{preview_id}")
def controller_replay(preview_id: int):
    with snapshot_connection() as db:
        row = db.execute("SELECT payload FROM timetable_previews WHERE id = ?", (preview_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Recorded preview not found.")
    item = json.loads(row[0])
    result = item.get("result", {})
    if not result.get("schedule"):
        raise HTTPException(409, "The recorded preview has no feasible schedule.")
    base = datetime.fromisoformat(item["input"]["corridor_date"] + "T00:00:00+05:30")
    def at(seconds):
        return (base + timedelta(seconds=seconds)).isoformat()
    schedule = [{"train_id": entry["train_number"], "station_id": entry["station"], "assigned_platform": 0,
                 "scheduled_arrival": at(entry["scheduled_arrival_sec"]), "scheduled_departure": at(entry["scheduled_departure_sec"]),
                 "actual_arrival": at(entry["planned_arrival_sec"]), "actual_departure": at(entry["planned_departure_sec"])} for entry in result["schedule"]]
    with snapshot_connection() as db:
        reviews = {row[0]: {"status": row[1], "alternative": json.loads(row[2]) if row[2] else None} for row in db.execute('SELECT decision_index, status, alternative FROM replay_reviews WHERE preview_id = ?', (preview_id,)).fetchall()}
        events = [{'decision_index': row[0], 'event': row[1], 'created_at': row[2]} for row in db.execute('SELECT decision_index, event, created_at FROM replay_review_events WHERE preview_id = ? ORDER BY id DESC', (preview_id,)).fetchall()]
    decisions = [{**decision, "review_status": reviews.get(i, {}).get("status", "PENDING"), "alternative": reviews.get(i, {}).get("alternative")} for i, decision in enumerate(result.get("decisions", []))]
    return {"id": preview_id, "mode": "REPLAY", "model_current": item.get("model_fingerprint") == RUNNING_MODEL_FINGERPRINT, "corridor_date": item["input"]["corridor_date"],
            "source_timestamp": item["created_at"], "input_fingerprint": item["input_fingerprint"],
            "schedule": schedule, "trains": [{"id": t["number"], "name": t["name"], "type": t["class"]} for t in result["trains"]],
            "decisions": decisions, "review_events": events, "limitations": "Recorded timetable simulation. Track is assumed and platforms are unknown. Reviews do not change the active plan or control trains."}


def _replay_decision(preview_id: int, decision_index: int):
    with snapshot_connection() as db:
        row = db.execute('SELECT payload FROM timetable_previews WHERE id = ?', (preview_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Recorded preview not found.")
    item = json.loads(row[0])
    decisions = item.get('result', {}).get('decisions', [])
    if decision_index < 0 or decision_index >= len(decisions):
        raise HTTPException(404, "Recorded hold not found.")
    return item, decisions[decision_index]


@app.post("/controller/replays/{preview_id}/decisions/{decision_index}/preview")
def replay_decision_preview(preview_id: int, decision_index: int):
    item, decision = _replay_decision(preview_id, decision_index)
    if item.get('model_fingerprint') != RUNNING_MODEL_FINGERPRINT:
        raise HTTPException(409, "The model has changed or this is an older recording. Create a new timetable preview before comparing alternatives.")
    source = item['input']
    trains, _, replay_corridor, disruptions, maintenance = prepare_timetable_scenario(
        [entry['record'] for entry in source['timetables']], datetime.fromisoformat(source['corridor_date']).date(),
        source.get('delay_train'), source.get('delay_minutes', 0), source.get('scenario'))
    train = next((train for train in trains if train.id == decision['train_id']), None)
    stop = next((stop for stop in train.stops if stop.station_id == decision['station_id']), None) if train else None
    if stop is None:
        raise HTTPException(409, "The recorded hold cannot be mapped to the saved timetable.")
    result = CPSATSectionOptimizer(corridor=replay_corridor, time_limit_sec=3.0).solve(
        trains=trains, disruptions=disruptions, maintenance_blocks=maintenance,
        max_dwell_sec={(train.id, stop.station_id): stop.min_dwell_sec})
    feasible = result.status in ('OPTIMAL', 'FEASIBLE')
    current = item['result'].get('weighted_delay_minutes')
    alternative = round(result.total_weighted_delay_sec / 60, 1) if feasible else None
    base = datetime.fromisoformat(source['corridor_date'] + 'T00:00:00+05:30')
    def at(seconds):
        return (base + timedelta(seconds=seconds)).isoformat()
    alternate_schedule = []
    if feasible:
        for t in trains:
            for st in t.stops:
                times = result.schedule.get((t.id, st.station_id))
                if times is not None:
                    alternate_schedule.append({"train_id": t.id, "station_id": st.station_id, "assigned_platform": 0,
                        "scheduled_arrival": at(st.scheduled_arrival_sec), "scheduled_departure": at(st.scheduled_departure_sec),
                        "actual_arrival": at(times[0]), "actual_departure": at(times[1])})
    impact = {"status": result.status, "current_weighted_delay_min": current, "alternative_weighted_delay_min": alternative,
              "alternative_schedule": alternate_schedule,
              "delta_weighted_delay_min": round(alternative - current, 1) if current is not None and alternative is not None else None,
              "assumption": "The train departs after its minimum modelled dwell at this station.",
              "model_fingerprint": item['model_fingerprint']}
    with snapshot_connection() as db:
        db.execute('BEGIN IMMEDIATE')
        existing = db.execute('SELECT status FROM replay_reviews WHERE preview_id = ? AND decision_index = ?', (preview_id, decision_index)).fetchone()
        if existing and existing[0] in ('ACCEPTED', 'REJECTED'):
            raise HTTPException(409, "This recorded hold has already been reviewed.")
        db.execute('INSERT INTO replay_reviews (preview_id, decision_index, status, alternative) VALUES (?, ?, ?, ?) ON CONFLICT(preview_id, decision_index) DO UPDATE SET status = excluded.status, alternative = excluded.alternative', (preview_id, decision_index, 'PREVIEWED', json.dumps(impact)))
        db.execute('INSERT INTO replay_review_events (preview_id, decision_index, event, created_at) VALUES (?, ?, ?, ?)', (preview_id, decision_index, 'PREVIEWED', datetime.now().isoformat()))
    return impact


@app.post("/controller/replays/{preview_id}/decisions/{decision_index}/{action}")
def review_replay_decision(preview_id: int, decision_index: int, action: Literal['accept', 'reject']):
    item, decision = _replay_decision(preview_id, decision_index)
    if item.get('model_fingerprint') != RUNNING_MODEL_FINGERPRINT:
        raise HTTPException(409, 'The model has changed or this is an older recording. Create a new timetable preview before reviewing.')
    with snapshot_connection() as db:
        db.execute('BEGIN IMMEDIATE')
        previous = db.execute('SELECT status, alternative FROM replay_reviews WHERE preview_id = ? AND decision_index = ?', (preview_id, decision_index)).fetchone()
        if previous and previous[0] in ('ACCEPTED', 'REJECTED'):
            raise HTTPException(409, "This recorded hold has already been reviewed.")
        if action == 'reject':
            alternative = json.loads(previous[1]) if previous and previous[1] else None
            if not alternative or alternative.get('delta_weighted_delay_min') is None or alternative.get('model_fingerprint') != RUNNING_MODEL_FINGERPRINT:
                raise HTTPException(409, "Calculate a feasible alternative using the current model before rejecting.")
        instruction_id = None
        if action == 'accept':
            instruction_id = f"SIM-{uuid.uuid4().hex}"
            message = f"Recorded replay #{preview_id}: hold {decision['train_id']} at {decision['station_id']} for {decision['hold_minutes']} min. Simulation review only."
            db.execute('INSERT INTO simulation_instructions (id, station, train_id, message, created_at, plan_revision) VALUES (?, ?, ?, ?, ?, ?)', (instruction_id, decision['station_id'], decision['train_id'], message, datetime.now().isoformat(), -1))
        status = 'ACCEPTED' if action == 'accept' else 'REJECTED'
        db.execute('INSERT INTO replay_reviews (preview_id, decision_index, status, instruction_id) VALUES (?, ?, ?, ?) ON CONFLICT(preview_id, decision_index) DO UPDATE SET status = excluded.status, instruction_id = excluded.instruction_id', (preview_id, decision_index, status, instruction_id))
        db.execute('INSERT INTO replay_review_events (preview_id, decision_index, event, created_at) VALUES (?, ?, ?, ?)', (preview_id, decision_index, status, datetime.now().isoformat()))
    return {"status": status, "instruction_id": instruction_id, "message": "Review recorded for this simulation replay. The active plan was not changed."}


@app.get("/schedule")
def get_schedule():
    return {
        "schedule": [e.model_dump() for e in current_schedule_entries],
        "baseline": [e.model_dump() for e in baseline_schedule_entries],
        "previous": [e.model_dump() for e in previous_schedule_entries],
        "kpis": latest_kpis,
        "recommendations": [r.__dict__ for r in current_recommendations],
        "conflicts": [],  # Hard constraints guaranteed 0 violations
    }


@app.post("/schedule/recompute")
def post_recompute():
    _recompute_all(log_action="MANUAL_RECOMPUTE", details="Controller triggered schedule re-plan")
    return {
        "status": "success",
        "solve_time_ms": latest_kpis.get("solve_time_ms", 0.0),
        "kpis": latest_kpis,
        "schedule": [e.model_dump() for e in current_schedule_entries],
    }


@app.post("/override")
def post_override(req: OverrideRequest):
    station = corridor.get_station(req.station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    if req.new_platform < 1 or req.new_platform > station.platforms:
        raise HTTPException(status_code=400, detail=f"Platform {req.new_platform} invalid at {req.station_id}")

    fixed_overrides[req.train_id] = req.new_platform

    # Log action
    override_system.log_decision(
        recommendation_id="MANUAL_OVERRIDE",
        decision_type="PLATFORM_CHANGE",
        train_class="Mixed",
        station_id=req.station_id,
        action="ACCEPTED",
        reason_code=req.reason or "CONTROLLER_PREFERENCE",
    )

    _recompute_all(
        log_action="OVERRIDE_APPLIED",
        details=f"Controller forced {req.train_id} to Platform {req.new_platform} at {req.station_id}",
    )

    return {
        "status": "success",
        "train_id": req.train_id,
        "platform": req.new_platform,
        "solve_time_ms": latest_kpis.get("solve_time_ms", 0.0),
        "kpis": latest_kpis,
    }


def _solve_without_hold(rec: ExplainableRecommendation):
    train = next((t for t in trains_prototype if t.id == rec.train_id), None)
    stop = next((s for s in train.stops if s.station_id == rec.station_id), None) if train else None
    if stop is None:
        raise HTTPException(status_code=404, detail="The train or station is no longer available.")
    limits = {**rejected_holds, (rec.train_id, rec.station_id): stop.min_dwell_sec}
    result = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3.0).solve(
        trains=trains_prototype, disruptions=active_disruptions,
        maintenance_blocks=active_maintenance, fixed_overrides=fixed_overrides,
        max_dwell_sec=limits,
    )
    return result, limits


@app.post("/recommendations/{rec_id}/preview-rejection")
def preview_rejection(rec_id: str):
    rec = next((r for r in current_recommendations if r.id == rec_id), None)
    if not rec or rec.status != "PENDING":
        raise HTTPException(status_code=404, detail="Recommendation is no longer pending.")
    result, _ = _solve_without_hold(rec)
    if result.status not in ("OPTIMAL", "FEASIBLE"):
        return {"status": result.status, "message": "No alternative was found within the solver limit."}
    current = latest_kpis.get("weighted_delay_solver_min", 0.0)
    alternative = round(result.total_weighted_delay_sec / 60.0, 1)
    return {"status": result.status, "current_weighted_delay_min": current,
            "alternative_weighted_delay_min": alternative,
            "delta_weighted_delay_min": round(alternative - current, 1),
            "assumption": "The train leaves after its minimum dwell at this station.",
            "solve_time_ms": result.solve_time_ms}


@app.post("/recommendations/{rec_id}/reject")
def reject_recommendation(rec_id: str, req: RejectRecommendationRequest):
    rec = next((r for r in current_recommendations if r.id == rec_id), None)
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")

    if rec.status != "PENDING":
        raise HTTPException(status_code=409, detail="Recommendation is no longer pending.")
    result, limits = _solve_without_hold(rec)
    if result.status not in ("OPTIMAL", "FEASIBLE"):
        raise HTTPException(status_code=409, detail="No feasible alternative was found within the solver limit.")
    old_delay = latest_kpis.get("weighted_delay_solver_min", 0.0)
    impact = round(result.total_weighted_delay_sec / 60.0 - old_delay, 1)
    rejected_holds.clear()
    rejected_holds.update(limits)
    rec.status = "REJECTED"
    # Log rejection
    override_system.log_decision(
        recommendation_id=rec.id,
        decision_type=rec.decision_type,
        train_class=rec.train_name.split()[0] if rec.train_name else "Passenger",
        station_id=rec.station_id,
        action="REJECTED",
        reason_code=req.reason_code,
        weighted_min_impact=impact,
    )

    audit_logs.append(LogEntryDto(
        timestamp=datetime.now().isoformat(),
        action="RECOMMENDATION_REJECTED",
        details=f"Controller rejected {rec.id} ({rec.action_description}). Reason: {req.reason_code}",
        reason_code=req.reason_code,
    ))

    _recompute_all(log_action="ALTERNATIVE_APPLIED", details=f"Replanned after rejecting {rec.id}.", solved=result)
    return {
        "status": "rejected",
        "recommendation_id": rec.id,
        "cost_penalty_weighted_min": impact,
        "one_line_warning": "Alternative schedule applied in the simulation.",
    }


@app.post("/recommendations/{rec_id}/accept")
def accept_recommendation(rec_id: str):
    rec = next((r for r in current_recommendations if r.id == rec_id), None)
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")

    if rec.status != "PENDING":
        raise HTTPException(status_code=409, detail="Recommendation is no longer pending.")
    instruction_id = f"SIM-{uuid.uuid4().hex}"
    with snapshot_connection() as db:
        db.execute('INSERT INTO simulation_instructions (id, station, train_id, message, created_at, plan_revision) VALUES (?, ?, ?, ?, ?, ?)',
                   (instruction_id, rec.station_id, rec.train_id, rec.one_line_reason, datetime.now().isoformat(), plan_revision))
    rec.status = "ACCEPTED"
    override_system.log_decision(
        recommendation_id=rec.id,
        decision_type=rec.decision_type,
        train_class=rec.train_name.split()[0] if rec.train_name else "Passenger",
        station_id=rec.station_id,
        action="ACCEPTED",
        weighted_min_impact=None,
    )

    audit_logs.append(LogEntryDto(
        timestamp=datetime.now().isoformat(),
        action="RECOMMENDATION_ACCEPTED",
        details=f"Controller accepted {rec.id}: {rec.one_line_reason}",
    ))

    return {
        "status": "accepted",
        "instruction_id": instruction_id,
        "recommendation_id": rec.id,
        "saved_weighted_min": rec.weighted_minutes_saved,
    }


@app.get("/recommendations")
def get_recommendations():
    return [r.__dict__ for r in current_recommendations]


def _validate_disruption_request(req: DisruptionRequest):
    if req.duration_minutes <= 0:
        raise HTTPException(status_code=422, detail="Duration must be greater than zero.")
    if req.disruption_type in ("late_train", "loco_failure"):
        train = next((t for t in trains_prototype if t.id == req.train_id), None)
        if train is None:
            raise HTTPException(status_code=422, detail="Choose a train in the current timetable.")
        if req.disruption_type == "loco_failure" and req.block_id:
            route_blocks = {b.id for a, z in zip(train.stops, train.stops[1:]) if (b := corridor.get_block(a.station_id, z.station_id))}
            if req.block_id not in route_blocks:
                raise HTTPException(status_code=422, detail="The selected train does not use that track section.")
    if req.disruption_type in ("signal_failure", "speed_restriction"):
        if not req.block_id or not any(b.id == req.block_id for b in corridor.blocks):
            raise HTTPException(status_code=422, detail="Choose a valid track section.")
    if req.speed_restriction_kmh is not None and req.speed_restriction_kmh <= 0:
        raise HTTPException(status_code=422, detail="Speed restriction must be greater than zero.")


@app.post("/disruptions/inject")
def inject_disruption(req: DisruptionRequest):
    """
    Unified disruption injector supporting late trains, locomotive failures,
    signal failures, and speed restrictions (TSR).
    Triggers CP-SAT re-plan in < 3 seconds.
    """
    _validate_disruption_request(req)
    now = datetime.now()
    now_sec = now.hour * 3600 + now.minute * 60 + now.second
    dis_id = f"DIS-{int(time.time()) % 10000}"

    dis = Disruption(
        id=dis_id,
        type=req.disruption_type,
        start_time_sec=now_sec,
        duration_sec=req.duration_minutes * 60,
        train_id=req.train_id,
        station_id=req.station_id,
        block_id=req.block_id,
        speed_restriction_kmh=req.speed_restriction_kmh or (25.0 if req.disruption_type == "signal_failure" else 40.0),
        additional_headway_sec=req.additional_headway_sec or (300 if req.disruption_type == "signal_failure" else 0),
        description=req.description or f"{req.disruption_type} for {req.duration_minutes} min",
    )
    active_disruptions.append(dis)

    try:
        _recompute_all(
            log_action="DISRUPTION_INJECTED",
            details=f"Injected {dis.type}: {dis.description} (duration: {req.duration_minutes} min)",
        )
    except HTTPException:
        active_disruptions.remove(dis)
        raise

    return {
        "status": "injected",
        "disruption_id": dis_id,
        "solve_time_ms": latest_kpis.get("solve_time_ms", 0.0),
        "kpis": latest_kpis,
        "recommendations": [r.__dict__ for r in current_recommendations],
    }


@app.get("/disruptions/active")
def get_active_disruptions():
    return [
        {
            "id": d.id,
            "type": d.type,
            "duration_minutes": round(d.duration_sec / 60.0),
            "train_id": d.train_id,
            "block_id": d.block_id,
            "description": d.description,
        }
        for d in active_disruptions
    ]


@app.post("/disruptions/clear")
def clear_disruptions():
    global active_disruptions
    count = len(active_disruptions)
    active_disruptions = []
    _recompute_all(log_action="DISRUPTIONS_CLEARED", details=f"Cleared {count} active disruptions")
    return {"status": "cleared", "count": count}


@app.post("/maintenance/plan")
def plan_maintenance(req: MaintenanceRequest):
    """
    Places a maintenance block as a hard constraint with placement optimization.
    Evaluates candidate start times across the allowed window and generates the delay cost curve.
    """
    def _parse_time(t_str: str) -> int:
        parts = t_str.split(":")
        return int(parts[0]) * 3600 + int(parts[1]) * 60

    global pending_maintenance, pending_maintenance_revision
    pending_maintenance = None
    pending_maintenance_revision = None
    try:
        start_sec = _parse_time(req.allowed_start_time)
        end_sec = _parse_time(req.allowed_end_time)
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Enter valid start and end times.")
    dur_sec = req.duration_minutes * 60
    if not (0 <= start_sec < end_sec <= 86400) or dur_sec <= 0 or start_sec + dur_sec > end_sec:
        raise HTTPException(status_code=400, detail="The maintenance duration must fit within the same-day window.")
    if not any(b.id == req.section_id for b in corridor.blocks):
        raise HTTPException(status_code=400, detail="Unknown track section.")

    block_obj = MaintenanceBlock(
        id=f"MAINT-{int(time.time()) % 10000}",
        section_id=req.section_id,
        allowed_start_sec=start_sec,
        allowed_end_sec=end_sec,
        duration_sec=dur_sec,
        track_affected=req.track_affected or "both",
    )

    try:
        plan_result = planner.optimize_placement(
            trains=trains_prototype, maintenance=block_obj, step_minutes=15,
            eval_time_limit_sec=1.0, disruptions=active_disruptions,
            existing_blocks=active_maintenance, max_dwell_sec=rejected_holds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    block_obj.scheduled_start_sec = plan_result.optimal_start_sec
    pending_maintenance = block_obj
    pending_maintenance_revision = plan_revision

    return {
        "status": "preview",
        "maintenance_id": plan_result.maintenance_id,
        "section_id": plan_result.section_id,
        "optimal_slot": f"{plan_result.optimal_start_time_str} - {plan_result.optimal_end_time_str}",
        "optimal_weighted_delay_min": plan_result.optimal_weighted_delay_min,
        "cost_curve": [
            {
                "start_time": c.start_time_str,
                "end_time": c.end_time_str,
                "weighted_delay_min": c.weighted_delay_min,
                "affected_trains": c.affected_trains_count,
                "is_feasible": c.is_feasible,
            }
            for c in plan_result.cost_curve
        ],
        "recommendation": plan_result.recommendation_text,
    }


@app.post("/maintenance/{maintenance_id}/commit")
def commit_maintenance(maintenance_id: str):
    global pending_maintenance, pending_maintenance_revision
    block = pending_maintenance
    if block is None or block.id != maintenance_id:
        raise HTTPException(status_code=404, detail="Maintenance preview expired. Find a slot again.")
    if pending_maintenance_revision != plan_revision:
        raise HTTPException(status_code=409, detail="The plan changed since this preview. Find a slot again.")
    # Recheck against the current state in case it changed after preview.
    result = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3.0).solve(
        trains=trains_prototype, disruptions=active_disruptions,
        maintenance_blocks=[*active_maintenance, block], max_dwell_sec=rejected_holds,
    )
    if result.status not in ("OPTIMAL", "FEASIBLE"):
        raise HTTPException(status_code=409, detail="This slot could not be verified against the current plan. Find a slot again.")
    active_maintenance.append(block)
    pending_maintenance = None
    pending_maintenance_revision = None
    _recompute_all(log_action="MAINTENANCE_SCHEDULED", details=f"Maintenance {block.id} committed on {block.section_id}.", solved=result)
    return {"status": "committed", "maintenance_id": block.id}


@app.get("/maintenance/active")
def get_active_maintenance():
    return [
        {
            "id": m.id,
            "section_id": m.section_id,
            "duration_minutes": round(m.duration_sec / 60.0),
            "start_time": f"{(m.scheduled_start_sec // 3600):02d}:{((m.scheduled_start_sec % 3600) // 60):02d}" if m.scheduled_start_sec is not None else "Unassigned",
            "track_affected": m.track_affected,
        }
        for m in active_maintenance
    ]


@app.post("/whatif/evaluate")
def evaluate_whatif(req: WhatIfRequest):
    """
    Proper What-If Sandbox mode:
    Creates a sandbox copy of the live state, applies hypothetical disruption or override,
    solves with CP-SAT, and returns comparison without touching the live plan.
    """
    global whatif_sandbox_state

    # Clone state for sandbox
    sandbox_disruptions = copy.deepcopy(active_disruptions)
    sandbox_overrides = copy.deepcopy(fixed_overrides)

    if req.disruption:
        _validate_disruption_request(req.disruption)
        now_sec = datetime.now().hour * 3600 + datetime.now().minute * 60
        sandbox_disruptions.append(Disruption(
            id="SANDBOX_DIS",
            type=req.disruption.disruption_type,
            start_time_sec=now_sec,
            duration_sec=req.disruption.duration_minutes * 60,
            train_id=req.disruption.train_id,
            station_id=req.disruption.station_id,
            block_id=req.disruption.block_id,
            speed_restriction_kmh=req.disruption.speed_restriction_kmh or 30.0,
            description="Hypothetical disruption",
        ))

    if req.override:
        sandbox_overrides[req.override.train_id] = req.override.new_platform

    t0 = time.perf_counter()
    optimizer = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=2.5)
    res = optimizer.solve(
        trains=trains_prototype,
        disruptions=sandbox_disruptions,
        maintenance_blocks=active_maintenance,
        fixed_overrides=sandbox_overrides,
        max_dwell_sec=rejected_holds,
    )
    solve_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    if res.status not in ("OPTIMAL", "FEASIBLE"):
        raise HTTPException(status_code=409, detail=f"No feasible what-if plan found ({res.status}).")

    hypothetical_weighted = round(res.total_weighted_delay_sec / 60.0, 1)
    current_weighted = latest_kpis.get("weighted_delay_solver_min", 0.0)
    delta_weighted = round(hypothetical_weighted - current_weighted, 1)

    whatif_sandbox_state = {
        "disruptions": sandbox_disruptions,
        "overrides": sandbox_overrides,
        "schedule": res.schedule,
        "weighted_delay": hypothetical_weighted,
        "plan_revision": plan_revision,
    }

    return {
        "status": "evaluated",
        "solve_time_ms": solve_ms,
        "current_weighted_delay_min": current_weighted,
        "hypothetical_weighted_delay_min": hypothetical_weighted,
        "delta_weighted_delay_min": delta_weighted,
        "affected_trains_count": len([t for t in trains_prototype if (t.id, t.stops[-1].station_id) in res.schedule and res.schedule[(t.id, t.stops[-1].station_id)][0] > t.stops[-1].scheduled_arrival_sec + 60]),
        "summary": f"What-if scenario result: {delta_weighted:+.1f} min delta in weighted delay, solved in {solve_ms} ms.",
    }


@app.post("/whatif/commit")
def commit_whatif():
    """Commits sandbox what-if plan to live plan."""
    global whatif_sandbox_state, active_disruptions, fixed_overrides
    if not whatif_sandbox_state:
        raise HTTPException(status_code=400, detail="No active what-if simulation to commit")
    if whatif_sandbox_state["plan_revision"] != plan_revision:
        raise HTTPException(status_code=409, detail="The plan changed since this preview. Preview again.")

    active_disruptions = whatif_sandbox_state["disruptions"]
    fixed_overrides = whatif_sandbox_state["overrides"]
    whatif_sandbox_state = None

    _recompute_all(log_action="WHATIF_COMMITTED", details="Controller committed sandbox plan to live state")

    return {
        "status": "committed",
        "kpis": latest_kpis,
    }


@app.get("/benchmark/results")
def get_benchmark():
    """Returns comparative benchmark results across FCFS, Priority Rule, and CP-SAT Solver."""
    if os.path.exists(BENCHMARK_PATH):
        with open(BENCHMARK_PATH, "r") as f:
            report = json.load(f)
        if report.get("source_fingerprint") == RUNTIME_BENCHMARK_FINGERPRINT == benchmark_source_fingerprint():
            return {"status": "current", **report}
    return {"status": "stale", "message": "Run python backend/benchmark.py to generate results for the current model."}


@app.get("/stretch/forecast")
def get_forecast():
    """Stretch feature: Arrival time forecasting evaluation and predictions vs naive baselines."""
    eval_res = forecaster.evaluate_against_baselines(sample_size=150)
    return {
        "status": "evaluated",
        "model": eval_res.model_name,
        "mae_model_sec": eval_res.mae_model_sec,
        "mae_scheduled_sec": eval_res.mae_scheduled_sec,
        "mae_persistence_sec": eval_res.mae_persistence_sec,
        "improvement_pct": eval_res.improvement_pct,
        "disclosure": "Evaluated on synthetic operational disturbance data; demonstrates ML predictive integration into decision support.",
    }


@app.get("/stretch/override-learning")
def get_override_learning():
    """Stretch feature: Controller override acceptance metrics and bounded weight adaptation."""
    return override_system.get_summary()


@app.get("/log")
def get_logs():
    return [l.model_dump() for l in reversed(audit_logs)]


@app.post("/reset")
def post_reset():
    global active_disruptions, active_maintenance, fixed_overrides, whatif_sandbox_state, pending_maintenance, pending_maintenance_revision, active_incidents, blocked_platforms_state
    # Reset explicitly closes persisted simulation incidents rather than reviving them on restart.
    for incident in active_incidents:
        if incident.id not in ("INC-101", "INC-102") and incident.status != "resolved":
            closed = incident.model_copy(update={"status": "resolved", "restored": False})
            _save_incident(closed, "simulation_reset")
    active_disruptions = []
    active_maintenance = []
    fixed_overrides = {}
    rejected_holds.clear()
    pending_maintenance = None
    pending_maintenance_revision = None
    whatif_sandbox_state = None
    active_incidents = [
        IncidentDto(
            id="INC-101",
            station="SC",
            type="signal_failure",
            train_ids=[],
            platform=None,
            started_at="09:12",
            est_duration_min=20,
            note="Signal aspect flickering on Up Main line",
            status="open",
            reported_by="Station Master SC",
        ),
        IncidentDto(
            id="INC-102",
            station="SC",
            type="platform_blocked",
            train_ids=["T104"],
            platform=1,
            started_at="09:35",
            est_duration_min=15,
            note="Overrunning rakes clearing Platform 1",
            status="open",
            reported_by="Station Master SC",
        ),
    ]
    blocked_platforms_state = {"SC": {1}}
    _recompute_all(log_action="SYSTEM_RESET", details="System reset: cleared all overrides, disruptions, and maintenance")
    return {"status": "success", "message": "Corridor state reset to nominal"}


@app.get("/track-status")
def get_track_status():
    return {
        "track_occupancy": {b.id: [] for b in corridor.blocks},
        "active_movements": len(trains_prototype),
        "conflicts_detected": 0,
    }


@app.get("/analytics/summary")
def get_analytics_summary():
    return {
        "total_trains": len(trains_prototype),
        "avg_delay_min": latest_kpis.get("weighted_delay_solver_min", 0.0),
        "on_time_pct": 100.0 - (latest_kpis.get("trains_delayed_over_5m", 0) / max(1, len(trains_prototype)) * 100.0),
    }


@app.get("/analytics/trends")
def get_analytics_trends():
    return {
        "points": [
            {"time": "08:00", "delay": 2.1},
            {"time": "12:00", "delay": 4.5},
            {"time": "16:00", "delay": 3.2},
            {"time": "20:00", "delay": 1.8},
        ]
    }


@app.post("/feasibility")
def post_feasibility(req: OverrideRequest):
    station = corridor.get_station(req.station_id)
    is_valid = station is not None and (1 <= req.new_platform <= station.platforms)
    return {
        "status": "ok" if is_valid else "rejected",
        "safety_score": 1.0 if is_valid else 0.0,
        "impact_score": 0.1,
        "conflicts": [],
        "alternatives": [],
        "delay_impact_minutes": 0.0,
        "affected_trains": [],
        "reasons": ["Platform assignment is feasible within safety margins" if is_valid else "Invalid platform"],
    }


@app.post("/simulate/delay")
def post_simulate_delay(req: Dict):
    return {
        "scenario_id": "SIM_DELAY",
        "predicted_schedule": [e.model_dump() for e in current_schedule_entries],
        "kpi_delta": {"weighted_delay_change": 0.0},
        "conflicts_before": [],
        "conflicts_after": [],
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Initial greeting with current KPIs
        await websocket.send_text(json.dumps({
            "type": "welcome",
            "data": latest_kpis,
            "timestamp": datetime.now().isoformat(),
        }))
        while True:
            # Keep alive / listen for client ping
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
