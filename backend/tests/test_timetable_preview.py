from datetime import date
import pytest
from timetable_catalog import normalize_route
from timetable_preview import train_for_date, preview


def sample():
    return normalize_route({'train': {'number': '17664', 'name': 'Example', 'type': 'Express', 'runDays': ['sun']}, 'route': [
        {'station': {'code': 'MJF'}, 'departure': '23:50', 'departureDay': 2},
        {'station': {'code': 'BMO'}, 'arrival': '00:10', 'arrivalDay': 3, 'departure': '00:12', 'departureDay': 3},
        {'station': {'code': 'MED'}, 'arrival': '00:30', 'arrivalDay': 3},
    ]})


def test_date_alignment_and_overnight_offsets():
    train = train_for_date(sample(), date(2026, 11, 9))  # Monday at corridor, origin Sunday
    assert train.stops[0].scheduled_departure_sec == 23 * 3600 + 50 * 60
    assert train.stops[-1].scheduled_arrival_sec == 24 * 3600 + 30 * 60
    with pytest.raises(ValueError, match='not listed as running'):
        train_for_date(sample(), date(2026, 11, 10))


def test_preview_rejects_missing_modelled_station_and_unknown_times():
    route = sample()
    route['stops'].pop(1)
    assert 'omits' in preview([route], date(2026, 11, 9))['excluded'][0]['reason']
    route = sample()
    route['stops'][1]['arrival_minutes_from_origin_day'] = None
    assert 'missing' in preview([route], date(2026, 11, 9))['excluded'][0]['reason']


def test_preview_returns_schedule_for_eligible_route():
    result = preview([sample()], date(2026, 11, 9))
    assert result['status'] in ('OPTIMAL', 'FEASIBLE')
    assert len(result['schedule']) == 3
    assert result['trains'][0]['number'] == '17664'
    assert result['zero_delay_sanity']['changed_stops'] >= 0
    assert result['zero_delay_sanity']['max_change_minutes'] >= 0
    assert {row['policy'] for row in result['comparison']} == {'FCFS', 'PRIORITY', 'SOLVER'}
    assert all(row['complete'] or row['weighted_delay_minutes'] is None for row in result['comparison'])


def test_synthetic_delay_changes_start_and_all_policies_run():
    result = preview([sample()], date(2026, 11, 9), '17664', 10)
    assert result['status'] in ('OPTIMAL', 'FEASIBLE')
    assert result['zero_delay_sanity'] is None
    first = result['schedule'][0]
    assert first['planned_departure_sec'] >= first['scheduled_departure_sec'] + 600
    assert {item['policy'] for item in result['comparison']} == {'FCFS', 'PRIORITY', 'SOLVER'}
    with pytest.raises(ValueError, match='not eligible'):
        preview([sample()], date(2026, 11, 9), 'other', 10)


def test_synthetic_locomotive_failure_requires_train_to_use_block():
    scenario = {'type': 'loco_failure', 'train_id': '17664', 'block_id': 'MJF_BMO', 'duration_minutes': 15, 'start_minute': 0}
    result = preview([sample()], date(2026, 11, 9), scenario=scenario)
    assert result['status'] in ('OPTIMAL', 'FEASIBLE')
    assert len(result['comparison']) == 3
    assert result['zero_delay_sanity'] is None
    scenario['block_id'] = 'ME_WDR'
    with pytest.raises(ValueError, match='does not use'):
        preview([sample()], date(2026, 11, 9), scenario=scenario)


def test_synthetic_closure_excludes_block_for_window():
    scenario = {'type': 'closed_block', 'block_id': 'MJF_BMO', 'duration_minutes': 30, 'start_minute': 23 * 60 + 45, 'train_id': None}
    result = preview([sample()], date(2026, 11, 9), scenario=scenario)
    assert result['status'] in ('OPTIMAL', 'FEASIBLE')
    assert result['schedule'][0]['planned_departure_sec'] >= (24 * 60 + 15) * 60
    assert len(result['comparison']) == 3
