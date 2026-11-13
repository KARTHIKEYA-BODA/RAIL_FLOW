import json
from fastapi.testclient import TestClient
import main
import station_access
from counterfactual import ExplainableRecommendation


def test_recorded_replay_is_read_only_and_preserves_midnight(monkeypatch, tmp_path):
    monkeypatch.setenv('RAILFLOW_SNAPSHOT_DB', str(tmp_path / 'replay.sqlite3'))
    payload = {'created_at': 100, 'input_fingerprint': 'example', 'input': {'corridor_date': '2026-11-09'}, 'result': {'trains': [{'number': '17664', 'name': 'Example', 'class': 'Express'}], 'decisions': [], 'schedule': [{'train_number': '17664', 'station': 'MJF', 'scheduled_arrival_sec': 86340, 'scheduled_departure_sec': 86400, 'planned_arrival_sec': 86460, 'planned_departure_sec': 86520}]}}
    with station_access.snapshot_connection() as db:
        db.execute('INSERT INTO timetable_previews (created_at, payload) VALUES (?, ?)', (100, json.dumps(payload)))
    previous = main.plan_revision
    client = TestClient(main.app)
    assert len(client.get('/controller/replays').json()) == 1
    data = client.get('/controller/replays/1').json()
    assert data['mode'] == 'REPLAY' and data['schedule'][0]['assigned_platform'] == 0
    assert data['schedule'][0]['actual_arrival'].startswith('2026-11-10T00:01:00')
    assert main.plan_revision == previous


def test_accepted_instruction_is_station_scoped_and_durable(monkeypatch, tmp_path):
    monkeypatch.setenv('RAILFLOW_SNAPSHOT_DB', str(tmp_path / 'instructions.sqlite3'))
    monkeypatch.setenv('STATION_MASTER_PIN', '123456')
    station_access._sessions.clear()
    rec = ExplainableRecommendation(id='REC-test', decision_type='HOLD', train_id='T1', train_name='Example', other_train_id=None, other_train_name=None, station_id='SC', action_description='Hold', hold_minutes=4, one_line_reason='Hold T1 at SC for 4 minutes in simulation.', weighted_minutes_saved=None, affected_trains_count=None, rejection_cost_weighted_min=None)
    monkeypatch.setattr(main, 'current_recommendations', [rec])
    client = TestClient(main.app)
    result = client.post('/recommendations/REC-test/accept')
    assert result.status_code == 200
    assert client.post('/recommendations/REC-test/accept').status_code == 409
    assert client.get('/station-access/instructions').status_code == 401
    token = client.post('/station-access/login', json={'pin': '123456'}).json()['token']
    headers = {'Authorization': f'Bearer {token}'}
    records = client.get('/station-access/instructions', headers=headers).json()
    assert len(records) == 1 and records[0]['id'] == result.json()['instruction_id']
    ack = client.post(f"/station-access/instructions/{records[0]['id']}/acknowledge", headers=headers)
    assert ack.status_code == 200
    assert client.get('/station-access/instructions', headers=headers).json()[0]['acknowledged_at']
    with station_access.snapshot_connection() as db:
        assert db.execute('SELECT COUNT(*) FROM simulation_instructions').fetchone()[0] == 1


def test_restart_restores_open_incident_as_provisional_without_constraints(monkeypatch, tmp_path):
    from types import SimpleNamespace
    monkeypatch.setenv('RAILFLOW_SNAPSHOT_DB', str(tmp_path / 'incidents.sqlite3'))
    incident = main.IncidentDto(id='INC-restart', station='SC', type='signal_failure', block_id='SC_MJF', started_at='09:00', est_duration_min=15, status='open')
    main._save_incident(incident, 'confirmed')
    monkeypatch.setattr(main, 'active_incidents', [])
    monkeypatch.setattr(main, 'active_disruptions', [])
    main._restore_incidents()
    restored = main.active_incidents[0]
    assert restored.status == 'reported' and restored.restored
    assert main.active_disruptions == []
    client = TestClient(main.app)
    assert client.post('/incidents/INC-restart/confirm').status_code == 409
    class Optimizer:
        def __init__(self, **kwargs): pass
        def solve(self, **kwargs): return SimpleNamespace(status='FEASIBLE', solve_time_ms=1, total_weighted_delay_sec=120)
    monkeypatch.setattr(main, 'CPSATSectionOptimizer', Optimizer)
    response = client.post('/incidents/INC-restart/preview')
    assert response.status_code == 200 and response.json()['incident']['restored'] is False
    assert main.active_disruptions == []
    assert client.patch('/incidents/INC-restart', json={'status': 'resolved'}).status_code == 200
    with station_access.snapshot_connection() as db:
        events = [row[0] for row in db.execute('SELECT event FROM simulation_incident_events ORDER BY id').fetchall()]
    assert events == ['confirmed', 'restored_review_required', 'preview_refreshed', 'resolved']
    history = client.get('/incident-history').json()
    assert history[0]['event'] == 'resolved' and history[0]['incident_id'] == 'INC-restart'


def test_failed_incident_persistence_rolls_back_confirmation(monkeypatch, tmp_path):
    monkeypatch.setenv('RAILFLOW_SNAPSHOT_DB', str(tmp_path / 'incident-failure.sqlite3'))
    report = main.create_incident(main.IncidentCreateRequest(station='SC', type='signal_failure', block_id='SC_MJF'))['incident']
    before = main.plan_revision
    previous_disruptions = len(main.active_disruptions)
    def recompute(**kwargs):
        main.plan_revision += 1
    def fail_save(*args):
        raise OSError('database unavailable')
    monkeypatch.setattr(main, '_recompute_all', recompute)
    monkeypatch.setattr(main, '_save_incident', fail_save)
    import pytest
    with pytest.raises(OSError):
        main.confirm_incident(report['id'])
    assert main.plan_revision == before
    assert len(main.active_disruptions) == previous_disruptions
    assert next(inc for inc in main.active_incidents if inc.id == report['id']).status == 'reported'


def test_replay_hold_review_uses_saved_inputs_without_mutating_live_plan(monkeypatch, tmp_path):
    from timetable_catalog import normalize_route
    monkeypatch.setenv('RAILFLOW_SNAPSHOT_DB', str(tmp_path / 'review.sqlite3'))
    monkeypatch.setenv('STATION_MASTER_PIN', '123456')
    station_access._sessions.clear()
    client = TestClient(main.app)
    token = client.post('/station-access/login', json={'pin': '123456'}).json()['token']
    headers = {'Authorization': f'Bearer {token}'}
    def route(number, origin, dest):
        return normalize_route({'train': {'number': number, 'name': number, 'type': 'Express', 'runDays': ['mon']}, 'route': [
            {'station': {'code': origin}, 'departure': '09:00', 'departureDay': 1},
            {'station': {'code': dest}, 'arrival': '09:15', 'arrivalDay': 1}]})
    with station_access.snapshot_connection() as db:
        for number, origin, dest in [('11111', 'BMO', 'MED'), ('22222', 'MED', 'BMO')]:
            db.execute('INSERT INTO timetables VALUES (?, ?, ?, ?)', (number, 100, 'source', json.dumps(route(number, origin, dest))))
    created = client.post('/station-access/timetable-preview', headers=headers, json={'corridor_date': '2026-11-09', 'train_numbers': ['11111', '22222']})
    assert created.status_code == 200
    data = created.json()
    assert data['result']['decisions']
    preview_id = data['id']
    before = main.plan_revision
    assert client.post(f'/controller/replays/{preview_id}/decisions/0/reject').status_code == 409
    alt = client.post(f'/controller/replays/{preview_id}/decisions/0/preview')
    assert alt.status_code == 200 and alt.json()['delta_weighted_delay_min'] is not None
    assert len(alt.json()['alternative_schedule']) == 4
    response = client.post(f'/controller/replays/{preview_id}/decisions/0/reject')
    assert response.status_code == 200 and response.json()['status'] == 'REJECTED'
    assert main.plan_revision == before
    replay = client.get(f'/controller/replays/{preview_id}').json()
    assert replay['decisions'][0]['review_status'] == 'REJECTED'
    assert [event['event'] for event in replay['review_events']] == ['REJECTED', 'PREVIEWED']
    assert client.post(f'/controller/replays/{preview_id}/decisions/0/accept').status_code == 409


def test_replay_review_refuses_old_model(monkeypatch, tmp_path):
    monkeypatch.setenv('RAILFLOW_SNAPSHOT_DB', str(tmp_path / 'old-model.sqlite3'))
    item = {'input': {}, 'result': {'decisions': [{'train_id': 'T1', 'station_id': 'SC', 'hold_minutes': 5}]}, 'model_fingerprint': 'old'}
    with station_access.snapshot_connection() as db:
        db.execute('INSERT INTO timetable_previews (created_at, payload) VALUES (?, ?)', (100, json.dumps(item)))
    client = TestClient(main.app)
    assert client.post('/controller/replays/1/decisions/0/preview').status_code == 409
    assert client.post('/controller/replays/1/decisions/0/accept').status_code == 409


def test_replay_accept_creates_one_station_instruction(monkeypatch, tmp_path):
    from timetable_catalog import normalize_route
    monkeypatch.setenv('RAILFLOW_SNAPSHOT_DB', str(tmp_path / 'replay-accept.sqlite3'))
    monkeypatch.setenv('STATION_MASTER_PIN', '123456')
    station_access._sessions.clear()
    client = TestClient(main.app)
    token = client.post('/station-access/login', json={'pin': '123456'}).json()['token']
    headers = {'Authorization': f'Bearer {token}'}
    def route(number):
        return normalize_route({'train': {'number': number, 'name': number, 'type': 'Express', 'runDays': ['mon']}, 'route': [
            {'station': {'code': 'SC'}, 'departure': '09:00', 'departureDay': 1},
            {'station': {'code': 'MJF'}, 'arrival': '09:10', 'arrivalDay': 1}]})
    with station_access.snapshot_connection() as db:
        for number in ['11111', '22222']:
            db.execute('INSERT INTO timetables VALUES (?, ?, ?, ?)', (number, 100, 'source', json.dumps(route(number))))
    saved = client.post('/station-access/timetable-preview', headers=headers, json={'corridor_date': '2026-11-09', 'train_numbers': ['11111', '22222']}).json()
    assert saved['result']['decisions'] and saved['result']['decisions'][0]['station_id'] == 'SC'
    preview_id = saved['id']
    before = main.plan_revision
    accepted = client.post(f'/controller/replays/{preview_id}/decisions/0/accept')
    assert accepted.status_code == 200 and accepted.json()['instruction_id']
    assert main.plan_revision == before
    assert client.post(f'/controller/replays/{preview_id}/decisions/0/accept').status_code == 409
    instructions = client.get('/station-access/instructions', headers=headers).json()
    assert len(instructions) == 1 and 'Recorded replay' in instructions[0]['message']
    assert client.post(f"/station-access/instructions/{instructions[0]['id']}/acknowledge", headers=headers).status_code == 200
