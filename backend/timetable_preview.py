"""Isolated timetable-based solver previews. Never changes the active simulation."""
from datetime import date, timedelta
import hashlib
import sys
import ortools
from pathlib import Path
from section_model import Direction, Disruption, MaintenanceBlock, TrainClass, TrainRun, TrainStop, create_sc_wdr_corridor
from timetable_catalog import MODEL_ORDER
from cpsat_solver import CPSATSectionOptimizer
from counterfactual import CounterfactualExplainer
from simulator import CorridorSimulator

DAYS = ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')


def train_for_date(record, corridor_date):
    info = record['train']
    all_stops = record['stops']
    stops = [s for s in all_stops if s['station_code'] in MODEL_ORDER]
    if len(stops) < 2:
        raise ValueError('Fewer than two modelled stations are present.')
    sequences = [s.get('sequence') for s in stops]
    if any(not isinstance(seq, int) or isinstance(seq, bool) for seq in sequences) or any(a >= b for a, b in zip(sequences, sequences[1:])):
        raise ValueError('Station sequence is missing or out of order.')
    codes = [s['station_code'] for s in stops]
    indices = [MODEL_ORDER.index(code) for code in codes]
    if len(set(codes)) != len(codes) or not (all(a < b for a, b in zip(indices, indices[1:])) or all(a > b for a, b in zip(indices, indices[1:]))):
        raise ValueError('The modelled route repeats stations or reverses direction.')
    if any(abs(a - b) != 1 for a, b in zip(indices, indices[1:])):
        raise ValueError('The route omits one or more modelled stations.')
    first = stops[0]
    first_day = first.get('arrival_day') if first.get('arrival_minutes_from_origin_day') is not None else first.get('departure_day')
    if not isinstance(first_day, int) or isinstance(first_day, bool) or first_day < 1:
        raise ValueError('The first corridor stop has no valid timetable day.')
    running = info.get('running_days')
    if not isinstance(running, list) or not running:
        raise ValueError('Running days are missing.')
    origin_day = corridor_date - timedelta(days=first_day - 1)
    if DAYS[origin_day.weekday()] not in [str(day).lower()[:3] for day in running]:
        raise ValueError(f'The train is not listed as running on its origin date {origin_day.isoformat()}.')
    base = (first_day - 1) * 1440
    made = []
    previous_dep = -1
    for stop in stops:
        arr = stop.get('arrival_minutes_from_origin_day')
        dep = stop.get('departure_minutes_from_origin_day')
        # Only actual route endpoints can legitimately omit their arrival/departure.
        if arr is None and stop is all_stops[0] and dep is not None:
            arr = dep
        if dep is None and stop is all_stops[-1] and arr is not None:
            dep = arr
        if not isinstance(arr, int) or isinstance(arr, bool) or not isinstance(dep, int) or isinstance(dep, bool):
            raise ValueError(f"{stop['station_code']} has missing arrival, departure or day offsets.")
        arr, dep = (arr - base) * 60, (dep - base) * 60
        if arr < 0 or dep < arr or arr < previous_dep or dep > 108000:
            raise ValueError(f"{stop['station_code']} has inconsistent times or falls outside the 30-hour model.")
        made.append(TrainStop(station_id=stop['station_code'], scheduled_arrival_sec=arr, scheduled_departure_sec=dep, min_dwell_sec=dep-arr, platform_pref=None))
        previous_dep = dep
    category = ' '.join(str(info.get(k) or '') for k in ('type', 'category')).lower()
    if any(word in category for word in ('local', 'suburban', 'demu', 'memu', 'emu')):
        train_class = TrainClass.SUBURBAN
    elif 'passenger' in category:
        train_class = TrainClass.PASSENGER
    elif any(word in category for word in ('express', 'superfast', 'premium', 'mail')):
        train_class = TrainClass.EXPRESS
    else:
        raise ValueError('Train class is unknown; priority weight cannot be assigned safely.')
    return TrainRun(id=info['number'], name=info.get('name') or info['number'], train_class=train_class, direction=Direction.UP if indices[0] < indices[-1] else Direction.DOWN, stops=made, origin=codes[0], destination=codes[-1])


def prepare(records, corridor_date, delay_train=None, delay_minutes=0, scenario=None):
    trains, excluded = [], []
    for record in records:
        try:
            trains.append(train_for_date(record, corridor_date))
        except (KeyError, TypeError, ValueError) as exc:
            excluded.append({'train_number': record.get('train', {}).get('number', 'unknown'), 'reason': str(exc)})
    if not trains:
        return trains, excluded, create_sc_wdr_corridor(), [], []
    disruptions = []
    if delay_minutes:
        delayed = next((train for train in trains if train.id == delay_train), None)
        if delayed is None:
            raise ValueError('The selected delayed train is not eligible for this preview.')
        disruptions = [Disruption(id='preview-delay', type='late_train', train_id=delayed.id, start_time_sec=delayed.scheduled_start_sec, duration_sec=delay_minutes * 60, description='Synthetic start delay')]
    corridor = create_sc_wdr_corridor()
    maintenance = []
    if scenario:
        block = next((item for item in corridor.blocks if item.id == scenario['block_id']), None)
        if not block:
            raise ValueError('Choose a valid modelled block.')
        duration = scenario['duration_minutes'] * 60
        if scenario['type'] == 'loco_failure':
            train = next((item for item in trains if item.id == scenario.get('train_id')), None)
            if not train:
                raise ValueError('The selected locomotive-failure train is not eligible.')
            route_blocks = {b.id for a, z in zip(train.stops, train.stops[1:]) if (b := corridor.get_block(a.station_id, z.station_id))}
            if block.id not in route_blocks:
                raise ValueError('The selected train does not use that modelled block.')
            disruptions.append(Disruption(id='preview-loco', type='loco_failure', train_id=train.id, block_id=block.id, start_time_sec=0, duration_sec=duration, description='Synthetic locomotive failure, modelled as additional block running time'))
        elif scenario['type'] == 'closed_block':
            start = scenario['start_minute'] * 60
            if start + duration > 108000:
                raise ValueError('The block closure ends beyond the 30-hour model horizon.')
            maintenance.append(MaintenanceBlock(id='preview-closure', section_id=block.id, allowed_start_sec=start, allowed_end_sec=start + duration, duration_sec=duration, scheduled_start_sec=start, track_affected='both'))
        else:
            raise ValueError('Unknown synthetic scenario.')
    return trains, excluded, corridor, disruptions, maintenance


def model_fingerprint():
    digest = hashlib.sha256()
    digest.update(f"python:{sys.version_info[:3]}|ortools:{ortools.__version__}".encode())
    for name in ("timetable_preview.py", "timetable_catalog.py", "cpsat_solver.py", "section_model.py", "simulator.py", "counterfactual.py"):
        digest.update((Path(__file__).parent / name).read_bytes())
    return digest.hexdigest()


RUNNING_MODEL_FINGERPRINT = model_fingerprint()


def preview(records, corridor_date, delay_train=None, delay_minutes=0, scenario=None):
    trains, excluded, corridor, disruptions, maintenance = prepare(records, corridor_date, delay_train, delay_minutes, scenario)
    if not trains:
        return {"status": "NO_ELIGIBLE_TRAINS", "excluded": excluded, "trains": [], "schedule": [], "decisions": []}
    result = CPSATSectionOptimizer(corridor=corridor, time_limit_sec=3.0).solve(trains=trains, disruptions=disruptions, maintenance_blocks=maintenance)
    schedule = []
    for train in trains:
        for stop in train.stops:
            actual = result.schedule.get((train.id, stop.station_id))
            if actual is not None:
                schedule.append({'train_number': train.id, 'station': stop.station_id, 'scheduled_arrival_sec': stop.scheduled_arrival_sec, 'scheduled_departure_sec': stop.scheduled_departure_sec, 'planned_arrival_sec': actual[0], 'planned_departure_sec': actual[1]})
    sanity = None
    if schedule and not delay_minutes and not scenario:
        changes = [max(abs(row['planned_arrival_sec'] - row['scheduled_arrival_sec']), abs(row['planned_departure_sec'] - row['scheduled_departure_sec'])) for row in schedule]
        sanity = {'max_change_minutes': round(max(changes, default=0) / 60, 1), 'changed_stops': sum(change > 60 for change in changes), 'tolerance_minutes': 1}
    comparison = []
    if schedule:
        for policy in ('FCFS', 'PRIORITY', 'SOLVER'):
            simulation = CorridorSimulator(corridor=corridor, policy=policy, disruptions=disruptions, maintenance_blocks=maintenance, solver_schedule=result.schedule if policy == 'SOLVER' else None).run(trains)
            kpi = simulation.kpis
            complete = kpi.completed_trains == len(trains)
            comparison.append({'policy': policy, 'complete': complete, 'completed_trains': kpi.completed_trains, 'total_trains': len(trains), 'weighted_delay_minutes': kpi.total_weighted_delay_min if complete else None, 'constraint_violations': kpi.constraint_violations})
    explanations = CounterfactualExplainer(corridor).generate_explanations(trains, result, 0, disruptions=disruptions) if schedule else []
    reasons = {(item.train_id, item.station_id): item for item in explanations}
    decisions = [{**decision, 'one_line_reason': reasons[(decision['train_id'], decision['station_id'])].one_line_reason,
                  'other_train_id': reasons[(decision['train_id'], decision['station_id'])].other_train_id}
                 if (decision['train_id'], decision['station_id']) in reasons else decision for decision in result.decisions] if schedule else []
    return {'status': result.status, 'solve_time_ms': result.solve_time_ms, 'weighted_delay_minutes': round(result.total_weighted_delay_sec / 60, 1) if schedule else None, 'comparison': comparison, 'zero_delay_sanity': sanity, 'excluded': excluded, 'trains': [{'number': t.id, 'name': t.name, 'class': t.train_class.value, 'direction': t.direction.value} for t in trains], 'schedule': schedule, 'decisions': decisions}
