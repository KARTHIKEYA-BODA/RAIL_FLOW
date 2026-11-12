import { useState, useMemo, useRef, useEffect } from 'react';
import type { ScheduleEntry, Station, Train, ConflictItem } from '../../types/railway';
import type { TrainPosition } from './NetworkMap';
import { formatTime } from '../../lib/dateTimeUtils';
import { calculateDelayMinutes, getTrainById } from '../../lib/scheduleUtils';
import {
  AlertTriangle,
  Info,
  Clock,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
} from 'lucide-react';

export interface MareyChartProps {
  schedule: ScheduleEntry[];
  previousSchedule?: ScheduleEntry[];
  trains: Train[];
  stations: Station[];
  conflicts?: ConflictItem[];
  trainPositions?: TrainPosition[];
  activeMaintenance?: Array<{ section_id: string; duration_minutes: number; start_time: string }>;
  activeDisruptions?: Array<{ type: string; train_id?: string; block_id?: string; description?: string }>;
  now?: Date;
  onSelectTrain?: (trainId: string, entry?: ScheduleEntry) => void;
  onResolveConflict?: (conflictId: string) => void;
  stationFocus?: string;
  onSelectStation?: (stationId: string) => void;
}

interface TrajectoryPoint {
  x: number; // percentage (can be < 0 or > 100 for proper boundary clipping)
  y: number; // percentage along vertical station axis
  stationId: string;
  timeMs: number;
  platform: number;
  type: 'arrival' | 'departure';
}

interface TrainTrajectory {
  trainId: string;
  train?: Train;
  category: string;
  direction: 'UP' | 'DOWN';
  isDelayed: boolean;
  delayMin: number;
  hasConflict: boolean;
  points: TrajectoryPoint[];
}

interface SectionStationConfig {
  id: string;
  name: string;
  km: number;
  platforms: number;
  loops: number;
  isJunction: boolean;
  trackToNext?: 'DOUBLE' | 'SINGLE';
}

// Canonical Secunderabad - Wadiaram 70km Corridor Stations in North-to-South layout:
// WDR at top (North, 70.0 km) -> SC at bottom (South, 0.0 km).
// In this standard orientation:
// UP trains (SC -> WDR) slope UPWARDS ↗
// DOWN trains (WDR -> SC) slope DOWNWARDS ↘
const CANONICAL_CORRIDOR: SectionStationConfig[] = [
  { id: 'WDR', name: 'Wadiaram',        km: 70.0, platforms: 3, loops: 2, isJunction: false },
  { id: 'ME',  name: 'Masaipet',        km: 56.8, platforms: 2, loops: 2, isJunction: false, trackToNext: 'SINGLE' },
  { id: 'MOB', name: 'Manoharabad Jn',  km: 42.5, platforms: 2, loops: 2, isJunction: true,  trackToNext: 'SINGLE' },
  { id: 'MED', name: 'Medchal',         km: 28.0, platforms: 2, loops: 2, isJunction: false, trackToNext: 'SINGLE' },
  { id: 'BMO', name: 'Bolarum',         km: 14.2, platforms: 3, loops: 2, isJunction: false, trackToNext: 'SINGLE' },
  { id: 'MJF', name: 'Malkajgiri Jn',   km: 6.5,  platforms: 3, loops: 1, isJunction: true,  trackToNext: 'DOUBLE' },
  { id: 'SC',  name: 'Secunderabad Jn', km: 0.0,  platforms: 6, loops: 3, isJunction: true,  trackToNext: 'DOUBLE' },
];

export function MareyChart({
  schedule,
  previousSchedule = [],
  trains,
  stations,
  conflicts = [],
  activeMaintenance = [],
  activeDisruptions = [],
  now = new Date(),
  onSelectTrain,
  onResolveConflict,
  stationFocus = 'ALL',
  onSelectStation,
}: MareyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Layout mode: 'schematic' (equidistant station lanes) vs 'physical' (proportional km)
  const [layoutMode, setLayoutMode] = useState<'schematic' | 'physical'>('schematic');

  // Time window duration: 1.5h, 2h, 4h, or full day (24h)
  const [timeWindowHours, setTimeWindowHours] = useState<number>(2);

  // Train category filter
  const [filterType, setFilterType] = useState<string>('all');

  // Direction filter
  const [directionFilter, setDirectionFilter] = useState<'all' | 'UP' | 'DOWN'>('all');

  // Selected & hovered train
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [hoveredTrain, setHoveredTrain] = useState<{
    trainId: string;
    category: string;
    direction: string;
    delayMin: number;
    nearestStation: string;
    platform: number;
    timeText: string;
    x: number;
    y: number;
  } | null>(null);

  // Compute active schedule time bounds to intelligently set default view
  const scheduleTimeBounds = useMemo(() => {
    if (!schedule || schedule.length === 0) {
      const fallbackMs = now.getTime();
      return { minMs: fallbackMs - 3600000, maxMs: fallbackMs + 3600000, hasData: false };
    }
    let minMs = Infinity;
    let maxMs = -Infinity;
    schedule.forEach((entry) => {
      const arr = Date.parse(entry.actual_arrival);
      const dep = Date.parse(entry.actual_departure);
      if (Number.isFinite(arr)) {
        if (arr < minMs) minMs = arr;
        if (arr > maxMs) maxMs = arr;
      }
      if (Number.isFinite(dep)) {
        if (dep < minMs) minMs = dep;
        if (dep > maxMs) maxMs = dep;
      }
    });
    return { minMs, maxMs, hasData: true };
  }, [schedule, now]);

  // Live simulation ticking clock
  const [simClockMs, setSimClockMs] = useState<number>(() => now.getTime());
  const [isSimPlaying, setIsSimPlaying] = useState<boolean>(true);

  useEffect(() => {
    if (!isSimPlaying) return;
    const interval = setInterval(() => {
      setSimClockMs((prev) => prev + 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [isSimPlaying]);

  // View center time state
  const [viewCenterTimeMs, setViewCenterTimeMs] = useState<number>(() => {
    const nowMs = now.getTime();
    if (scheduleTimeBounds.hasData && (nowMs < scheduleTimeBounds.minMs - 3600000 || nowMs > scheduleTimeBounds.maxMs + 3600000)) {
      return scheduleTimeBounds.minMs + 3600000;
    }
    return nowMs;
  });

  // Drag-to-Pan & Wheel Zoom Handlers
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartCenterTimeRef = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, select, input, [role="button"]')) return;
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartCenterTimeRef.current = viewCenterTimeMs;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartXRef.current;
    const containerWidth = containerRef.current?.clientWidth || 800;
    const dtMs = -(dx / containerWidth) * timeSpanMs;
    setViewCenterTimeMs(dragStartCenterTimeRef.current + dtMs);
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) > 15) {
      if (e.deltaY > 0) {
        setTimeWindowHours((prev) => Math.min(8, prev + 0.5));
      } else {
        setTimeWindowHours((prev) => Math.max(1, prev - 0.5));
      }
    }
  };

  // Keep view center updated if schedule changes significantly from empty to populated
  useEffect(() => {
    if (scheduleTimeBounds.hasData) {
      const nowMs = now.getTime();
      if (nowMs >= scheduleTimeBounds.minMs - 1800000 && nowMs <= scheduleTimeBounds.maxMs + 1800000) {
        setViewCenterTimeMs(nowMs);
      } else {
        setViewCenterTimeMs(scheduleTimeBounds.minMs + 3600000);
      }
    }
  }, [scheduleTimeBounds.hasData, scheduleTimeBounds.minMs, scheduleTimeBounds.maxMs]);

  // Calculate visible time window bounds [tMin, tMax]
  const timeSpanMs = timeWindowHours * 3600 * 1000;
  // Center is at 35% from left so controllers see more future ahead
  const tMin = viewCenterTimeMs - timeSpanMs * 0.35;
  const tMax = viewCenterTimeMs + timeSpanMs * 0.65;
  const nowMs = simClockMs;

  // Merge canonical corridor stations with dynamic props data (platforms, loop counts, names)
  const stationList = useMemo(() => {
    const stationMap = new Map<string, Station>();
    (stations || []).forEach((s) => stationMap.set(s.id, s));

    // Check if any train in schedule uses HYB or KCG
    const usesKCG = schedule.some((e) => e.station_id === 'KCG');
    const usesHYB = schedule.some((e) => e.station_id === 'HYB');

    const list: SectionStationConfig[] = CANONICAL_CORRIDOR.map((st) => {
      const live = stationMap.get(st.id);
      return {
        ...st,
        name: live?.station_name || st.name,
        platforms: live?.platforms ?? st.platforms,
        loops: live?.passing_loops ?? st.loops,
        km: live?.km ?? st.km,
      };
    });

    // If KCG or HYB appear in active schedule, place them south of SC (-8.4 km and -9.8 km)
    if (usesKCG) {
      const liveKCG = stationMap.get('KCG');
      list.push({
        id: 'KCG',
        name: liveKCG?.station_name || 'Kacheguda',
        km: -8.4,
        platforms: liveKCG?.platforms ?? 2,
        loops: liveKCG?.passing_loops ?? 1,
        isJunction: true,
      });
    }
    if (usesHYB) {
      const liveHYB = stationMap.get('HYB');
      list.push({
        id: 'HYB',
        name: liveHYB?.station_name || 'Hyderabad Deccan',
        km: -9.8,
        platforms: liveHYB?.platforms ?? 3,
        loops: liveHYB?.passing_loops ?? 1,
        isJunction: true,
      });
    }

    return list;
  }, [stations, schedule]);

  // Build station ID -> vertical percentage (0% to 100%) mapping
  const stationYMap = useMemo(() => {
    const map = new Map<string, number>();
    const n = stationList.length;

    if (layoutMode === 'schematic') {
      // Equidistant layout: every station gets its own equal-height horizontal lane
      // Top padding 6%, bottom padding 6%, remaining 88% split evenly across (n - 1)
      const topPad = 6;
      const usable = 88;
      stationList.forEach((st, idx) => {
        const y = n === 1 ? 50 : topPad + (idx / (n - 1)) * usable;
        map.set(st.id, y);
      });
    } else {
      // Physical proportional layout with guaranteed minimum spacing
      const minKm = stationList[stationList.length - 1].km;
      const maxKm = stationList[0].km;
      const kmRange = Math.max(1, maxKm - minKm);
      const topPad = 8;
      const usable = 84;
      stationList.forEach((st) => {
        // WDR (high km) at top (pad), SC (0 km) at bottom
        const ratio = (maxKm - st.km) / kmRange;
        const y = topPad + ratio * usable;
        map.set(st.id, y);
      });
    }

    return map;
  }, [stationList, layoutMode]);

  // Convert time to percentage without artificial 0..100 clamping
  // This allows SVG line clipping to preserve exact mathematical slopes
  const timeToPct = (timeStrOrMs: string | number) => {
    const ms = typeof timeStrOrMs === 'string' ? Date.parse(timeStrOrMs) : timeStrOrMs;
    return ((ms - tMin) / timeSpanMs) * 100;
  };

  const nowPct = timeToPct(nowMs);

  // Time grid ticks
  const timeTicks = useMemo(() => {
    const ticks: { ms: number; pct: number; label: string; isHour: boolean }[] = [];
    const intervalMinutes = timeWindowHours <= 2 ? 15 : timeWindowHours <= 4 ? 30 : 60;
    const intervalMs = intervalMinutes * 60 * 1000;
    const startMs = Math.floor(tMin / intervalMs) * intervalMs;
    const endMs = Math.ceil(tMax / intervalMs) * intervalMs;

    for (let t = startMs; t <= endMs; t += intervalMs) {
      const d = new Date(t);
      const isHour = d.getMinutes() === 0;
      ticks.push({
        ms: t,
        pct: timeToPct(t),
        label: formatTime(d.toISOString()),
        isHour,
      });
    }
    return ticks;
  }, [tMin, tMax, timeSpanMs, timeWindowHours]);

  // Conflict index for quick lookup
  const conflictIds = useMemo(() => {
    const set = new Set<string>();
    (conflicts || []).forEach((c) => (c.trains_involved || []).forEach((t) => set.add(t)));
    return set;
  }, [conflicts]);

  // Build train trajectories
  const trajectories = useMemo(() => {
    const trainMap = new Map<string, TrajectoryPoint[]>();

    schedule.forEach((entry) => {
      const y = stationYMap.get(entry.station_id);
      if (y === undefined) return;

      const arrMs = Date.parse(entry.actual_arrival);
      const depMs = Date.parse(entry.actual_departure);

      if (!Number.isFinite(arrMs) || !Number.isFinite(depMs)) return;

      const arrX = timeToPct(arrMs);
      const depX = timeToPct(depMs);

      if (!trainMap.has(entry.train_id)) {
        trainMap.set(entry.train_id, []);
      }

      const list = trainMap.get(entry.train_id)!;
      list.push({
        x: arrX,
        y,
        stationId: entry.station_id,
        timeMs: arrMs,
        platform: entry.assigned_platform,
        type: 'arrival',
      });
      list.push({
        x: depX,
        y,
        stationId: entry.station_id,
        timeMs: depMs,
        platform: entry.assigned_platform,
        type: 'departure',
      });
    });

    const result: TrainTrajectory[] = [];
    trainMap.forEach((points, trainId) => {
      points.sort((a, b) => a.timeMs - b.timeMs);
      const t = getTrainById(trains, trainId);
      const isConflicted = conflictIds.has(trainId);
      const delayMin = t?.scheduled_arrival
        ? calculateDelayMinutes(
            schedule.find((s) => s.train_id === trainId)?.actual_arrival,
            t.scheduled_arrival
          )
        : 0;

      // Determine direction: if first station km < last station km => UP (SC -> WDR)
      const firstSt = points[0]?.stationId;
      const lastSt = points[points.length - 1]?.stationId;
      const firstKm = stationList.find((s) => s.id === firstSt)?.km ?? 0;
      const lastKm = stationList.find((s) => s.id === lastSt)?.km ?? 70;
      const direction: 'UP' | 'DOWN' = lastKm >= firstKm ? 'UP' : 'DOWN';

      result.push({
        trainId,
        train: t,
        category: t?.type || (trainId.startsWith('EXP') ? 'Express' : trainId.startsWith('SUB') ? 'Suburban' : trainId.startsWith('FRT') ? 'Freight' : 'Passenger'),
        direction,
        isDelayed: delayMin > 2,
        delayMin,
        hasConflict: isConflicted,
        points,
      });
    });

    return result;
  }, [schedule, trains, conflictIds, stationYMap, stationList, tMin, timeSpanMs]);

  // Filter trajectories
  const filteredTrajectories = useMemo(() => {
    return trajectories.filter((traj) => {
      if (filterType !== 'all' && traj.category.toLowerCase() !== filterType.toLowerCase()) {
        return false;
      }
      if (directionFilter !== 'all' && traj.direction !== directionFilter) {
        return false;
      }
      if (stationFocus !== 'ALL') {
        const touchesStation = traj.points.some((p) => p.stationId === stationFocus);
        if (!touchesStation) return false;
      }
      return true;
    });
  }, [trajectories, filterType, directionFilter, stationFocus]);

  // Ghost trajectories for previous schedule comparison
  const ghostTrajectories = useMemo(() => {
    if (!previousSchedule || previousSchedule.length === 0) return [];
    const map = new Map<string, TrajectoryPoint[]>();
    previousSchedule.forEach((entry) => {
      const y = stationYMap.get(entry.station_id);
      if (y === undefined) return;
      const arrMs = Date.parse(entry.actual_arrival);
      const depMs = Date.parse(entry.actual_departure);
      if (!Number.isFinite(arrMs) || !Number.isFinite(depMs)) return;
      if (!map.has(entry.train_id)) map.set(entry.train_id, []);
      const list = map.get(entry.train_id)!;
      list.push({ x: timeToPct(arrMs), y, stationId: entry.station_id, timeMs: arrMs, platform: entry.assigned_platform, type: 'arrival' });
      list.push({ x: timeToPct(depMs), y, stationId: entry.station_id, timeMs: depMs, platform: entry.assigned_platform, type: 'departure' });
    });
    const result: Array<{ trainId: string; points: TrajectoryPoint[] }> = [];
    map.forEach((points, trainId) => {
      points.sort((a, b) => a.timeMs - b.timeMs);
      result.push({ trainId, points });
    });
    return result;
  }, [previousSchedule, stationYMap, tMin, timeSpanMs]);

  // Ripple dependency chain for selected train
  const rippleData = useMemo(() => {
    if (!selectedTrainId) return null;
    const traj = trajectories.find((t) => t.trainId === selectedTrainId);
    const affectedTrains = conflicts
      .filter((c) => c.trains_involved?.includes(selectedTrainId))
      .flatMap((c) => c.trains_involved || [])
      .filter((id) => id !== selectedTrainId);

    return {
      trainId: selectedTrainId,
      train: traj?.train,
      category: traj?.category || 'Express',
      direction: traj?.direction || 'UP',
      isConflicted: traj?.hasConflict,
      affectedTrains,
      delayMin: traj?.delayMin || 0,
      points: traj?.points || [],
    };
  }, [selectedTrainId, trajectories, conflicts]);

  // Helper: jump to now or active conflict
  const jumpToNow = () => setViewCenterTimeMs(nowMs);
  const shiftTime = (minutes: number) => setViewCenterTimeMs((prev) => prev + minutes * 60 * 1000);

  // Train category styling helper
  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'express':
        return '#f2b84b'; // RailFlow Amber / Gold
      case 'suburban':
      case 'local':
      case 'commuter':
        return '#93b8ff'; // RailFlow Commuter Blue
      case 'freight':
        return '#ff6a5c'; // RailFlow Cargo Red
      case 'passenger':
        return '#c0a2ff'; // Soft Purple
      default:
        return '#f2b84b';
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-[#141518]/90 overflow-hidden font-sans">
      {/* Controls & Filters Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#16181d]/80 px-4 py-2.5">
        {/* Left Side: Layout, Time Window, Scrubbing */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Layout Mode Toggle */}
          <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5">
            <button
              type="button"
              onClick={() => setLayoutMode('schematic')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                layoutMode === 'schematic'
                  ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
              title="Equidistant stations for clean lane visibility without label overlaps"
            >
              Schematic Lanes
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('physical')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                layoutMode === 'physical'
                  ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
              title="Proportional to real physical kilometers"
            >
              Physical Km
            </button>
          </div>

          {/* Time Window Selector */}
          <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5">
            {[
              { label: '90m', h: 1.5 },
              { label: '2h', h: 2 },
              { label: '4h', h: 4 },
            ].map((w) => (
              <button
                key={w.label}
                type="button"
                onClick={() => setTimeWindowHours(w.h)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  timeWindowHours === w.h
                    ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold shadow-sm'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>

          {/* Time Scrubbing & Simulation Playback Controls */}
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 px-1 py-0.5">
            <button
              type="button"
              onClick={() => setIsSimPlaying(!isSimPlaying)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-xs font-semibold transition-all cursor-pointer ${
                isSimPlaying
                  ? 'bg-[#55e0a3]/15 text-[#55e0a3] border border-[#55e0a3]/30'
                  : 'bg-[#f2b84b]/15 text-[#f2b84b] border border-[#f2b84b]/30'
              }`}
              title={isSimPlaying ? 'Pause live clock' : 'Play live clock'}
            >
              {isSimPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              <span>{isSimPlaying ? 'LIVE' : 'PAUSED'}</span>
            </button>
            <button
              type="button"
              onClick={() => shiftTime(-30)}
              className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              title="Rewind 30 minutes"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={jumpToNow}
              className="rounded px-2 py-0.5 font-mono text-xs font-bold text-[#f2b84b] hover:bg-white/10 transition-colors cursor-pointer"
              title="Center view on current time"
            >
              NOW
            </button>
            <button
              type="button"
              onClick={() => shiftTime(30)}
              className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              title="Advance 30 minutes"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Right Side: Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Train Category Filter */}
          <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5">
            {['all', 'Express', 'Suburban', 'Passenger', 'Freight'].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterType(cat)}
                className={`rounded-md px-2.5 py-1 text-xs capitalize transition-all cursor-pointer ${
                  filterType === cat
                    ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold shadow-sm'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Direction Filter */}
          <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5">
            {(['all', 'UP', 'DOWN'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => setDirectionFilter(dir)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  directionFilter === dir
                    ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold shadow-sm'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {dir === 'all' ? 'Both Dirs' : dir}
              </button>
            ))}
          </div>

          {/* Active Filter Pill with 1-click Reset */}
          {(stationFocus !== 'ALL' || filterType !== 'all' || directionFilter !== 'all') && (
            <div className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] border border-white/15 px-2.5 py-1 text-xs text-white/80">
              <span>
                Filtered: {stationFocus !== 'ALL' ? `Stn ${stationFocus} · ` : ''}
                {filterType !== 'all' ? `${filterType} · ` : ''}
                {directionFilter !== 'all' ? `${directionFilter}` : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  onSelectStation?.('ALL');
                  setFilterType('all');
                  setDirectionFilter('all');
                }}
                className="ml-1 text-[#ff6a5c] hover:text-white font-bold cursor-pointer"
                title="Reset all filters to show entire corridor"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Ripple View Banner (Selected Train Info) */}
      {rippleData && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2 text-xs">
          <div className="flex items-center gap-2.5">
            <span
              className="rounded px-2 py-0.5 font-mono text-xs font-bold"
              style={{
                backgroundColor: `${getCategoryColor(rippleData.category)}25`,
                color: getCategoryColor(rippleData.category),
                border: `1px solid ${getCategoryColor(rippleData.category)}60`,
              }}
            >
              {rippleData.trainId}
            </span>
            <span className="font-semibold text-white">
              {rippleData.category} · Direction: {rippleData.direction === 'UP' ? 'UP (SC → WDR)' : 'DOWN (WDR → SC)'}
            </span>
            <span className="text-white/30">|</span>
            <span className={rippleData.delayMin > 2 ? 'text-[#f2b84b] font-semibold' : 'text-[#55e0a3]'}>
              {rippleData.delayMin > 2 ? `⏱ +${Math.round(rippleData.delayMin)}m Delay` : '✓ On-time scheduled path'}
            </span>
            {rippleData.isConflicted && (
              <span className="rounded bg-red-950/80 px-2 py-0.5 font-semibold text-red-300 border border-red-500/50">
                Safety conflict predicted with: {rippleData.affectedTrains.join(', ')}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedTrainId(null);
              onSelectTrain?.('');
            }}
            className="rounded px-2.5 py-1 text-xs text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          >
            Clear selection ✕
          </button>
        </div>
      )}

      {/* Main Timetable Body: Left Station Sidebar + Right SVG Time-Distance Canvas */}
      <div className="flex w-full select-none" style={{ minHeight: '520px' }}>
        {/* Left Column: Dedicated Station Axis (Zero Label Clutter) */}
        <div className="w-[185px] sm:w-[210px] shrink-0 border-r border-white/10 bg-[#16171a] relative z-10 flex flex-col justify-between py-2">
          {/* Header of station column */}
          <div className="px-3 pb-2 border-b border-white/10 flex items-center justify-between text-[11px] font-semibold text-white/40 uppercase tracking-wider">
            <span>Station / Infrastructure</span>
            <span>Km</span>
          </div>

          {/* Station Rows */}
          <div className="relative flex-1 flex flex-col justify-between py-1">
            {stationList.map((st) => {
              const isFocused = stationFocus === st.id;
              const hasSingleTrackNext = st.trackToNext === 'SINGLE';

              return (
                <div
                  key={st.id}
                  onClick={() => onSelectStation?.(isFocused ? 'ALL' : st.id)}
                  className={`group relative flex cursor-pointer items-center justify-between px-3 py-1.5 transition-all hover:bg-white/[0.04] ${
                    isFocused ? 'bg-white/[0.06] border-l-2 border-[#f2b84b]' : ''
                  }`}
                  style={{ minHeight: '44px' }}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-white/[0.05] px-1.5 py-0.2 font-mono text-[11px] font-bold text-white/90 border border-white/12">
                        {st.id}
                      </span>
                      <span className="truncate text-xs font-semibold text-white group-hover:text-[#f2b84b]">
                        {st.name.replace(' Junction', ' Jn')}
                      </span>
                    </div>
                    <span className="text-[11px] text-white/50 mt-0.5">
                      {st.platforms} PF · {st.loops} {st.loops === 1 ? 'Loop' : 'Loops'}
                      {hasSingleTrackNext && (
                        <span className="ml-1 text-[10px] font-mono font-medium text-[#f2b84b]">
                          · 1-Track
                        </span>
                      )}
                    </span>
                  </div>

                  <span className="font-mono text-xs tabular-nums text-white/50">
                    {st.km.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Bottom legend label for axis */}
          <div className="px-3 pt-2 border-t border-white/10 text-[11px] text-white/40">
            Click station to filter
          </div>
        </div>

        {/* Right Area: Interactive Time-Distance Stringline Canvas */}
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          className={`relative flex-1 bg-[#141518] overflow-hidden ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          title="Drag horizontally to pan time · Mouse wheel to zoom"
        >
          {/* Time Header Grid Ticks */}
          <div className="absolute top-0 left-0 right-0 h-7 border-b border-white/10 bg-[#16171a]/90 backdrop-blur z-20 pointer-events-none flex items-center">
            {timeTicks.map((tick) => {
              if (tick.pct < -5 || tick.pct > 105) return null;
              return (
                <div
                  key={`tick-top-${tick.ms}`}
                  className="absolute -translate-x-1/2 flex flex-col items-center"
                  style={{ left: `${tick.pct}%` }}
                >
                  <span className={`text-xs tabular-nums font-mono ${tick.isHour ? 'font-semibold text-white' : 'text-white/50'}`}>
                    {tick.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Horizontal Station Track Bands & Lines */}
          {stationList.map((st, idx) => {
            const yPct = stationYMap.get(st.id) ?? 0;
            const isAlt = idx % 2 === 1;
            const isFocused = stationFocus === st.id;

            return (
              <div
                key={`band-${st.id}`}
                className={`absolute left-0 right-0 pointer-events-none z-0 ${
                  isFocused ? 'bg-[#f2b84b]/10' : isAlt ? 'bg-white/[0.015]' : 'bg-transparent'
                }`}
                style={{
                  top: `${Math.max(0, yPct - 6)}%`,
                  height: '12%',
                }}
              >
                {/* Horizontal Track Centerline */}
                <div
                  className="absolute left-0 right-0 border-b border-white/[0.06]"
                  style={{ top: '50%' }}
                />
              </div>
            );
          })}

          {/* Vertical Time Grid Lines */}
          {timeTicks.map((tick) => {
            if (tick.pct < 0 || tick.pct > 100) return null;
            return (
              <div
                key={`grid-line-${tick.ms}`}
                className={`absolute top-0 bottom-0 pointer-events-none z-0 ${
                  tick.isHour ? 'border-l border-white/[0.12]' : 'border-l border-dashed border-white/[0.05]'
                }`}
                style={{ left: `${tick.pct}%` }}
              />
            );
          })}

          {/* NOW Vertical Timeline Bar */}
          {nowPct >= 0 && nowPct <= 100 && (
            <div
              className="absolute top-0 bottom-0 border-l-2 border-[#f2b84b] z-30 pointer-events-none shadow-[0_0_12px_rgba(242,184,75,0.7)]"
              style={{ left: `${nowPct}%` }}
            >
              <div className="absolute top-1.5 -translate-x-1/2 rounded bg-[#f2b84b] px-2.5 py-0.5 text-xs font-semibold text-[#1c1710] font-mono shadow-md whitespace-nowrap">
                NOW {formatTime(now.toISOString())}
              </div>
            </div>
          )}

          {/* Future Schedule Subtle Tint to the Right of NOW */}
          {nowPct >= 0 && nowPct <= 100 && (
            <div
              className="absolute top-0 bottom-0 right-0 bg-white/[0.01] border-l border-white/10 pointer-events-none z-0"
              style={{ left: `${nowPct}%` }}
            />
          )}

          {/* SVG Trajectory Stringlines Layer */}
          <svg className="absolute inset-0 h-full w-full z-20 pointer-events-none overflow-hidden">
            <defs>
              {/* Maintenance Hatch Pattern */}
              <pattern
                id="mareyMaintHatch"
                width="10"
                height="10"
                patternTransform="rotate(45 0 0)"
                patternUnits="userSpaceOnUse"
              >
                <line x1="0" y1="0" x2="0" y2="10" stroke="#f7c06d" strokeWidth="2.5" strokeOpacity="0.45" />
              </pattern>

              {/* Glowing shadow filters */}
              <filter id="glowGold" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#f2b84b" floodOpacity="0.8" />
              </filter>
              <filter id="glowBlue" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#93b8ff" floodOpacity="0.8" />
              </filter>
              <filter id="glowSalmon" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#ff6a5c" floodOpacity="0.9" />
              </filter>
            </defs>

            {/* 1. Hard Maintenance Blocks */}
            {activeMaintenance.map((m, idx) => {
              const [stA, stB] = m.section_id.split('_');
              const yA = stationYMap.get(stA) ?? 30;
              const yB = stationYMap.get(stB) ?? 50;
              const topY = Math.min(yA, yB);
              const heightY = Math.abs(yB - yA);

              // Calculate start and end time
              const [h, mn] = (m.start_time || '02:00').split(':').map(Number);
              const mDate = new Date(now);
              mDate.setHours(h, mn, 0, 0);
              const startMs = mDate.getTime();
              const endMs = startMs + m.duration_minutes * 60 * 1000;
              const x1 = timeToPct(startMs);
              const x2 = timeToPct(endMs);

              return (
                <g key={`maint-block-${idx}`}>
                  <rect
                    x={`${x1}%`}
                    y={`${topY}%`}
                    width={`${Math.max(2, x2 - x1)}%`}
                    height={`${Math.max(4, heightY)}%`}
                    fill="url(#mareyMaintHatch)"
                    stroke="#f2b84b"
                    strokeWidth="1.5"
                    strokeDasharray="4 2"
                  />
                  <text
                    x={`${x1 + 1}%`}
                    y={`${topY + 3.5}%`}
                    fill="#f2b84b"
                    fontSize="11"
                    fontFamily="Inter, system-ui, sans-serif"
                    fontWeight="700"
                  >
                    🚧 TRACK BLOCK: {m.section_id} ({m.duration_minutes}m)
                  </text>
                </g>
              );
            })}

            {/* Active Disruption Markers */}
            {activeDisruptions.map((d, idx) => {
              const stId = d.block_id?.split('_')[0] || 'SC';
              const y = stationYMap.get(stId) ?? 50;
              return (
                <g
                  key={`disrupt-marker-${idx}`}
                  className="cursor-pointer"
                  onClick={() => onResolveConflict?.(d.block_id || d.train_id || '')}
                >
                  <circle
                    cx={`${nowPct}%`}
                    cy={`${y}%`}
                    r="8"
                    fill="#ff6a5c"
                    stroke="#141518"
                    strokeWidth="2"
                  />
                  <title>{d.type}: {d.description || d.block_id}</title>
                </g>
              );
            })}

            {/* 2. Previous Plan Ghost Trajectories (Dashed) */}
            {ghostTrajectories.map((gt) => (
              <g key={`ghost-traj-${gt.trainId}`} opacity={0.35}>
                {gt.points.map((p, i) => {
                  if (i === gt.points.length - 1) return null;
                  const pNext = gt.points[i + 1];
                  return (
                    <line
                      key={`ghost-line-${gt.trainId}-${i}`}
                      x1={`${p.x}%`}
                      y1={`${p.y}%`}
                      x2={`${pNext.x}%`}
                      y2={`${pNext.y}%`}
                      stroke="#8a909d"
                      strokeWidth="1.3"
                      strokeDasharray="4 4"
                    />
                  );
                })}
              </g>
            ))}

            {/* 3. Active Train Trajectories */}
            {filteredTrajectories.map((traj) => {
              const isSelected = selectedTrainId === traj.trainId;
              const isHovered = hoveredTrain?.trainId === traj.trainId;
              const hasConflict = traj.hasConflict;
              const isDelayed = traj.isDelayed;

              // Color determination
              let strokeColor = getCategoryColor(traj.category);
              if (hasConflict) strokeColor = '#ff6a5c'; // Cargo Red / Conflict
              else if (isDelayed) strokeColor = '#f2b84b'; // Warm Amber

              // Thickness & Opacity
              const strokeWidth = isSelected || isHovered ? 3.2 : hasConflict ? 2.2 : 1.6;
              const opacity = selectedTrainId ? (isSelected ? 1.0 : 0.2) : hoveredTrain ? (isHovered ? 1.0 : 0.3) : 0.88;

              return (
                <g
                  key={`traj-group-${traj.trainId}`}
                  style={{
                    filter: isHovered || isSelected ? (hasConflict ? 'url(#glowSalmon)' : isSelected ? 'url(#glowGold)' : 'url(#glowBlue)') : undefined,
                  }}
                >
                  {traj.points.map((p1, i) => {
                    if (i === traj.points.length - 1) return null;
                    const p2 = traj.points[i + 1];
                    const isDwell = p1.stationId === p2.stationId;
                    const isFuture = p1.timeMs > nowMs;

                    if (isDwell) {
                      // Platform / Loop Dwell Horizontal Bar
                      return (
                        <g key={`dwell-seg-${traj.trainId}-${i}`}>
                          <line
                            x1={`${p1.x}%`}
                            y1={`${p1.y}%`}
                            x2={`${p2.x}%`}
                            y2={`${p2.y}%`}
                            stroke={strokeColor}
                            strokeWidth={strokeWidth + 3.0}
                            strokeLinecap="round"
                            opacity={opacity}
                          />
                          {/* Loop Berth Indicator */}
                          {p1.platform > 0 && Math.abs(p2.x - p1.x) > 2.5 && (
                            <text
                              x={`${(p1.x + p2.x) / 2}%`}
                              y={`${p1.y - 1.5}%`}
                              textAnchor="middle"
                              fill={strokeColor}
                              fontSize="9"
                              fontWeight="700"
                              opacity={opacity}
                            >
                              P{p1.platform}
                            </text>
                          )}
                        </g>
                      );
                    }

                    // Inter-station running line (solid past, dashed future)
                    return (
                      <line
                        key={`run-seg-${traj.trainId}-${i}`}
                        x1={`${p1.x}%`}
                        y1={`${p1.y}%`}
                        x2={`${p2.x}%`}
                        y2={`${p2.y}%`}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeDasharray={isFuture ? '5 3' : undefined}
                        opacity={opacity}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>

          {/* Interactive Trajectory Hitboxes & Non-Overlapping Train Chips */}
          <div className="absolute inset-0 z-30 pointer-events-auto">
            {filteredTrajectories.map((traj) => {
              // Find midpoint of first running segment inside visible time window
              const visiblePts = traj.points.filter((p) => p.x >= -10 && p.x <= 110);
              if (visiblePts.length < 2) return null;

              const midIdx = Math.floor(visiblePts.length / 2);
              const ptA = visiblePts[midIdx];
              const ptB = visiblePts[Math.min(visiblePts.length - 1, midIdx + 1)];
              const rawChipX = (ptA.x + ptB.x) / 2;
              const chipY = (ptA.y + ptB.y) / 2;
              const clampedChipX = Math.min(93, Math.max(7, rawChipX));

              const isSelected = selectedTrainId === traj.trainId;
              const isHovered = hoveredTrain?.trainId === traj.trainId;
              const color = getCategoryColor(traj.category);

              return (
                <div
                  key={`chip-hit-${traj.trainId}`}
                  className="absolute cursor-pointer transition-transform"
                  style={{
                    left: `${clampedChipX}%`,
                    top: `${chipY}%`,
                    transform: 'translate(-50%, -50%)',
                    zIndex: isHovered || isSelected ? 40 : 25,
                  }}
                  onClick={() => {
                    const nextId = isSelected ? null : traj.trainId;
                    setSelectedTrainId(nextId);
                    onSelectTrain?.(nextId || '', schedule.find((s) => s.train_id === nextId));
                  }}
                  onMouseEnter={() => {
                    setHoveredTrain({
                      trainId: traj.trainId,
                      category: traj.category,
                      direction: traj.direction === 'UP' ? 'UP (SC → WDR)' : 'DOWN (WDR → SC)',
                      delayMin: traj.delayMin,
                      nearestStation: ptA.stationId,
                      platform: ptA.platform,
                      timeText: formatTime(new Date(ptA.timeMs).toISOString()),
                      x: clampedChipX,
                      y: chipY,
                    });
                  }}
                  onMouseLeave={() => setHoveredTrain(null)}
                >
                  <span
                    className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[11px] font-semibold tracking-tight shadow-lg whitespace-nowrap transition-all ${
                      traj.hasConflict
                        ? 'bg-[#ff6a5c] text-white border border-white/60 shadow-[0_0_10px_rgba(255,106,92,0.6)]'
                        : isSelected
                          ? 'bg-[#f2b84b] text-[#1c1710] ring-2 ring-white scale-110 shadow-[0_0_14px_rgba(242,184,75,0.7)]'
                          : isHovered
                            ? 'bg-white text-[#141518] scale-105 shadow-md'
                            : 'bg-[#1e2024]/90 text-white/90 border border-white/15 hover:border-[#f2b84b]'
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    {traj.trainId}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Floating Interactive Hover Tooltip */}
          {hoveredTrain && (
            <div
              className="absolute z-50 pointer-events-none rounded-xl border border-white/20 bg-[#16181d]/95 p-3.5 text-xs text-white shadow-2xl backdrop-blur-md"
              style={{
                left: `${Math.min(78, Math.max(12, hoveredTrain.x))}%`,
                top: `${Math.min(75, Math.max(10, hoveredTrain.y - 12))}%`,
                transform: 'translate(-50%, -100%)',
                minWidth: '230px',
              }}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
                <span className="font-mono font-bold text-sm text-[#f2b84b]">
                  {hoveredTrain.trainId}
                </span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90">
                  {hoveredTrain.category}
                </span>
              </div>
              <div className="space-y-1.5 text-white/70 text-[11px]">
                <div className="flex justify-between">
                  <span>Direction:</span>
                  <strong className="text-white font-medium">{hoveredTrain.direction}</strong>
                </div>
                <div className="flex justify-between">
                  <span>At Station:</span>
                  <strong className="text-white font-medium">
                    {hoveredTrain.nearestStation} · Platform {hoveredTrain.platform}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>Scheduled Time:</span>
                  <strong className="text-white font-mono">{hoveredTrain.timeText}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Status:</span>
                  <strong className={hoveredTrain.delayMin > 2 ? 'text-[#f2b84b]' : 'text-[#55e0a3]'}>
                    {hoveredTrain.delayMin > 2 ? `+${Math.round(hoveredTrain.delayMin)}m Delay` : 'On Time'}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Empty State Banner if no schedule exists */}
          {(!schedule || schedule.length === 0) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white/40 z-10">
              <Clock className="h-8 w-8 text-[#f2b84b]/60 mb-2 animate-pulse" />
              <p className="font-medium text-white text-sm">No Timetable Data Loaded</p>
              <p className="text-xs max-w-sm mt-1 text-white/50">
                Start the backend server to stream the live CP-SAT section schedule.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Footer Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 bg-[#141518]/90 px-4 py-2.5 text-xs text-white/70">
        {/* Category & Status Color Indicators */}
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm bg-[#f2b84b]" />
            <span className="text-[#f2b84b] font-medium">Express (High Priority)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm bg-[#93b8ff]" />
            <span className="text-[#93b8ff] font-medium">Suburban</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm bg-[#c0a2ff]" />
            <span className="text-[#c0a2ff] font-medium">Passenger</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm bg-[#ff6a5c]" />
            <span className="text-[#ff6a5c] font-medium">Freight</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#ff6a5c]">
            <AlertTriangle className="h-3.5 w-3.5 text-[#ff6a5c]" />
            <span className="font-semibold">Predicted Safety Conflict</span>
          </div>
          {previousSchedule.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-b border-dashed border-white/40" />
              <span>Previous Plan (Ghost)</span>
            </div>
          )}
        </div>

        {/* OCC Section Summary & Guidance */}
        <div className="flex items-center gap-2 text-[11px] text-white/60">
          <Info className="h-3.5 w-3.5 text-[#f2b84b]" />
          <span>Click any train or station to isolate movements & inspect platform dwells</span>
        </div>
      </div>
    </div>
  );
}
