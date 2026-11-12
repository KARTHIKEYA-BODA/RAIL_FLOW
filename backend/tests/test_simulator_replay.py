"""Regression checks for simulator completion and maintenance replay."""
from section_model import BlockSection, CorridorSection, Direction, MaintenanceBlock, StationNode, TrackType, TrainClass, TrainRun, TrainStop
from simulator import CorridorSimulator
from section_model import create_sc_wdr_corridor
from cpsat_solver import SolveResult
from counterfactual import CounterfactualExplainer


def fixture_route():
    section = CorridorSection(id="test", name="test", stations=[StationNode(id="A", name="A", km=0, platforms=1), StationNode(id="B", name="B", km=10, platforms=1)], blocks=[BlockSection(id="A_B", from_station="A", to_station="B", length_km=10, track_type=TrackType.SINGLE)])
    train = TrainRun(id="F1", name="Freight", train_class=TrainClass.FREIGHT, direction=Direction.UP, origin="A", destination="B", stops=[TrainStop(station_id="A", scheduled_arrival_sec=1000, scheduled_departure_sec=1000, min_dwell_sec=0), TrainStop(station_id="B", scheduled_arrival_sec=1600, scheduled_departure_sec=1600, min_dwell_sec=0)])
    return section, train


def test_replay_does_not_enter_before_a_possession_it_cannot_clear():
    corridor, train = fixture_route()
    maintenance = MaintenanceBlock(id="M", section_id="A_B", allowed_start_sec=1200, allowed_end_sec=1800, duration_sec=600, scheduled_start_sec=1200)
    result = CorridorSimulator(corridor=corridor, maintenance_blocks=[maintenance]).run([train])
    assert result.kpis.completed_trains == 1
    assert result.train_trajectories["F1"][0]["actual_departure"] >= 1800


def test_train_that_never_reaches_destination_is_not_completed():
    corridor, train = fixture_route()
    result = CorridorSimulator(corridor=corridor).run([train], end_time_sec=1100)
    assert result.kpis.completed_trains == 0


def test_hold_reason_names_train_that_clears_the_same_single_track_block():
    corridor = create_sc_wdr_corridor()
    first = TrainRun(id="F1", name="Freight 1", train_class=TrainClass.FREIGHT, direction=Direction.UP, origin="BMO", destination="MED", stops=[TrainStop("BMO", 4000, 4000, 0), TrainStop("MED", 5800, 5800, 0)])
    second = TrainRun(id="F2", name="Freight 2", train_class=TrainClass.FREIGHT, direction=Direction.DOWN, origin="MED", destination="BMO", stops=[TrainStop("MED", 4100, 4100, 0), TrainStop("BMO", 4900, 4900, 0)])
    result = SolveResult(status="FEASIBLE", solve_time_ms=1, total_weighted_delay_sec=0, total_unweighted_delay_sec=0, max_delay_sec=0, schedule={("F1", "BMO"): (4000, 5000), ("F1", "MED"): (5800, 5800), ("F2", "MED"): (4100, 4100), ("F2", "BMO"): (4900, 4900)}, decisions=[{"train_id": "F1", "station_id": "BMO", "hold_minutes": 16.7}], objective_value=0)
    recommendation = CounterfactualExplainer(corridor).generate_explanations([first, second], result, 0)[0]
    assert recommendation.other_train_id == "F2"
    assert "F2 clears BMO_MED" in recommendation.one_line_reason
    assert recommendation.rejection_cost_weighted_min is None
