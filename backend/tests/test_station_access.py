from fastapi.testclient import TestClient
from main import app
import station_access


def test_station_gate_and_cached_board(monkeypatch, tmp_path):
    monkeypatch.setenv("RAILFLOW_SNAPSHOT_DB", str(tmp_path / "snapshots.sqlite3"))
    station_access._sessions.clear()
    station_access._attempts.clear()
    station_access._cache.clear()
    monkeypatch.setenv('STATION_MASTER_PIN', '123456')
    monkeypatch.setenv('RAILRADAR_API_KEY', 'secret-test-key')
    client = TestClient(app)
    assert client.get('/station-access/board/SC').status_code == 401
    assert client.post('/station-access/login', json={'pin': '111111'}).status_code == 401
    token = client.post('/station-access/login', json={'pin': '123456'}).json()['token']
    headers = {'Authorization': f'Bearer {token}'}
    assert client.get('/station-access/board/XYZ', headers=headers).status_code == 403
    calls = []
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self): return b'{"success":true,"data":{"trains":[]},"meta":{"timestamp":"2026-01-01"}}'
    def fake_open(request, timeout):
        calls.append(request)
        return Response()
    monkeypatch.setattr(station_access, 'urlopen', fake_open)
    first = client.get('/station-access/board/SC', headers=headers)
    second = client.get('/station-access/board/SC', headers=headers)
    assert first.status_code == 200 and first.json()['cached'] is False
    assert second.json()['cached'] is True and len(calls) == 1
    assert 'secret-test-key' not in first.text
    client.post('/station-access/logout', headers=headers)
    assert client.get('/station-access/board/SC', headers=headers).status_code == 401


def test_snapshot_replay_and_train_lookup(monkeypatch, tmp_path):
    station_access._sessions.clear()
    station_access._attempts.clear()
    station_access._cache.clear()
    monkeypatch.setenv('STATION_MASTER_PIN', '123456')
    monkeypatch.setenv('RAILRADAR_API_KEY', 'secret-test-key')
    monkeypatch.setenv('RAILFLOW_SNAPSHOT_DB', str(tmp_path / 'snapshots.sqlite3'))
    client = TestClient(app)
    token = client.post('/station-access/login', json={'pin': '123456'}).json()['token']
    headers = {'Authorization': f'Bearer {token}'}
    calls = []
    class Response:
        def __init__(self, payload): self.payload = payload
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self): return self.payload
    def fake_open(request, timeout):
        calls.append(request.full_url)
        if '/stations/' in request.full_url:
            return Response(b'{"success":true,"data":{"trains":[]}}')
        return Response(b'{"success":true,"data":{"train":{"number":"17664"},"route":[{"station":{"code":"MJF"}},{"station":{"code":"WDR"}}]}}')
    monkeypatch.setattr(station_access, 'urlopen', fake_open)
    first = client.get('/station-access/board/SC', headers=headers).json()
    listing = client.get('/station-access/snapshots', headers=headers).json()
    replay = client.get(f"/station-access/snapshots/{listing[0]['id']}", headers=headers).json()
    assert first['recorded'] and replay['replay'] and replay['data'] == first['data']
    assert client.get('/station-access/snapshots').status_code == 401
    route = client.get('/station-access/train/17664/route', headers=headers)
    assert route.status_code == 200 and route.json()['data']['route'][0]['station']['code'] == 'MJF'
    assert client.get('/station-access/train/17664/route', headers=headers).json()['cached']
    catalog = client.get('/station-access/timetables', headers=headers).json()
    assert catalog[0]['train']['number'] == '17664' and catalog[0]['solver_ready'] is False
    assert client.get('/station-access/timetables').status_code == 401
    assert len(calls) == 2
    assert client.get('/station-access/train/17664/nope', headers=headers).status_code == 404

def test_between_discovery_validates_and_caches(monkeypatch):
    station_access._sessions.clear()
    station_access._attempts.clear()
    station_access._cache.clear()
    monkeypatch.setenv('STATION_MASTER_PIN', '123456')
    monkeypatch.setenv('RAILRADAR_API_KEY', 'secret-test-key')
    client = TestClient(app)
    token = client.post('/station-access/login', json={'pin': '123456'}).json()['token']
    headers = {'Authorization': f'Bearer {token}'}
    calls = []
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self): return b'{"success":true,"data":{"trains":[]}}'
    monkeypatch.setattr(station_access, 'urlopen', lambda request, timeout: (calls.append(request.full_url) or Response()))
    assert client.get('/station-access/between/MJF/MJF', headers=headers).status_code == 400
    assert client.get('/station-access/between/MJF/WDR', headers=headers).json()['cached'] is False
    assert client.get('/station-access/between/MJF/WDR', headers=headers).json()['cached'] is True
    assert len(calls) == 1


def test_timetable_preview_saves_immutable_replay(monkeypatch, tmp_path):
    import json
    from timetable_catalog import normalize_route
    station_access._sessions.clear()
    station_access._attempts.clear()
    monkeypatch.setenv('STATION_MASTER_PIN', '123456')
    monkeypatch.setenv('RAILFLOW_SNAPSHOT_DB', str(tmp_path / 'previews.sqlite3'))
    client = TestClient(app)
    token = client.post('/station-access/login', json={'pin': '123456'}).json()['token']
    headers = {'Authorization': f'Bearer {token}'}
    record = normalize_route({'train': {'number': '17664', 'type': 'Express', 'runDays': ['mon']}, 'route': [
        {'station': {'code': 'MJF'}, 'departure': '09:00', 'departureDay': 1},
        {'station': {'code': 'BMO'}, 'arrival': '09:15', 'arrivalDay': 1},
    ]})
    with station_access.snapshot_connection() as db:
        db.execute('INSERT INTO timetables VALUES (?, ?, ?, ?)', ('17664', 123.0, 'source time', json.dumps(record)))
    request = {'corridor_date': '2026-11-09', 'train_numbers': ['17664'], 'delay_train': '17664', 'delay_minutes': 10}
    assert client.post('/station-access/timetable-preview', json=request).status_code == 401
    created = client.post('/station-access/timetable-preview', headers=headers, json=request)
    assert created.status_code == 200
    payload = created.json()
    assert payload['result']['status'] in ('OPTIMAL', 'FEASIBLE')
    assert payload['input']['delay_minutes'] == 10
    assert payload['result']['schedule'][0]['planned_departure_sec'] >= payload['result']['schedule'][0]['scheduled_departure_sec'] + 600
    with station_access.snapshot_connection() as db:
        db.execute('DELETE FROM timetables')
    replay = client.get(f"/station-access/timetable-previews/{payload['id']}", headers=headers).json()
    assert replay['replay'] is True and replay['result'] == payload['result']
    assert replay['input_fingerprint'] == payload['input_fingerprint']
    assert client.post('/station-access/timetable-preview', headers=headers, json=request).status_code == 422


def test_nearby_station_boards_are_on_demand_and_cached_separately(monkeypatch, tmp_path):
    station_access._sessions.clear()
    station_access._attempts.clear()
    station_access._cache.clear()
    monkeypatch.setenv('STATION_MASTER_PIN', '123456')
    monkeypatch.setenv('RAILRADAR_API_KEY', 'test-key')
    monkeypatch.setenv('RAILFLOW_SNAPSHOT_DB', str(tmp_path / 'boards.sqlite3'))
    calls = []
    class Response:
        def __init__(self, station): self.station = station
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self):
            return json.dumps({'success': True, 'data': {'station': {'code': self.station}, 'trains': []}}).encode()
    import json
    def fake_open(request, timeout):
        station = request.full_url.split('/stations/')[1].split('/')[0]
        calls.append(station)
        return Response(station)
    monkeypatch.setattr(station_access, 'urlopen', fake_open)
    client = TestClient(app)
    token = client.post('/station-access/login', json={'pin': '123456'}).json()['token']
    headers = {'Authorization': f'Bearer {token}'}
    assert client.get('/station-access/board/SC', headers=headers).json()['station'] == 'SC'
    assert client.get('/station-access/board/MOB', headers=headers).json()['station'] == 'MOB'
    assert client.get('/station-access/board/MOB', headers=headers).json()['cached'] is True
    assert calls == ['SC', 'MOB']
    snapshots = client.get('/station-access/snapshots', headers=headers).json()
    assert {item['station'] for item in snapshots} == {'SC', 'MOB'}
