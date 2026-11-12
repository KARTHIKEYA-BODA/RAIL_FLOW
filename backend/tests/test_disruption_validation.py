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
