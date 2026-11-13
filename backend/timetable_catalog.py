"""Normalize provider timetables for review, never for direct train control."""
from datetime import datetime

MODEL_ORDER = ('SC', 'MJF', 'BMO', 'MED', 'MOB', 'ME', 'WDR')


def _minutes(value, day):
    if not isinstance(value, str) or not isinstance(day, int) or isinstance(day, bool) or day < 1:
        return None
    try:
        parsed = datetime.strptime(value, '%H:%M')
    except ValueError:
        return None
    return (day - 1) * 1440 + parsed.hour * 60 + parsed.minute


def normalize_route(data):
    train = data.get('train')
    route = data.get('route')
    if not isinstance(train, dict) or not train.get('number') or not isinstance(route, list):
        raise ValueError('Route response does not contain a train number and stop list.')
    stops, warnings = [], []
    last_time = None
    for index, item in enumerate(route):
        if not isinstance(item, dict) or not isinstance(item.get('station'), dict) or not item['station'].get('code'):
            warnings.append(f'Stop {index + 1} has no station code and was excluded.')
            continue
        arr = _minutes(item.get('arrival'), item.get('arrivalDay'))
        dep = _minutes(item.get('departure'), item.get('departureDay'))
        if item.get('arrival') and arr is None:
            warnings.append(f"{item['station']['code']}: arrival time or day is missing or invalid.")
        if item.get('departure') and dep is None:
            warnings.append(f"{item['station']['code']}: departure time or day is missing or invalid.")
        if arr is not None and dep is not None and dep < arr:
            warnings.append(f"{item['station']['code']}: departure precedes arrival.")
        first = arr if arr is not None else dep
        last = dep if dep is not None else arr
        if last_time is not None and first is not None and first < last_time:
            warnings.append(f"{item['station']['code']}: time goes backwards relative to the previous stop.")
        if last is not None:
            last_time = last
        stops.append({'sequence': item.get('sequence', index + 1), 'station_code': item['station']['code'], 'station_name': item['station'].get('name'), 'arrival': item.get('arrival'), 'departure': item.get('departure'), 'arrival_day': item.get('arrivalDay'), 'departure_day': item.get('departureDay'), 'arrival_minutes_from_origin_day': arr, 'departure_minutes_from_origin_day': dep, 'distance_km': item.get('distance'), 'is_halt': item.get('isHalt')})
    matched = [s['station_code'] for s in stops if s['station_code'] in MODEL_ORDER]
    if len(matched) < 2:
        warnings.append('Fewer than two modelled corridor stations found; this is not enough to infer a corridor movement.')
    if len(set(matched)) != len(matched):
        warnings.append('The route repeats a modelled station; direction is ambiguous.')
    indexes = [MODEL_ORDER.index(code) for code in matched]
    if len(indexes) >= 2 and not (all(a < b for a, b in zip(indexes, indexes[1:])) or all(a > b for a, b in zip(indexes, indexes[1:]))):
        warnings.append('Modelled station order is not monotonic; route or reversal needs review.')
    if any(abs(a-b) != 1 for a,b in zip(indexes, indexes[1:])):
        warnings.append('Some consecutive modelled stations are missing; do not infer their timings or track occupancy.')
    if not train.get('runDays'):
        warnings.append('Running days were not supplied; do not assume daily operation.')
    return {'train': {'number': str(train['number']), 'name': train.get('name'), 'type': train.get('type'), 'category': train.get('category'), 'running_days': train.get('runDays')}, 'stops': stops, 'modelled_stations': matched, 'warnings': warnings, 'solver_ready': False, 'solver_ready_reason': 'Provider timetables and modelled infrastructure have not been validated for operational use.'}
