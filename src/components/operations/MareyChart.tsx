import { useState, useMemo, useRef } from 'react';
import type { ScheduleEntry, Station, Train, ConflictItem } from '../../types/railway';
import type { TrainPosition } from './NetworkMap';
import { formatTime } from '../../lib/dateTimeUtils';
import { calculateDelayMinutes, getTrainById } from '../../lib/scheduleUtils';
import { AlertTriangle, Eye, Route, Info } from 'lucide-react';

interface MareyChartProps {
  schedule: ScheduleEntry[];
  trains: Train[];
  stations: Station[];
  conflicts: ConflictItem[];
  trainPositions?: TrainPosition[];
  now?: Date;
  onSelectTrain?: (trainId: string, entry?: ScheduleEntry) => void;
  onResolveConflict?: (conflictId: string) => void;
}

interface TrajectoryPoint {
  x: number;
  y: number;
  stationId: string;
  timeMs: number;
  platform: number;
  type: 'arrival' | 'departure';
}

interface TrainTrajectory {
  trainId: string;
  train?: Train;
  category: string;
  isDelayed: boolean;
  delayMin: number;
  hasConflict: boolean;
  points: TrajectoryPoint[];
}

// Kilometric station positioning along Hyderabad corridor
const STATION_KM: Record<string, number> = {
  HYB: 0.0,
  SC: 9.8,
  KCG: 18.2,
};
const MAX_KM = 18.2;

export function MareyChart({
  schedule,
  trains,
  stations,
  conflicts,
  trainPositions: _trainPositions = [],
  now = new Date(),
  onSelectTrain,
  onResolveConflict,
}: MareyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nowMs = now.getTime();

  // Time window: 20 min in the past to 70 min in future (90 min span)
  const windowBeforeMs = 20 * 60 * 1000;
  const windowAfterMs = 70 * 60 * 1000;
  const tMin = nowMs - windowBeforeMs;
  const tMax = nowMs + windowAfterMs;
  const timeSpan = tMax - tMin;

  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [showPredictionUncertainty, setShowPredictionUncertainty] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [hoveredEntry, setHoveredEntry] = useState<{ trainId: string; text: string; x: number; y: number } | null>(null);

  const conflictIds = useMemo(() => {
    const set = new Set<string>();
    conflicts.forEach((c) => (c.trains_involved || []).forEach((t) => set.add(t)));
    return set;
  }, [conflicts]);

  // Convert time to percentage (0% to 100%)
  const timeToPct = (timeStrOrMs: string | number) => {
    const ms = typeof timeStrOrMs === 'string' ? new Date(timeStrOrMs).getTime() : timeStrOrMs;
    return Math.max(0, Math.min(100, ((ms - tMin) / timeSpan) * 100));
  };

  // Convert station km to vertical percentage (12% to 88%)
  const kmToY = (km: number) => {
    const topPadding = 12;
    const usableHeight = 76;
    return topPadding + (km / MAX_KM) * usableHeight;
  };

  const nowPct = timeToPct(nowMs);

  // 15-minute time grid marks
  const timeTicks = useMemo(() => {
    const ticks: { ms: number; pct: number; label: string }[] = [];
    const interval = 15 * 60 * 1000;
    const start = Math.ceil(tMin / interval) * interval;
    for (let t = start; t <= tMax; t += interval) {
      ticks.push({
        ms: t,
        pct: timeToPct(t),
        label: formatTime(new Date(t).toISOString()),
      });
    }
    return ticks;
  }, [tMin, tMax, timeSpan]);

  // Group schedule into train trajectories
  const trajectories = useMemo(() => {
    const map = new Map<string, TrajectoryPoint[]>();

    schedule.forEach((entry) => {
      const km = STATION_KM[entry.station_id] ?? 0;
      const y = kmToY(km);
      const arrMs = new Date(entry.actual_arrival).getTime();
      const depMs = new Date(entry.actual_departure).getTime();

      const arrX = timeToPct(arrMs);
      const depX = timeToPct(depMs);

      if (!map.has(entry.train_id)) {
        map.set(entry.train_id, []);
      }

      const list = map.get(entry.train_id)!;
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
    map.forEach((points, trainId) => {
      points.sort((a, b) => a.timeMs - b.timeMs);
      const t = getTrainById(trains, trainId);
      const isConflicted = conflictIds.has(trainId);
      const delayMin = t?.scheduled_arrival
        ? calculateDelayMinutes(
            schedule.find((s) => s.train_id === trainId)?.actual_arrival,
            t.scheduled_arrival
          )
        : 0;

      result.push({
        trainId,
        train: t,
        category: t?.type || 'Express',
        isDelayed: delayMin > 2,
        delayMin,
        hasConflict: isConflicted,
        points,
      });
    });

    return result;
  }, [schedule, trains, conflictIds, tMin, timeSpan]);

  // Filter trajectories
  const filteredTrajectories = useMemo(() => {
    if (filterType === 'all') return trajectories;
    return trajectories.filter((t) => t.category.toLowerCase() === filterType.toLowerCase());
  }, [trajectories, filterType]);

  const forecastConflict = useMemo(() => {
    for (const conflict of conflicts) {
      if (!conflict.station_id || !(conflict.station_id in STATION_KM)) continue;
      const arrivals = schedule.filter(e => e.station_id === conflict.station_id && conflict.trains_involved?.includes(e.train_id) && (!conflict.platform || e.assigned_platform === conflict.platform)).map(e => Date.parse(e.actual_arrival));
      const target = Math.max(...arrivals);
      if (!Number.isFinite(target) || target < tMin || target > tMax) continue;
      return { conflict, xPct: timeToPct(target), yPct: kmToY(STATION_KM[conflict.station_id]), label: formatTime(target) };
    }
    return null;
  }, [conflicts, schedule, tMin, tMax]);
  // Selected train ripple dependency chain data
  const rippleData = useMemo(() => {
    if (!selectedTrainId) return null;
    const t = getTrainById(trains, selectedTrainId);
    const isConflicted = conflictIds.has(selectedTrainId);
    const affectedTrains = conflicts
      .filter((c) => c.trains_involved?.includes(selectedTrainId))
      .flatMap((c) => c.trains_involved || [])
      .filter((id) => id !== selectedTrainId);

    return {
      trainId: selectedTrainId,
      train: t,
      isConflicted,
      affectedTrains,
      delayMin: t?.scheduled_arrival
        ? calculateDelayMinutes(
            schedule.find((s) => s.train_id === selectedTrainId)?.actual_arrival,
            t.scheduled_arrival
          )
        : 0,
    };
  }, [selectedTrainId, trains, conflictIds, conflicts, schedule]);

  return (
    <div className="rounded border border-[#344039] bg-[#1a231f] p-3.5">
      {/* Top Header: Glance & Controls */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-[#344039] pb-2.5">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-[#9ac4fb]" />
          <div>
            <h3 className="text-xs font-semibold text-white">
              Marey time-distance graph
            </h3>
            <span className="text-xs text-[#acb9b0]">
              Space-time projection, 20 min past and 70 min ahead
            </span>
          </div>
        </div>

        {/* Interactive Filters & Toggles */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Fleet Filter */}
          <div className="flex items-center gap-1 rounded border border-[#344039] bg-[#111816] p-0.5">
            {['all', 'Express', 'Passenger', 'Freight'].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterType(cat)}
                className={`rounded px-2 py-0.5 capitalize transition-colors ${
                  filterType === cat
                    ? 'bg-[#233128] text-white border border-[#344039]'
                    : 'text-[#acb9b0] hover:text-white'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Uncertainty Cone Toggle */}
          <button
            type="button"
            onClick={() => setShowPredictionUncertainty(!showPredictionUncertainty)}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-0.5 text-xs transition-colors ${
              showPredictionUncertainty
                ? 'border-[#9ac4fb]/50 bg-[#9ac4fb]/10 text-[#9ac4fb]'
                : 'border-[#344039] bg-[#111816] text-[#acb9b0]'
            }`}
          >
            <Eye className="h-3 w-3" />
            <span>Prediction zone</span>
          </button>
        </div>
      </div>

      {/* Ripple View Banner (When a train is selected) */}
      {rippleData && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-[#344039] bg-[#111816] px-3 py-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-white">
              Ripple: {rippleData.trainId}
            </span>
            <span className="text-[#acb9b0]">
              {rippleData.isConflicted
                ? `Safety clash predicted with ${rippleData.affectedTrains.join(', ')}`
                : rippleData.delayMin > 2
                  ? `Running with +${Math.round(rippleData.delayMin)}m delay; no downstream block conflicts`
                  : 'Operating nominal on clear signals'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {rippleData.isConflicted && (
              <span className="rounded bg-[#ffab9e]/15 px-2 py-0.2 font-medium text-[#ffab9e] border border-[#ffab9e]/30 text-xs">
                Conflict at {forecastConflict?.label}
              </span>
            )}
            <button
              type="button"
              onClick={() => setSelectedTrainId(null)}
              className="text-[#acb9b0] hover:text-white text-xs"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      {/* Marey Chart SVG Canvas */}
      <div ref={containerRef} className="relative h-[360px] w-full rounded border border-[#344039] bg-[#111816] overflow-hidden select-none">
        {/* Background Prediction Zone (To the right of NOW line) */}
        <div
          className="absolute top-0 bottom-0 right-0 bg-[#1a231f]/40 border-l border-[#344039] z-0 pointer-events-none"
          style={{ left: `${nowPct}%` }}
        >
          <div className="absolute top-2 right-3 text-xs text-[#acb9b0] font-medium">
            Prediction zone (ILP forecast)
          </div>
        </div>

        {/* Time Grid Header & Vertical Grid Lines */}
        {timeTicks.map((tick) => (
          <div
            key={tick.ms}
            className="absolute top-0 bottom-0 border-l border-dashed border-[#344039]/50 pointer-events-none z-0"
            style={{ left: `${tick.pct}%` }}
          >
            <span className="absolute top-1.5 left-1 text-xs text-[#acb9b0] tabular-nums">
              {tick.label}
            </span>
          </div>
        ))}

        {/* Station Horizontal Grid Bands */}
        {stations.map((st) => {
          const km = STATION_KM[st.id] ?? 0;
          const yPct = kmToY(km);
          return (
            <div
              key={st.id}
              className="absolute left-0 right-0 border-b border-[#344039] pointer-events-none z-10 flex items-center justify-between px-3"
              style={{ top: `${yPct}%` }}
            >
              <div className="flex items-center gap-2 -translate-y-3">
                <span className="rounded bg-[#1a231f] px-1.5 py-0.2 text-xs font-medium text-white border border-[#344039]">
                  {st.id}
                </span>
                <span className="text-xs text-[#f1f5ef]">
                  {st.station_name}
                </span>
                <span className="text-xs text-[#acb9b0]">({km} km, {st.platforms} platforms)</span>
              </div>
            </div>
          );
        })}

        {/* NOW Vertical Line */}
        <div
          className="absolute top-0 bottom-0 border-l-2 border-[#9ac4fb] z-30 pointer-events-none"
          style={{ left: `${nowPct}%` }}
        >
          <div className="absolute -top-0 -translate-x-1/2 rounded bg-[#9ac4fb] text-black px-1.5 py-0.2 text-xs font-semibold">
            NOW {formatTime(now.toISOString())}
          </div>
        </div>

        {/* SVG Drawing Layer: Stringlines, Dwells, Uncertainty Envelopes */}
        <svg className="absolute inset-0 h-full w-full z-20 overflow-visible pointer-events-none">
          <defs>
            {/* Uncertainty Gradient */}
            <linearGradient id="uncertaintyGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#9ac4fb" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#9ac4fb" stopOpacity="0.18" />
            </linearGradient>
          </defs>

          {/* Uncertainty Cone / Envelope for Selected Train */}
          {showPredictionUncertainty && selectedTrainId && (
            (() => {
              const traj = trajectories.find((t) => t.trainId === selectedTrainId);
              if (!traj || traj.points.length < 2) return null;

              const futurePoints = traj.points.filter((p) => p.x >= nowPct);
              if (futurePoints.length < 1) return null;

              const upperPoints: string[] = [];
              const lowerPoints: string[] = [];

              futurePoints.forEach((p, idx) => {
                const uncertaintyWidth = Math.min(24, (idx + 1) * 7);
                upperPoints.push(`${p.x}%,${p.y - uncertaintyWidth / 8}%`);
                lowerPoints.unshift(`${p.x}%,${p.y + uncertaintyWidth / 8}%`);
              });

              if (upperPoints.length === 0) return null;
              const polyPoints = [...upperPoints, ...lowerPoints].join(' ');

              return (
                <polygon
                  points={polyPoints}
                  fill="url(#uncertaintyGradient)"
                  stroke="#9ac4fb"
                  strokeWidth="0.5"
                  strokeDasharray="2 2"
                />
              );
            })()
          )}

          {/* Train Trajectory Stringlines */}
          {filteredTrajectories.map((traj) => {
            const isSelected = selectedTrainId === traj.trainId;
            const isConflict = traj.hasConflict;
            const isDelayed = traj.isDelayed;

            // Stroke styling based on state
            let strokeColor = '#9ac4fb';
            if (isConflict) strokeColor = '#ffab9e';
            else if (isDelayed) strokeColor = '#f2c278';
            else if (traj.category === 'Freight') strokeColor = '#acb9b0';

            const strokeWidth = isSelected ? 2.5 : isConflict ? 2 : 1.2;
            const opacity = selectedTrainId ? (isSelected ? 1.0 : 0.3) : 0.85;

            // Render path segments
            const segments: React.ReactNode[] = [];
            for (let i = 0; i < traj.points.length - 1; i++) {
              const p1 = traj.points[i];
              const p2 = traj.points[i + 1];

              const isFuture = p1.x >= nowPct || p2.x >= nowPct;
              const isDwell = p1.stationId === p2.stationId;

              if (isDwell) {
                // Platform dwell horizontal block
                segments.push(
                  <line
                    key={`dwell-${traj.trainId}-${i}`}
                    x1={`${p1.x}%`}
                    y1={`${p1.y}%`}
                    x2={`${p2.x}%`}
                    y2={`${p2.y}%`}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth + 2.5}
                    strokeLinecap="round"
                    opacity={opacity}
                  />
                );
              } else {
                // Inter-station running line (solid past, dashed future)
                segments.push(
                  <line
                    key={`run-${traj.trainId}-${i}`}
                    x1={`${p1.x}%`}
                    y1={`${p1.y}%`}
                    x2={`${p2.x}%`}
                    y2={`${p2.y}%`}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={isFuture ? '4 3' : undefined}
                    opacity={opacity}
                  />
                );
              }
            }

            return <g key={`traj-${traj.trainId}`}>{segments}</g>;
          })}
        </svg>

        {/* Interactive Train Click Nodes on HTML Layer */}
        <div className="absolute inset-0 z-30 pointer-events-auto">
          {filteredTrajectories.map((traj) => {
            const firstPt = traj.points[0];
            if (!firstPt) return null;

            const isSelected = selectedTrainId === traj.trainId;

            return (
              <button
                key={`btn-${traj.trainId}`}
                type="button"
                onClick={() => {
                  setSelectedTrainId(traj.trainId);
                  onSelectTrain?.(traj.trainId);
                }}
                onMouseEnter={() =>
                  setHoveredEntry({
                    trainId: traj.trainId,
                    text: `${traj.trainId} (${traj.category}): ${traj.isDelayed ? `+${Math.round(traj.delayMin)}m delay` : 'On time'}`,
                    x: firstPt.x,
                    y: firstPt.y,
                  })
                }
                onMouseLeave={() => setHoveredEntry(null)}
                className={`absolute px-1.5 py-0.2 rounded text-xs font-semibold transition-transform hover:scale-110 ${
                  traj.hasConflict
                    ? 'bg-[#ffab9e] text-white'
                    : traj.isDelayed
                      ? 'bg-[#f2c278] text-black'
                      : isSelected
                        ? 'bg-[#9ac4fb] text-white'
                        : 'bg-[#1a231f] text-[#f1f5ef] hover:text-white border border-[#344039]'
                }`}
                style={{
                  left: `${firstPt.x}%`,
                  top: `${firstPt.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {traj.trainId}
              </button>
            );
          })}

          {/* PREDICTED CONFLICT FORECAST TARGET MARKER */}
          {forecastConflict && (
            <div
              className="absolute z-40 -translate-x-1/2 -translate-y-1/2 cursor-pointer group"
              style={{
                left: `${forecastConflict.xPct}%`,
                top: `${forecastConflict.yPct}%`,
              }}
              onClick={() => onResolveConflict?.(forecastConflict.conflict.id || 'conflict-sc-p1')}
            >
              <div className="relative flex items-center justify-center">
                <span className="h-6 w-6 rounded border border-[#ffab9e] bg-[#1a231f] flex items-center justify-center">
                  <AlertTriangle className="h-3.5 w-3.5 text-[#ffab9e]" />
                </span>
              </div>

              {/* Forecast Tooltip Pin */}
              <div className="absolute left-1/2 -top-10 -translate-x-1/2 rounded bg-[#1a231f] border border-[#ffab9e] px-2 py-1 text-xs text-white whitespace-nowrap shadow-xl">
                <div className="font-medium text-[#ffab9e]">
                  Conflict at {forecastConflict?.label}
                </div>
                <span className="text-[#f1f5ef]">{forecastConflict?.conflict.station_id} · Platform {forecastConflict?.conflict.platform}</span>
              </div>
            </div>
          )}
        </div>

        {/* Hover Tooltip */}
        {hoveredEntry && (
          <div
            className="absolute z-50 pointer-events-none rounded bg-[#1a231f] border border-[#344039] px-2.5 py-1 text-xs text-white shadow-xl"
            style={{
              left: `${Math.min(80, Math.max(10, hoveredEntry.x))}%`,
              top: `${Math.min(80, Math.max(15, hoveredEntry.y - 12))}%`,
            }}
          >
            {hoveredEntry.text}
          </div>
        )}
      </div>

      {/* Legend Bar */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#acb9b0] pt-2 border-t border-[#344039]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-[#f1f5ef]">
            <span className="h-0.5 w-4 bg-[#9ac4fb]" />
            Past observed
          </span>
          <span className="flex items-center gap-1.5 text-[#acb9b0]">
            <span className="h-0.5 w-4 border-b border-dashed border-[#9ac4fb]" />
            Future predicted
          </span>
          <span className="flex items-center gap-1.5 text-[#f2c278]">
            <span className="h-0.5 w-4 bg-[#f2c278]" />
            Delayed
          </span>
          <span className="flex items-center gap-1.5 text-[#ffab9e] font-medium">
            <AlertTriangle className="h-3 w-3 text-[#ffab9e]" />
            Predicted conflict
          </span>
        </div>

        <div className="flex items-center gap-1 text-xs">
          <Info className="h-3 w-3 text-[#9ac4fb]" />
          <span>Select train to trace ripple dependency chain</span>
        </div>
      </div>
    </div>
  );
}
