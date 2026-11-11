import { useMemo, useState } from 'react';
import type { TrainPosition } from './NetworkMap';
import type { ConflictItem, ScheduleEntry, Station, Train } from '../../types/railway';
import { isOverriddenEntry, calculateDelayMinutes } from '../../lib/scheduleUtils';
import { formatTime } from '../../lib/dateTimeUtils';

type GraphMode = 'occupation' | 'corridor' | 'compare';

interface TrainGraphProps {
  baselineEntries: ScheduleEntry[];
  actualEntries: ScheduleEntry[];
  stations: Station[];
  trains: Train[];
  conflicts: ConflictItem[];
  trainPositions?: TrainPosition[];
  now?: Date;
  animTick?: number;
  onEntryClick?: (entry: ScheduleEntry) => void;
}

function getTimeWindow(entries: ScheduleEntry[], nowMs: number) {
  if (entries.length === 0) {
    return { min: nowMs - 30 * 60 * 1000, max: nowMs + 90 * 60 * 1000 };
  }
  const times = entries.flatMap((e) => [
    new Date(e.actual_arrival).getTime(),
    new Date(e.actual_departure).getTime(),
  ]);
  const minTime = Math.min(...times, nowMs - 25 * 60 * 1000);
  const maxTime = Math.max(...times, nowMs + 75 * 60 * 1000);
  const padding = 15 * 60 * 1000;
  return { min: minTime - padding, max: maxTime + padding };
}

function conflictTrainIds(conflicts: ConflictItem[]): Set<string> {
  const ids = new Set<string>();
  conflicts.forEach((c) => (c.trains_involved || []).forEach((t) => ids.add(t)));
  return ids;
}

export function TrainGraph({
  baselineEntries,
  actualEntries,
  stations,
  trains,
  conflicts,
  trainPositions = [],
  now = new Date(),
  animTick = 0,
  onEntryClick,
}: TrainGraphProps) {
  const [mode, setMode] = useState<GraphMode>('occupation');
  const nowMs = now.getTime();
  const conflictIds = useMemo(() => conflictTrainIds(conflicts), [conflicts]);

  const displayEntries = mode === 'compare'
    ? actualEntries.filter((a) => {
        const b = baselineEntries.find(
          (x) => x.train_id === a.train_id && x.station_id === a.station_id
        );
        return (
          !b ||
          b.assigned_platform !== a.assigned_platform ||
          b.actual_arrival !== a.actual_arrival
        );
      })
    : actualEntries;

  const mutedEntries = mode === 'occupation' ? baselineEntries : [];

  const timeWindow = useMemo(
    () => getTimeWindow([...displayEntries, ...mutedEntries], nowMs),
    [displayEntries, mutedEntries, nowMs, animTick]
  );
  const span = Math.max(1, timeWindow.max - timeWindow.min);
  const nowPct = ((nowMs - timeWindow.min) / span) * 100;

  // 15-Minute Grid Ticks
  const fifteenMinTicks = useMemo(() => {
    const ticks: { time: number; pct: number; label: string }[] = [];
    const interval = 15 * 60 * 1000;
    const start = Math.ceil(timeWindow.min / interval) * interval;
    for (let t = start; t <= timeWindow.max; t += interval) {
      const pct = ((t - timeWindow.min) / span) * 100;
      if (pct >= 0 && pct <= 100) {
        ticks.push({ time: t, pct, label: formatTime(new Date(t).toISOString()) });
      }
    }
    return ticks;
  }, [timeWindow.min, timeWindow.max, span]);

  const stationMap = useMemo(() => {
    const map: Record<string, { platforms: number; rows: Record<number, ScheduleEntry[]> }> = {};
    stations.forEach((s) => (map[s.id] = { platforms: s.platforms, rows: {} }));
    displayEntries.forEach((e) => {
      if (!map[e.station_id]) return;
      const p = e.assigned_platform;
      if (!map[e.station_id].rows[p]) map[e.station_id].rows[p] = [];
      map[e.station_id].rows[p].push(e);
    });
    return map;
  }, [displayEntries, stations, animTick]);

  const corridorLanes = useMemo(() => {
    const byTrain: Record<string, ScheduleEntry[]> = {};
    displayEntries.forEach((e) => {
      if (!byTrain[e.train_id]) byTrain[e.train_id] = [];
      byTrain[e.train_id].push(e);
    });
    Object.values(byTrain).forEach((arr) =>
      arr.sort((a, b) => new Date(a.actual_arrival).getTime() - new Date(b.actual_arrival).getTime())
    );
    return byTrain;
  }, [displayEntries]);

  const liveMarkers = useMemo(() => {
    return trainPositions
      .filter((p) => p.status === 'moving')
      .map((pos) => {
        const entries = actualEntries
          .filter((e) => e.train_id === pos.train_id)
          .sort(
            (a, b) =>
              new Date(a.actual_arrival).getTime() - new Date(b.actual_arrival).getTime()
          );
        const fromEntry = entries.find((e) => e.station_id === pos.from_station);
        const toEntry = entries.find((e) => e.station_id === pos.to_station);
        if (!fromEntry || !toEntry) return null;
        const departMs = new Date(fromEntry.actual_departure).getTime();
        const arriveMs = new Date(toEntry.actual_arrival).getTime();
        const progress = Math.min(1, Math.max(0, pos.progress ?? 0.5));
        const markerMs = departMs + (arriveMs - departMs) * progress;
        const leftPct = Math.min(100, Math.max(0, ((markerMs - timeWindow.min) / span) * 100));
        return {
          trainId: pos.train_id,
          leftPct,
          stationId: fromEntry.station_id,
          platform: fromEntry.assigned_platform,
          corridorTrainId: pos.train_id,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [trainPositions, actualEntries, timeWindow.min, span]);

  // Overlap stacking helper: returns offsetIndex (0 or 1) and total overlapping count
  const getOverlapOffset = (entry: ScheduleEntry, rowEntries: ScheduleEntry[]) => {
    const arr = new Date(entry.actual_arrival).getTime();
    const dep = new Date(entry.actual_departure).getTime();
    const overlaps = rowEntries.filter((other) => {
      if (other.train_id === entry.train_id) return false;
      const oArr = new Date(other.actual_arrival).getTime();
      const oDep = new Date(other.actual_departure).getTime();
      return Math.max(arr, oArr) < Math.min(dep, oDep);
    });

    if (overlaps.length === 0) return { offset: 0, hasOverlap: false };
    const isFirst = entry.train_id < overlaps[0].train_id;
    return { offset: isFirst ? 0 : 1, hasOverlap: true };
  };

  const renderBar = (
    e: ScheduleEntry,
    muted: boolean,
    key: string,
    rowEntries: ScheduleEntry[] = []
  ) => {
    const start = new Date(e.actual_arrival).getTime();
    const end = new Date(e.actual_departure).getTime();
    const leftPct = Math.max(0, ((start - timeWindow.min) / span) * 100);
    const widthPct = Math.max(1, ((end - start) / span) * 100);

    const isConflict = conflictIds.has(e.train_id);
    const train = trains.find((t) => t.id === e.train_id);
    const dMin = calculateDelayMinutes(e.actual_arrival, e.scheduled_arrival || train?.scheduled_arrival);
    const isDelayed = dMin > 2;

    const { offset, hasOverlap } = getOverlapOffset(e, rowEntries);

    const heightClass = hasOverlap ? 'h-4 text-[9px]' : 'h-6 text-xs';
    const topStyle = hasOverlap ? (offset === 0 ? 'top-1' : 'top-5') : 'top-1.5';

    // Strict semantic colors
    let bgClass = 'bg-[#9ac4fb]/20 text-[#9ac4fb] border border-[#9ac4fb]/40';
    if (isConflict) {
      bgClass = 'bg-[#ffab9e] text-white border border-[#ffab9e]';
    } else if (isDelayed) {
      bgClass = 'bg-[#f2c278]/20 text-[#f2c278] border border-[#f2c278]/40';
    }

    return (
      <button
        key={key}
        type="button"
        className={`absolute ${topStyle} ${heightClass} flex items-center justify-between rounded px-1.5 font-mono transition-colors z-10 ${bgClass}`}
        style={{
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          opacity: muted ? 0.45 : 1,
        }}
        title={`${e.train_id} (${train?.type || 'Rake'})\nStation: ${e.station_id} P${e.assigned_platform}\nArrival: ${formatTime(e.actual_arrival)}\nDeparture: ${formatTime(e.actual_departure)}${isConflict ? '\nSafety conflict' : ''}${isDelayed ? `\nDelayed +${Math.round(dMin)}m` : ''}`}
        onClick={() => onEntryClick?.(e)}
      >
        <span className="truncate font-semibold">{e.train_id}</span>
        {isOverriddenEntry(e) && <span className="ml-1 text-[9px] text-[#f2c278]">★</span>}
      </button>
    );
  };

  const renderLiveHead = (marker: (typeof liveMarkers)[number], key: string) => (
    <div
      key={key}
      className="pointer-events-none absolute top-1 z-30 flex h-7 items-center"
      style={{ left: `${marker.leftPct}%`, transform: 'translateX(-50%)' }}
      title={`${marker.trainId} live telemetry`}
      aria-hidden
    >
      <span className="inline-block h-2.5 w-2.5 rotate-45 border border-white bg-[#9be7be]" />
    </div>
  );

  return (
    <div className="rounded border border-[#344039] bg-[#1a231f] p-4 text-[#f1f5ef]">
      {/* Top Controls & Semantic Legend */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-[#344039] pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#acb9b0]">View mode:</span>
          <div className="flex gap-1 rounded border border-[#344039] bg-[#111816] p-0.5 text-xs">
            {(['occupation', 'corridor', 'compare'] as GraphMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`rounded px-2.5 py-1 transition-colors ${
                  mode === m
                    ? 'bg-[#1a231f] text-white border border-[#344039]'
                    : 'text-[#acb9b0] hover:text-white'
                }`}
                onClick={() => setMode(m)}
              >
                {m === 'occupation' ? 'Platform berths' : m === 'corridor' ? 'Train trajectories' : 'Changes'}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-[#acb9b0]">
            <span className="h-2 w-3 rounded bg-[#9ac4fb]" />
            Nominal
          </span>
          <span className="flex items-center gap-1.5 text-[#acb9b0]">
            <span className="h-2 w-3 rounded bg-[#f2c278]" />
            Delayed
          </span>
          <span className="flex items-center gap-1.5 text-[#ffab9e] font-medium">
            <span className="h-2 w-3 rounded bg-[#ffab9e]" />
            Safety clash
          </span>
          <span className="flex items-center gap-1.5 text-[#acb9b0]">
            <span className="h-2 w-2 rotate-45 bg-[#9be7be]" />
            Moving rake
          </span>
        </div>
      </div>

      {/* Sticky 15-Minute Time Grid Header */}
      <div className="sticky top-0 z-30 mb-2 h-7 rounded border-b border-[#344039] bg-[#111816] font-mono text-[11px] text-[#acb9b0] flex items-center relative overflow-hidden">
        {fifteenMinTicks.map((tick) => (
          <div
            key={tick.time}
            className="absolute top-1 -translate-x-1/2 flex flex-col items-center"
            style={{ left: `${tick.pct}%` }}
          >
            <span>{tick.label}</span>
          </div>
        ))}
      </div>

      {/* Timeline Chart Body */}
      <div className="relative max-h-[500px] overflow-y-auto">
        {/* 15-Minute Vertical Background Grid Lines */}
        <div className="pointer-events-none absolute inset-0 z-0 flex">
          {fifteenMinTicks.map((tick) => (
            <div
              key={tick.time}
              className="absolute top-0 bottom-0 border-l border-dashed border-[#344039]/50"
              style={{ left: `${tick.pct}%` }}
            />
          ))}
        </div>

        {/* NOW Line Indicator */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-[#ffab9e]"
          style={{ left: `${Math.min(100, Math.max(0, nowPct))}%` }}
          aria-hidden
        >
          <span className="absolute -top-1 -translate-x-1/2 rounded bg-[#ffab9e] px-1 py-0.2 font-mono text-[9px] font-semibold text-white">
            NOW ({formatTime(now.toISOString())})
          </span>
        </div>

        {/* Platform Berths Mode */}
        {mode === 'occupation' && (
          <div className="space-y-3 relative z-10">
            {stations.map((st) => {
              const data = stationMap[st.id];
              if (!data) return null;
              return (
                <div key={st.id} className="rounded border border-[#344039] bg-[#111816] p-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-white px-2 py-0.5 rounded bg-[#1a231f] border border-[#344039]">
                      {st.id} - {st.station_name || (st.id === 'HYB' ? 'Hyderabad' : st.id === 'SC' ? 'Secunderabad' : 'Kacheguda')}
                    </span>
                    <span className="text-[#acb9b0]">{st.platforms} platforms</span>
                  </div>

                  <div className="space-y-1.5">
                    {Array.from({ length: st.platforms }).map((_, i) => {
                      const p = i + 1;
                      const rowEntries = data.rows[p] || [];
                      return (
                        <div
                          key={p}
                          className="relative h-10 rounded border border-[#344039] bg-[#1a231f] transition-colors"
                        >
                          <div className="absolute left-2 top-2.5 text-xs text-[#acb9b0] z-20">
                            P{p}
                          </div>
                          {rowEntries.map((e, idx) =>
                            renderBar(e, false, `${e.train_id}-${idx}`, rowEntries)
                          )}
                          {liveMarkers
                            .filter((m) => m.stationId === st.id && m.platform === p)
                            .map((m) => renderLiveHead(m, `live-${m.trainId}-${p}`))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Corridor Mode */}
        {mode === 'corridor' && (
          <div className="space-y-2 relative z-10">
            {Object.entries(corridorLanes).map(([trainId, entries]) => (
              <div key={trainId} className="relative h-10 rounded border border-[#344039] bg-[#111816]">
                <div className="absolute left-2 top-2.5 text-xs font-semibold text-white z-20">
                  {trainId}
                </div>
                {entries.map((e, i) => renderBar(e, false, `${trainId}-${i}`, entries))}
                {liveMarkers
                  .filter((m) => m.corridorTrainId === trainId)
                  .map((m) => renderLiveHead(m, `live-${trainId}`))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
