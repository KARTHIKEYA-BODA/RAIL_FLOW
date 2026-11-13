from timetable_catalog import normalize_route


def test_normalizes_overnight_times_and_preserves_unknown_days():
    result = normalize_route({'train': {'number': '17664', 'runDays': ['mon']}, 'route': [
        {'sequence': 1, 'station': {'code': 'MJF', 'name': 'Malkajgiri'}, 'departure': '23:50', 'departureDay': 1},
        {'sequence': 2, 'station': {'code': 'BMO', 'name': 'Bolarum'}, 'arrival': '00:10', 'arrivalDay': 2, 'departure': '00:12', 'departureDay': 2},
        {'sequence': 3, 'station': {'code': 'MED'}, 'arrival': '00:25'},
    ]})
    assert result['stops'][1]['arrival_minutes_from_origin_day'] == 1450
    assert result['stops'][2]['arrival_minutes_from_origin_day'] is None
    assert any('day is missing or invalid' in warning for warning in result['warnings'])
    assert result['solver_ready'] is False


def test_route_validation_flags_gaps_reversal_and_missing_running_days():
    result = normalize_route({'train': {'number': '10000'}, 'route': [
        {'station': {'code': 'MJF'}}, {'station': {'code': 'MED'}}, {'station': {'code': 'BMO'}}
    ]})
    assert any('missing' in warning for warning in result['warnings'])
    assert any('not monotonic' in warning for warning in result['warnings'])
    assert any('Running days' in warning for warning in result['warnings'])
