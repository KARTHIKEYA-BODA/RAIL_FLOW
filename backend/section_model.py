"""
Section Infrastructure Model for PS-09 Railway Brain.
Models stations, double-track and single-track block sections,
passing loops, train classes, directions, and constraints.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Dict, List, Optional, Tuple


class TrackType(str, Enum):
    DOUBLE = "double"  # Dedicated UP and DOWN lines, headway separation
    SINGLE = "single"  # Bidirectional single line, opposing trains must meet at station loops


class Direction(str, Enum):
    UP = "UP"      # South to North (e.g., SC -> WDR)
    DOWN = "DOWN"  # North to South (e.g., WDR -> SC)


class TrainClass(str, Enum):
    EXPRESS = "Express"       # High priority, weight 3.0
    SUBURBAN = "Suburban"     # Frequent stops, weight 2.0
    PASSENGER = "Passenger"   # Regional passenger, weight 1.5
    FREIGHT = "Freight"       # Bulk/Goods, weight 1.0


CLASS_WEIGHTS: Dict[TrainClass, float] = {
    TrainClass.EXPRESS: 3.0,
    TrainClass.SUBURBAN: 2.0,
    TrainClass.PASSENGER: 1.5,
    TrainClass.FREIGHT: 1.0,
}


@dataclass
class StationNode:
    id: str
    name: str
    km: float
    platforms: int
    passing_loops: int = 1  # Loops available for overtaking or crossing
    is_junction: bool = False
    min_dwell_sec: Dict[TrainClass, int] = field(default_factory=lambda: {
        TrainClass.EXPRESS: 120,    # 2 min
        TrainClass.SUBURBAN: 60,   # 1 min
        TrainClass.PASSENGER: 120, # 2 min
        TrainClass.FREIGHT: 0,     # 0 min unless looped
    })

    @property
    def total_capacity(self) -> int:
        return self.platforms + self.passing_loops


@dataclass
class BlockSection:
    id: str
    from_station: str
    to_station: str
    length_km: float
    track_type: TrackType
    default_headway_sec: int = 180  # 3 minutes standard headway
    speed_limit_kmh: Dict[TrainClass, float] = field(default_factory=lambda: {
        TrainClass.EXPRESS: 100.0,
        TrainClass.SUBURBAN: 80.0,
        TrainClass.PASSENGER: 75.0,
        TrainClass.FREIGHT: 60.0,
    })

    def min_runtime_sec(self, train_class: TrainClass, speed_restriction_kmh: Optional[float] = None) -> int:
        speed = self.speed_limit_kmh.get(train_class, 60.0)
        if speed_restriction_kmh and speed_restriction_kmh < speed:
            speed = speed_restriction_kmh
        # Time = (distance / speed) * 3600 seconds
        return int(round((self.length_km / max(10.0, speed)) * 3600))


@dataclass
class CorridorSection:
    id: str
    name: str
    stations: List[StationNode]
    blocks: List[BlockSection]

    def get_station(self, station_id: str) -> Optional[StationNode]:
        for s in self.stations:
            if s.id == station_id:
                return s
        return None

    def get_block(self, from_st: str, to_st: str) -> Optional[BlockSection]:
        for b in self.blocks:
            if (b.from_station == from_st and b.to_station == to_st) or \
               (b.from_station == to_st and b.to_station == from_st):
                return b
        return None

    def get_ordered_stations(self, direction: Direction) -> List[str]:
        main_line = ["SC", "MJF", "BMO", "MED", "MOB", "ME", "WDR"]
        return main_line if direction == Direction.UP else list(reversed(main_line))


@dataclass
class MaintenanceBlock:
    id: str
    section_id: str           # block id (e.g. "BMO_MED")
    allowed_start_sec: int    # Start of maintenance window (sec from midnight)
    allowed_end_sec: int      # End of maintenance window
    duration_sec: int         # Required continuous track time
    scheduled_start_sec: Optional[int] = None  # Chosen optimal placement
    track_affected: str = "both"  # "UP", "DOWN", or "both"


@dataclass
class Disruption:
    id: str
    type: str  # "late_train", "loco_failure", "signal_failure", "speed_restriction"
    start_time_sec: int
    duration_sec: int
    train_id: Optional[str] = None
    station_id: Optional[str] = None
    block_id: Optional[str] = None
    speed_restriction_kmh: Optional[float] = None
    additional_headway_sec: Optional[int] = None
    description: str = ""


@dataclass
class TrainStop:
    station_id: str
    scheduled_arrival_sec: int
    scheduled_departure_sec: int
    min_dwell_sec: int
    platform_pref: Optional[int] = 1


@dataclass
class TrainRun:
    id: str
    name: str
    train_class: TrainClass
    direction: Direction
    stops: List[TrainStop]
    origin: str
    destination: str

    @property
    def weight(self) -> float:
        return CLASS_WEIGHTS.get(self.train_class, 1.0)

    @property
    def scheduled_start_sec(self) -> int:
        return self.stops[0].scheduled_departure_sec if self.stops else 0

    @property
    def scheduled_end_sec(self) -> int:
        return self.stops[-1].scheduled_arrival_sec if self.stops else 0


def create_sc_wdr_corridor() -> CorridorSection:
    """
    Builds the reference 70 km South Central Railway section:
    Secunderabad (SC) -> Malkajgiri (MJF) -> Bolarum (BMO) -> Medchal (MED) ->
    Manoharabad (MOB) -> Masaipet (ME) -> Wadiaram (WDR).
    SC-BMO is double track. BMO-WDR is single track with passing loops at stations.
    """
    stations = [
        StationNode(id="HYB", name="Hyderabad Deccan", km=-9.8, platforms=3, passing_loops=1, is_junction=True),
        StationNode(id="KCG", name="Kacheguda",        km=-8.4, platforms=2, passing_loops=1, is_junction=True),
        StationNode(id="SC",  name="Secunderabad Jn", km=0.0,  platforms=6, passing_loops=3, is_junction=True),
        StationNode(id="MJF", name="Malkajgiri Jn",   km=6.5,  platforms=3, passing_loops=1, is_junction=True),
        StationNode(id="BMO", name="Bolarum",         km=14.2, platforms=3, passing_loops=2, is_junction=False),
        StationNode(id="MED", name="Medchal",         km=28.0, platforms=2, passing_loops=2, is_junction=False),
        StationNode(id="MOB", name="Manoharabad Jn",  km=42.5, platforms=2, passing_loops=2, is_junction=True),
        StationNode(id="ME",  name="Masaipet",        km=56.8, platforms=2, passing_loops=2, is_junction=False),
        StationNode(id="WDR", name="Wadiaram",        km=70.0, platforms=3, passing_loops=2, is_junction=False),
    ]

    blocks = [
        BlockSection(id="HYB_SC",  from_station="HYB", to_station="SC",  length_km=9.8,  track_type=TrackType.DOUBLE),
        BlockSection(id="SC_KCG",  from_station="SC",  to_station="KCG", length_km=8.4,  track_type=TrackType.DOUBLE),
        BlockSection(id="HYB_KCG", from_station="HYB", to_station="KCG", length_km=4.2,  track_type=TrackType.DOUBLE),
        BlockSection(id="SC_MJF",  from_station="SC",  to_station="MJF", length_km=6.5,  track_type=TrackType.DOUBLE),
        BlockSection(id="MJF_BMO", from_station="MJF", to_station="BMO", length_km=7.7,  track_type=TrackType.DOUBLE),
        BlockSection(id="BMO_MED", from_station="BMO", to_station="MED", length_km=13.8, track_type=TrackType.SINGLE),
        BlockSection(id="MED_MOB", from_station="MED", to_station="MOB", length_km=14.5, track_type=TrackType.SINGLE),
        BlockSection(id="MOB_ME",  from_station="MOB", to_station="ME",  length_km=14.3, track_type=TrackType.SINGLE),
        BlockSection(id="ME_WDR",  from_station="ME",  to_station="WDR", length_km=13.2, track_type=TrackType.SINGLE),
    ]

    return CorridorSection(
        id="SC_WDR_SUBDIV",
        name="Secunderabad - Wadiaram 70km Corridor",
        stations=stations,
        blocks=blocks,
    )
