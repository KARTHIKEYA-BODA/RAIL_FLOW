"""
Deterministic Cause Inference & Station Arrivals Module for PS-09 Railway Brain.
Evaluates 3 visible cause layers for arriving trains without any LLM guessing:
1. Reported: Incident reported directly by the station master (ground truth).
2. Inferred: Ordered deterministic rules:
   - Rule 1: Active incident on its route
   - Rule 2: Active speed restriction or maintenance block on its route
   - Rule 3: Planned platform still occupied by an overrunning train
   - Rule 4: Delay grew in the last section
   - Rule 5: Train started late from its origin
3. Unknown: "Cause unknown. Ask the station master".
"""
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple


def _time_to_sec(time_str: str) -> int:
    """Converts HH:MM or ISO timestamp to seconds from midnight."""
    if "T" in time_str:
        dt = datetime.fromisoformat(time_str)
        return dt.hour * 3600 + dt.minute * 60 + dt.second
    parts = time_str.split(":")
    return int(parts[0]) * 3600 + int(parts[1]) * 60


def _sec_to_time(sec: int) -> str:
    """Converts seconds from midnight to HH:MM formatted string."""
    sec = max(0, sec) % 86400
    h = sec // 3600
    m = (sec % 3600) // 60
    return f"{h:02d}:{m:02d}"


def infer_arrival_cause(
    train_id: str,
    station_id: str,
    delay_minutes: float,
    train_run,
    schedule_entry,
    all_schedule_entries: List,
    active_incidents: List,
    active_disruptions: List,
    active_maintenance: List,
) -> Tuple[Optional[str], str]:
    """
    Returns (cause_source, cause_text).
    cause_source is one of: "reported", "inferred", "unknown", or None (if on time).
    """
    if delay_minutes <= 0.5:
        return None, "On time"

    # ----------------------------------------------------
    # LAYER 1: REPORTED (Station Master's direct report)
    # ----------------------------------------------------
    for inc in active_incidents:
        if getattr(inc, "status", "open") != "open":
            continue
        inc_station = getattr(inc, "station", "")
        inc_trains = getattr(inc, "train_ids", [])
        inc_platform = getattr(inc, "platform", None)
        inc_type = getattr(inc, "type", "").replace("_", " ").capitalize()
        inc_note = getattr(inc, "note", "")

        # Direct match on train ID
        if train_id in inc_trains:
            note_str = f" - {inc_note}" if inc_note else ""
            return "reported", f"Reported: {inc_type} affecting {train_id}{note_str}"

        # Match on platform block at this station
        if inc_station == station_id and inc_platform is not None:
            assigned_p = getattr(schedule_entry, "assigned_platform", None)
            if assigned_p == inc_platform:
                return "reported", f"Reported: Platform {inc_platform} blocked ({inc_type})"

    # ----------------------------------------------------
    # LAYER 2: INFERRED (Strict, visible deterministic rules)
    # ----------------------------------------------------

    # Rule 1: Active incident on its route
    if train_run:
        route_station_ids = [s.station_id for s in train_run.stops]
        for inc in active_incidents:
            if getattr(inc, "status", "open") != "open":
                continue
            inc_st = getattr(inc, "station", "")
            if inc_st in route_station_ids:
                inc_type = getattr(inc, "type", "").replace("_", " ")
                return "inferred", f"Inferred: Active {inc_type} at {inc_st}"

    # Rule 2: Active speed restriction or maintenance block on its route
    if train_run and len(train_run.stops) > 1:
        route_pairs = {
            f"{train_run.stops[i].station_id}_{train_run.stops[i+1].station_id}"
            for i in range(len(train_run.stops) - 1)
        }
        # Check active disruptions (speed restriction / signal failure)
        for dis in active_disruptions:
            b_id = getattr(dis, "block_id", "") or ""
            if b_id in route_pairs:
                d_type = getattr(dis, "type", "speed_restriction").replace("_", " ")
                return "inferred", f"Inferred: Active {d_type} on section {b_id}"

        # Check maintenance blocks
        for mb in active_maintenance:
            sec_id = getattr(mb, "section_id", "")
            if sec_id in route_pairs:
                return "inferred", f"Inferred: Maintenance possession on track {sec_id}"

    # Rule 3: Planned platform is still occupied by an overrunning train
    assigned_platform = getattr(schedule_entry, "assigned_platform", 1)
    sched_arr_sec = _time_to_sec(getattr(schedule_entry, "scheduled_arrival", "00:00"))
    act_arr_sec = _time_to_sec(getattr(schedule_entry, "actual_arrival", "00:00"))

    for other in all_schedule_entries:
        if getattr(other, "train_id", "") == train_id:
            continue
        if getattr(other, "station_id", "") != station_id:
            continue
        if getattr(other, "assigned_platform", 0) != assigned_platform:
            continue

        other_act_dep = _time_to_sec(getattr(other, "actual_departure", "00:00"))
        # If the other train's actual departure overruns this train's scheduled arrival
        if other_act_dep > sched_arr_sec and other_act_dep <= act_arr_sec + 600:
            dep_str = _sec_to_time(other_act_dep)
            other_id = getattr(other, "train_id", "Unknown")
            return "inferred", f"Inferred: P{assigned_platform} still occupied by {other_id} until {dep_str}"

    # Rule 4: Delay grew in the last section
    if train_run:
        stop_indices = {s.station_id: idx for idx, s in enumerate(train_run.stops)}
        this_idx = stop_indices.get(station_id, -1)
        if this_idx > 0:
            prev_station_id = train_run.stops[this_idx - 1].station_id
            # Find delay at previous station
            prev_entry = next((
                e for e in all_schedule_entries
                if getattr(e, "train_id", "") == train_id and getattr(e, "station_id", "") == prev_station_id
            ), None)
            if prev_entry:
                prev_delay = getattr(prev_entry, "delay_minutes", 0.0)
                delta = delay_minutes - prev_delay
                if delta >= 2.0:
                    return "inferred", f"Inferred: Running time lost between {prev_station_id} and {station_id} (+{delta:.0f} min)"

    # Rule 5: Train started late from origin
    if train_run and len(train_run.stops) > 0:
        first_stop = train_run.stops[0]
        first_entry = next((
            e for e in all_schedule_entries
            if getattr(e, "train_id", "") == train_id and getattr(e, "station_id", "") == first_stop.station_id
        ), None)
        if first_entry:
            orig_delay = getattr(first_entry, "delay_minutes", 0.0)
            if orig_delay >= 3.0:
                return "inferred", f"Inferred: Train started late from {first_stop.station_id} (+{orig_delay:.0f} min)"

    # ----------------------------------------------------
    # LAYER 3: UNKNOWN (Never guess with LLMs)
    # ----------------------------------------------------
    return "unknown", "Cause unknown. Ask the station master"


def build_station_arrivals(
    station_id: str,
    window_minutes: int,
    current_time_sec: int,
    current_schedule_entries: List,
    baseline_schedule_entries: List,
    trains: List,
    active_incidents: List,
    active_disruptions: List,
    active_maintenance: List,
    recommendations: List,
) -> List[Dict]:
    """
    Builds the filtered arrivals dataset for the specified station within the time window.
    """
    station_entries = [
        e for e in current_schedule_entries
        if getattr(e, "station_id", "") == station_id
    ]

    train_map = {t.id: t for t in trains}
    arrivals = []

    # Time window limits
    min_window_sec = max(0, current_time_sec - 1800)  # include arrivals from 30 min ago
    max_window_sec = current_time_sec + window_minutes * 60

    for entry in station_entries:
        t_id = entry.train_id
        t_run = train_map.get(t_id)

        act_arr_sec = _time_to_sec(entry.actual_arrival)
        sched_arr_sec = _time_to_sec(entry.scheduled_arrival or entry.actual_arrival)
        act_dep_sec = _time_to_sec(entry.actual_departure)
        sched_dep_sec = _time_to_sec(entry.scheduled_departure or entry.actual_departure)

        # Filter within window
        if not (min_window_sec <= act_arr_sec <= max_window_sec):
            continue

        del_min = max(0.0, round((act_arr_sec - sched_arr_sec) / 60.0, 1))
        # Infer cause through the 3 layers
        cause_source, cause_text = infer_arrival_cause(
            train_id=t_id,
            station_id=station_id,
            delay_minutes=del_min,
            train_run=t_run,
            schedule_entry=entry,
            all_schedule_entries=current_schedule_entries,
            active_incidents=active_incidents,
            active_disruptions=active_disruptions,
            active_maintenance=active_maintenance,
        )

        # Match recommendation for this train
        matched_rec = next((
            r for r in recommendations
            if getattr(r, "train_id", "") == t_id and getattr(r, "status", "PENDING") == "PENDING"
        ), None)

        rec_dto = None
        if matched_rec:
            is_platform_change = (
                getattr(matched_rec, "decision_type", "") == "PLATFORM_CHANGE" or
                getattr(matched_rec, "station_id", "") == station_id
            )
            saved_val = getattr(matched_rec, "weighted_minutes_saved", None)
            saved_min = round(float(saved_val), 1) if saved_val is not None else 6.0
            rec_dto = {
                "id": matched_rec.id,
                "action_type": getattr(matched_rec, "decision_type", "PLATFORM_CHANGE"),
                "title": getattr(matched_rec, "action_description", f"Re-platform {t_id}"),
                "reason": getattr(matched_rec, "one_line_reason", ""),
                "savings_text": f"Saves {saved_min:.0f} min. If rejected +{saved_min:.0f}",
                "can_station_master_accept": is_platform_change,
                "button_label": "Accept" if is_platform_change else "Send to controller",
            }
        elif del_min > 3.0:
            # Deterministic default station fix if no solver precedence active
            rec_dto = {
                "id": f"REC-SM-{t_id}",
                "action_type": "PLATFORM_CHANGE",
                "title": f"Move {t_id} to Platform {(entry.assigned_platform % 6) + 1}",
                "reason": f"Alleviates platform contention at {station_id}",
                "savings_text": f"Saves {min(del_min, 6.0):.0f} min. If rejected +{min(del_min, 6.0):.0f}",
                "can_station_master_accept": True,
                "button_label": "Accept",
            }

        train_cls_str = t_run.train_class.value if t_run else ("Freight" if "FRT" in t_id else "Passenger")
        is_synthetic = "FRT" in t_id or train_cls_str.lower() == "freight"

        arrivals.append({
            "train_id": t_id,
            "train_name": getattr(t_run, "name", t_id),
            "category": train_cls_str,
            "is_synthetic": is_synthetic,
            "scheduled_arrival": _sec_to_time(sched_arr_sec),
            "expected_arrival": _sec_to_time(act_arr_sec),
            "scheduled_departure": _sec_to_time(sched_dep_sec),
            "expected_departure": _sec_to_time(act_dep_sec),
            "delay_minutes": del_min,
            "assigned_platform": entry.assigned_platform,
            "cause_source": cause_source,
            "cause_text": cause_text,
            "recommendation": rec_dto,
        })

    # Sort by expected arrival time
    arrivals.sort(key=lambda a: a["expected_arrival"])
    return arrivals
