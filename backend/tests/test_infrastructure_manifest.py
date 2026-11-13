import json

from fastapi.testclient import TestClient

from export_infrastructure import OUTPUT, build_manifest
from main import app

client = TestClient(app)


def test_checked_in_infrastructure_matches_the_model():
    recorded = json.loads(OUTPUT.read_text(encoding="utf-8"))
    assert recorded == build_manifest()


def test_every_modelled_block_has_track_type_and_class_runtimes():
    manifest = build_manifest()
    assert manifest["data_status"].startswith("prototype model")
    expected_classes = {"Express", "Suburban", "Passenger", "Freight"}
    assert manifest["blocks"]
    for block in manifest["blocks"]:
        assert block["verification"] == "assumed"
        assert block["track_type_modelled"] in {"single", "double"}
        assert block["length_km_modelled"] > 0
        assert set(block["minimum_runtime_seconds_modelled"]) == expected_classes
        assert all(value > 0 for value in block["minimum_runtime_seconds_modelled"].values())


def test_station_counts_are_marked_as_assumptions():
    manifest = build_manifest()
    assert manifest["stations"]
    assert all(station["verification"] == "assumed" for station in manifest["stations"])


def test_api_exposes_the_manifest_and_block_runtime_estimates():
    response = client.get("/corridor/infrastructure")
    assert response.status_code == 200
    assert response.json() == build_manifest()
    blocks = client.get("/corridor/blocks").json()
    assert len(blocks) == len(build_manifest()["blocks"])
    assert all(item["track_type_verification"] == "assumed" for item in blocks)
    assert all(item["minimum_runtime_seconds_modelled"] for item in blocks)
