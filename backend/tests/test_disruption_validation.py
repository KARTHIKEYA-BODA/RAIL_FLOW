import pytest
from fastapi import HTTPException
import main


def test_disruption_requires_a_real_train():
    request = main.DisruptionRequest(disruption_type="late_train", duration_minutes=15)
    with pytest.raises(HTTPException) as exc:
        main._validate_disruption_request(request)
    assert exc.value.status_code == 422


def test_signal_disruption_requires_a_real_block():
    request = main.DisruptionRequest(disruption_type="signal_failure", block_id="not-a-block", duration_minutes=15)
    with pytest.raises(HTTPException) as exc:
        main._validate_disruption_request(request)
    assert exc.value.status_code == 422

def test_incident_does_not_select_a_train_or_platform_implicitly():
    from fastapi.testclient import TestClient
    client = TestClient(main.app)
    missing_train = client.post('/incidents', json={'station': 'SC', 'type': 'late_train'})
    assert missing_train.status_code == 422
    missing_platform = client.post('/incidents', json={'station': 'SC', 'type': 'platform_blocked'})
    assert missing_platform.status_code == 422

def test_incident_requires_real_simulated_block():
    from fastapi.testclient import TestClient
    client = TestClient(main.app)
    assert client.post('/incidents', json={'station': 'SC', 'type': 'signal_failure'}).status_code == 422
    assert client.post('/incidents', json={'station': 'SC', 'type': 'signal_failure', 'block_id': 'unknown'}).status_code == 422


def test_failed_confirmation_preserves_provisional_report(monkeypatch):
    request = main.IncidentCreateRequest(station='SC', type='signal_failure', block_id='SC_MJF')
    report = main.create_incident(request)['incident']
    previous_disruptions = len(main.active_disruptions)
    def fail(**kwargs):
        raise HTTPException(409, 'No feasible plan')
    monkeypatch.setattr(main, '_recompute_all', fail)
    with pytest.raises(HTTPException):
        main.confirm_incident(report['id'])
    assert len(main.active_disruptions) == previous_disruptions
    assert next(i for i in main.active_incidents if i.id == report['id']).status == 'reported'


def test_provisional_report_does_not_change_plan():
    import copy
    from fastapi.testclient import TestClient
    client = TestClient(main.app)
    before_schedule = copy.deepcopy(main.current_schedule_entries)
    before_revision = main.plan_revision
    before_disruptions = copy.deepcopy(main.active_disruptions)
    result = client.post('/incidents', json={'station': 'SC', 'type': 'signal_failure', 'block_id': 'SC_MJF', 'est_duration_min': 15})
    assert result.status_code == 200
    report = result.json()
    assert report['incident']['status'] == 'reported'
    assert main.current_schedule_entries == before_schedule
    assert main.plan_revision == before_revision
    assert main.active_disruptions == before_disruptions
    assert client.patch(f"/incidents/{report['incident']['id']}", json={'status': 'resolved'}).status_code == 200
    assert main.plan_revision == before_revision
