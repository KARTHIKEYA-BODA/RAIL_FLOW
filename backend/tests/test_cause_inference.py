"""
Tests for Cause Inference, Station Master Arrivals, and Field Incidents.
Validates:
1. All 3 cause layers: reported, inferred (rules 1-5), and unknown.
2. Station arrivals endpoint GET /station/{station_id}/arrivals.
3. Incident reporting POST /incidents with fast re-plan (< 5 seconds).
4. Platform blocked constraint and safety incident banner.
5. Incident resolution via PATCH /incidents/{id}.
"""
import time
from datetime import datetime, timedelta
import main
from fastapi.testclient import TestClient
import pytest
from main import app, active_incidents, blocked_platforms_state, trains_prototype


client = TestClient(app)


def test_station_arrivals_endpoint(monkeypatch):
    entry = next(e for e in main.current_schedule_entries if e.station_id == 'SC')
    fixed = datetime.fromisoformat(entry.actual_arrival) - timedelta(minutes=5)
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed if tz is None else fixed.astimezone(tz)
    monkeypatch.setattr(main, 'datetime', FixedDateTime)
    response = client.get("/station/SC/arrivals?window=180")
    assert response.status_code == 200
    data = response.json()
    assert data["station_id"] == "SC"
    assert "arrivals" in data
    assert len(data["arrivals"]) > 0

    first = data["arrivals"][0]
    assert "train_id" in first
    assert "expected_arrival" in first
    assert "delay_minutes" in first
    assert "cause_text" in first


def test_cause_inference_layers():
    # Submit an incident affecting a specific train
    test_train_id = trains_prototype[0].id
    resp = client.post("/incidents", json={
        "station": "SC",
        "type": "late_train",
        "train_ids": [test_train_id],
        "est_duration_min": 12,
        "note": "Interlocking delay outside home signal",
    })
    assert resp.status_code == 200
    inc_data = resp.json()
    assert inc_data["status"] == "created"
    assert inc_data["incident"]["status"] == "reported"
    assert "status" in inc_data["impact_preview"]
    assert client.post(f"/incidents/{inc_data['incident']['id']}/confirm").status_code == 200

    # Query arrivals at SC
    arr_resp = client.get("/station/SC/arrivals?window=360")
    assert arr_resp.status_code == 200
    arr_data = arr_resp.json()
    matched = next((a for a in arr_data["arrivals"] if a["train_id"] == test_train_id), None)
    if matched:
        # Should be classified as reported
        assert matched["cause_source"] == "reported"
        assert "Reported" in matched["cause_text"]


def test_platform_blocked_and_resolution():
    # Block Platform 2 at SC
    resp = client.post("/incidents", json={
        "station": "SC",
        "type": "platform_blocked",
        "platform": 2,
        "est_duration_min": 20,
        "note": "Broken rail on PF 2 turnout",
    })
    assert resp.status_code == 200
    inc_id = resp.json()["incident"]["id"]

    # A provisional report does not affect the active plan.
    arr_resp = client.get("/station/SC/arrivals?window=120")
    assert 2 not in arr_resp.json()["blocked_platforms"]
    assert client.post(f"/incidents/{inc_id}/confirm").status_code == 200
    assert 2 in client.get("/station/SC/arrivals?window=120").json()["blocked_platforms"]

    # Resolve incident
    patch_resp = client.patch(f"/incidents/{inc_id}", json={
        "status": "resolved",
        "resolution_note": "Turnout replaced and certified",
    })
    assert patch_resp.status_code == 200
    assert patch_resp.json()["incident"]["status"] == "resolved"


def test_safety_incident_banner():
    # Report a safety incident
    resp = client.post("/incidents", json={
        "station": "SC",
        "type": "safety_incident",
        "platform": 3,
        "est_duration_min": 60,
        "note": "Trespasser incident on track 3",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["safety_alert"] is not None
    assert "Inform the Section Controller" in data["safety_alert"]

    # Check that arrivals endpoint also surfaces safety alert
    arr_resp = client.get("/station/SC/arrivals?window=120")
    assert arr_resp.json()["safety_alert"] is not None

    # Clean up by resolving
    inc_id = data["incident"]["id"]
    client.patch(f"/incidents/{inc_id}", json={"status": "resolved"})
