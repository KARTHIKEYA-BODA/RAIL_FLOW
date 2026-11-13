"""Export the current corridor model as an auditable assumption manifest."""
import json
from pathlib import Path

from section_model import create_sc_wdr_corridor


OUTPUT = Path(__file__).parent / "data" / "infrastructure.json"


def build_manifest():
    corridor = create_sc_wdr_corridor()
    stations = [
        {
            "code": station.id,
            "name": station.name,
            "km_from_sc": station.km,
            "platforms_modelled": station.platforms,
            "passing_loops_modelled": station.passing_loops,
            "junction_modelled": station.is_junction,
            "verification": "assumed",
        }
        for station in corridor.stations
    ]
    blocks = []
    for block in corridor.blocks:
        blocks.append(
            {
                "id": block.id,
                "from_station": block.from_station,
                "to_station": block.to_station,
                "length_km_modelled": block.length_km,
                "track_type_modelled": block.track_type.value,
                "headway_seconds_modelled": block.default_headway_sec,
                "speed_limits_kmh_modelled": {
                    train_class.value: speed
                    for train_class, speed in block.speed_limit_kmh.items()
                },
                "minimum_runtime_seconds_modelled": {
                    train_class.value: block.min_runtime_sec(train_class)
                    for train_class in block.speed_limit_kmh
                },
                "verification": "assumed",
            }
        )
    return {
        "corridor_id": corridor.id,
        "name": corridor.name,
        "data_status": "prototype model; all infrastructure values are assumptions",
        "station_order_modelled": ["SC", "MJF", "BMO", "MED", "MOB", "ME", "WDR"],
        "station_order_note": (
            "HYB and KCG are auxiliary modeled stations. This is not a complete "
            "physical route survey; omitted intermediate halts are not inferred."
        ),
        "runtime_method": "length_km / class_speed_kmh * 3600, rounded to nearest second",
        "runtime_method_note": (
            "These are simplified minimum model runtimes, not timetable-derived or "
            "railway-approved running times."
        ),
        "stations": stations,
        "blocks": blocks,
    }


if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(build_manifest(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")
