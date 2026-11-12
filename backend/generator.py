"""
Synthetic 24-Hour Timetable Generator for PS-09 Railway Brain.
Generates realistic, reproducible 24-hour traffic over the corridor
with train classes, directions, noise, and minimum dwells.
Every train traverses consecutive physical blocks with commercial
stops or run-throughs (dwell=0).
"""
import json
import random
from typing import Dict, List, Optional
from section_model import (
    CorridorSection,
    Direction,
    StationNode,
    TrainClass,
    TrainRun,
    TrainStop,
    create_sc_wdr_corridor,
)


class TimetableGenerator:
    def __init__(self, corridor: Optional[CorridorSection] = None, seed: int = 42):
        self.corridor = corridor or create_sc_wdr_corridor()
        self.seed = seed
        self.rng = random.Random(seed)

    def generate_24h_timetable(self, total_trains: int = 100) -> List[TrainRun]:
        """
        Generates `total_trains` scheduled across 24 hours (00:00 to 24:00).
        Traffic distribution includes morning and evening peaks.
        """
        trains: List[TrainRun] = []
        classes = [
            (TrainClass.EXPRESS, 0.25),
            (TrainClass.SUBURBAN, 0.35),
            (TrainClass.PASSENGER, 0.25),
            (TrainClass.FREIGHT, 0.15),
        ]

        # Time bins with probability weights (morning and evening peak)
        hourly_weights = [
            0.01, 0.01, 0.01, 0.02, 0.03, 0.05,  # 00:00 - 05:59 (night)
            0.08, 0.09, 0.09, 0.07, 0.04, 0.04,  # 06:00 - 11:59 (morning peak)
            0.04, 0.04, 0.04, 0.05, 0.07, 0.09,  # 12:00 - 17:59 (afternoon)
            0.09, 0.07, 0.05, 0.04, 0.03, 0.02   # 18:00 - 23:59 (evening peak)
        ]

        # Pre-generate departure times spread across 24 hours
        departure_times = []
        for hour, weight in enumerate(hourly_weights):
            count = int(round(total_trains * weight))
            for _ in range(count):
                minute = self.rng.randint(0, 59)
                sec = (hour * 3600) + (minute * 60) + self.rng.choice([0, 30])
                departure_times.append(min(sec, 86400 - 7200)) # Leave room before day end

        while len(departure_times) < total_trains:
            departure_times.append(self.rng.randint(18000, 75600))
        departure_times = sorted(departure_times[:total_trains])

        for idx, start_sec in enumerate(departure_times):
            train_num = 12000 + idx + 1
            direction = Direction.UP if (idx % 2 == 0) else Direction.DOWN

            # Pick train class
            r = self.rng.random()
            cum = 0.0
            chosen_class = TrainClass.PASSENGER
            for tc, w in classes:
                cum += w
                if r <= cum:
                    chosen_class = tc
                    break

            ordered_station_ids = self.corridor.get_ordered_stations(direction)
            if chosen_class == TrainClass.EXPRESS:
                # Express originates and terminates at corridor ends, commercial stops at key stations
                sub_corridor = ordered_station_ids
                commercial_stops = {"SC", "BMO", "MOB", "WDR"}
                prefix = "EXP"
            elif chosen_class == TrainClass.FREIGHT:
                # Freight runs through with no intermediate passenger stops
                sub_corridor = ordered_station_ids
                commercial_stops = {ordered_station_ids[0], ordered_station_ids[-1]}
                prefix = "FRT"
            elif chosen_class == TrainClass.SUBURBAN:
                # Suburban stops at all stations, may turn back at MED
                if self.rng.random() < 0.35:
                    cut = ordered_station_ids.index("MED") + 1 if direction == Direction.UP else len(ordered_station_ids)
                    sub_corridor = ordered_station_ids[:cut]
                else:
                    sub_corridor = ordered_station_ids
                commercial_stops = set(sub_corridor)
                prefix = "SUB"
            else:  # PASSENGER
                sub_corridor = ordered_station_ids
                commercial_stops = set(sub_corridor)
                prefix = "PAS"

            train_id = f"{prefix}-{train_num}"
            train_name = f"{chosen_class.value} {train_num}"

            # Compute route timetable across ALL consecutive blocks in sub_corridor
            stops: List[TrainStop] = []
            cur_time = start_sec

            for i, st_id in enumerate(sub_corridor):
                st_node = self.corridor.get_station(st_id)
                is_commercial = st_id in commercial_stops

                if is_commercial:
                    base_dwell = st_node.min_dwell_sec.get(chosen_class, 120) if st_node else 120
                    dwell = base_dwell if (i == 0 or i == len(sub_corridor) - 1) else base_dwell + self.rng.randint(0, 30)
                else:
                    dwell = 0  # Non-stop run-through

                arr_time = cur_time
                dep_time = cur_time if (i == 0) else cur_time + dwell
                if i == 0:
                    arr_time = dep_time - dwell

                stops.append(TrainStop(
                    station_id=st_id,
                    scheduled_arrival_sec=arr_time,
                    scheduled_departure_sec=dep_time,
                    min_dwell_sec=dwell,
                    platform_pref=self.rng.randint(1, max(1, st_node.platforms if st_node else 1)),
                ))

                # Traverse to next consecutive block
                if i < len(sub_corridor) - 1:
                    next_st = sub_corridor[i + 1]
                    block = self.corridor.get_block(st_id, next_st)
                    if block:
                        base_time = block.min_runtime_sec(chosen_class)
                        # Small realistic noise (jitter)
                        noise = self.rng.randint(-5, 15)
                        block_time = max(60, base_time + noise)
                    else:
                        block_time = 400
                    cur_time = dep_time + block_time

            trains.append(TrainRun(
                id=train_id,
                name=train_name,
                train_class=chosen_class,
                direction=direction,
                stops=stops,
                origin=stops[0].station_id,
                destination=stops[-1].station_id,
            ))

        return trains

    def to_json(self, trains: List[TrainRun]) -> str:
        """Serializes the timetable to JSON format."""
        data = []
        for t in trains:
            data.append({
                "id": t.id,
                "name": t.name,
                "class": t.train_class.value,
                "direction": t.direction.value,
                "origin": t.origin,
                "destination": t.destination,
                "weight": t.weight,
                "stops": [
                    {
                        "station_id": s.station_id,
                        "scheduled_arrival_sec": s.scheduled_arrival_sec,
                        "scheduled_departure_sec": s.scheduled_departure_sec,
                        "min_dwell_sec": s.min_dwell_sec,
                        "platform_pref": s.platform_pref,
                    }
                    for s in t.stops
                ]
            })
        return json.dumps(data, indent=2)
