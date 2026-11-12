import { useState, useMemo, useEffect } from 'react';
import type { ScheduleEntry, Station, Train } from '../../types/railway';
import { formatTime } from '../../lib/dateTimeUtils';
import {
  Play,
  Pause,
  Clock,
  RotateCcw,
  TrainFront,
  AlertTriangle,
  HardHat,
  Info,
} from 'lucide-react';

export interface CorridorTrackMapProps {
  schedule: ScheduleEntry[];
  trains: Train[];
  stations: Station[];
  activeMaintenance?: Array<{ section_id: string; duration_minutes: number; start_time: string }>;
  pendingDecision?: { train_id: string; station_id: string; one_line_reason: string } | null;
  onSelectTrain?: (trainId: string) => void;
  onSelectStation?: (stationId: string) => void;
  stationFocus?: string;
  now?: Date;
}

interface InterpolatedTrain {
  trainId: string;
  category: string;
  direction: 'UP' | 'DOWN';
  status: 'dwelling' | 'moving' | 'waiting_start' | 'completed';
  currentStation?: string;
  fromStation?: string;
  toStation?: string;
  platform: number;
  isLoop: boolean;
  progress: number; // 0 to 1 between stations
  x: number; // SVG X coordinate
  y: number; // SVG Y coordinate
  delayMin: number;
  isHeld: boolean;
  speedKmh: number;
}

// 7 Corridor Stations in order from Secunderabad (0 km) to Wadiaram (70 km)
const CORRIDOR_STATION_META = [
  { id: 'SC',  name: 'Secunderabad Jn', km: 0.0,  platforms: 6, loops: 3, isJunction: true,  trackSection: 'DOUBLE' },
  { id: 'MJF', name: 'Malkajgiri Jn',   km: 6.5,  platforms: 3, loops: 1, isJunction: true,  trackSection: 'DOUBLE' },
  { id: 'BMO', name: 'Bolarum',         km: 14.2, platforms: 3, loops: 2, isJunction: false, trackSection: 'TRANSITION' },
  { id: 'MED', name: 'Medchal',         km: 28.0, platforms: 2, loops: 2, isJunction: false, trackSection: 'SINGLE' },
  { id: 'MOB', name: 'Manoharabad Jn',  km: 42.5, platforms: 2, loops: 2, isJunction: true,  trackSection: 'SINGLE' },
  { id: 'ME',  name: 'Masaipet',        km: 56.8, platforms: 2, loops: 2, isJunction: false, trackSection: 'SINGLE' },
  { id: 'WDR', name: 'Wadiaram',        km: 70.0, platforms: 3, loops: 2, isJunction: false, trackSection: 'SINGLE' },
];

export function CorridorTrackMap({
  schedule,
  trains,
  stations,
  activeMaintenance = [],
  pendingDecision,
  onSelectTrain,
  onSelectStation,
  stationFocus = 'ALL',
  now = new Date(),
}: CorridorTrackMapProps) {
  // Merge canonical corridor metadata with live station properties
  const corridorStations = useMemo(() => {
    const stationMap = new Map<string, Station>();
    (stations || []).forEach((s) => stationMap.set(s.id, s));
    return CORRIDOR_STATION_META.map((st) => {
      const live = stationMap.get(st.id);
      return {
        ...st,
        name: live?.station_name || st.name,
        platforms: live?.platforms ?? st.platforms,
        loops: live?.passing_loops ?? st.loops,
        km: live?.km ?? st.km,
      };
    });
  }, [stations]);

  // Find schedule time bounds to seed simulation clock
  const scheduleBounds = useMemo(() => {
    if (!schedule || schedule.length === 0) {
      const t = now.getTime();
      return { minMs: t - 3600000, maxMs: t + 3600000 };
    }
    let minMs = Infinity;
    let maxMs = -Infinity;
    schedule.forEach((e) => {
      const arr = Date.parse(e.actual_arrival);
      const dep = Date.parse(e.actual_departure);
      if (Number.isFinite(arr)) {
        if (arr < minMs) minMs = arr;
        if (arr > maxMs) maxMs = arr;
      }
      if (Number.isFinite(dep)) {
        if (dep < minMs) minMs = dep;
        if (dep > maxMs) maxMs = dep;
      }
    });
    return { minMs, maxMs };
  }, [schedule, now]);

  // Simulation time state: defaults to current time if in range, otherwise earliest active traffic
  const [simTimeMs, setSimTimeMs] = useState<number>(() => {
    const nowMs = now.getTime();
    if (nowMs >= scheduleBounds.minMs - 1800000 && nowMs <= scheduleBounds.maxMs + 1800000) {
      return nowMs;
    }
    return scheduleBounds.minMs + 1800000;
  });

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playSpeed, setPlaySpeed] = useState<number>(5); // 1x, 5x, 15x
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [hoveredTrainId, setHoveredTrainId] = useState<string | null>(null);

  // Keep clock running smoothly
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setSimTimeMs((prev) => {
        const next = prev + 1000 * playSpeed;
        if (next > scheduleBounds.maxMs + 1800000) {
          return scheduleBounds.minMs;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying, playSpeed, scheduleBounds]);

  // SVG coordinate dimensions
  const svgWidth = 1060;
  const svgHeight = 320;
  const marginX = 80;
  const trackYMain = 150;
  const trackYUp = 125;
  const trackYDown = 175;
  const loopYOffset = 42; // Loop track offset

  // Station X coordinates along the horizontal axis (0 km to 70 km)
  const stationXMap = useMemo(() => {
    const map = new Map<string, number>();
    const usableWidth = svgWidth - marginX * 2;
    corridorStations.forEach((st, idx) => {
      // Linear equidistant placement with proper breathing room
      const x = marginX + (idx / (corridorStations.length - 1)) * usableWidth;
      map.set(st.id, x);
    });
    return map;
  }, [svgWidth, corridorStations]);

  // Interpolate train positions at current simTimeMs
  const liveTrains = useMemo<InterpolatedTrain[]>(() => {
    const trainStopsMap = new Map<string, ScheduleEntry[]>();
    schedule.forEach((e) => {
      if (!trainStopsMap.has(e.train_id)) {
        trainStopsMap.set(e.train_id, []);
      }
      trainStopsMap.get(e.train_id)!.push(e);
    });

    const result: InterpolatedTrain[] = [];

    trainStopsMap.forEach((stops, trainId) => {
      stops.sort((a, b) => Date.parse(a.actual_arrival) - Date.parse(b.actual_arrival));
      if (stops.length === 0) return;

      const t = trains.find((item) => item.id === trainId);
      const category = t?.type || (trainId.startsWith('EXP') ? 'Express' : trainId.startsWith('SUB') ? 'Suburban' : trainId.startsWith('FRT') ? 'Freight' : 'Passenger');
      const firstArr = Date.parse(stops[0].actual_arrival);
      const lastDep = Date.parse(stops[stops.length - 1].actual_departure);

      // Determine direction based on km of first vs last station
      const stFirstKm = corridorStations.find((s) => s.id === stops[0].station_id)?.km ?? 0;
      const stLastKm = corridorStations.find((s) => s.id === stops[stops.length - 1].station_id)?.km ?? 70;
      const direction: 'UP' | 'DOWN' = stLastKm >= stFirstKm ? 'UP' : 'DOWN';

      const isHeld = pendingDecision?.train_id === trainId;

      if (simTimeMs < firstArr) {
        // Not yet active
        return;
      }

      if (simTimeMs > lastDep) {
        // Finished trip
        return;
      }

      // Check if dwelling at any station
      for (const stop of stops) {
        const arr = Date.parse(stop.actual_arrival);
        const dep = Date.parse(stop.actual_departure);

        if (simTimeMs >= arr && simTimeMs <= dep) {
          const stX = stationXMap.get(stop.station_id) ?? marginX;
          const isSingleTrackSt = ['MED', 'MOB', 'ME', 'WDR'].includes(stop.station_id);
          const isLoop = isSingleTrackSt && stop.assigned_platform > 1;

          let y = trackYMain;
          if (['SC', 'MJF', 'BMO'].includes(stop.station_id)) {
            y = direction === 'UP' ? trackYUp : trackYDown;
          } else if (isLoop) {
            y = trackYMain - loopYOffset;
          }

          result.push({
            trainId,
            category,
            direction,
            status: 'dwelling',
            currentStation: stop.station_id,
            platform: stop.assigned_platform,
            isLoop,
            progress: (simTimeMs - arr) / Math.max(1, dep - arr),
            x: stX,
            y,
            delayMin: 0,
            isHeld,
            speedKmh: 0,
          });
          return;
        }
      }

      // Check if moving between stations
      for (let i = 0; i < stops.length - 1; i++) {
        const s1 = stops[i];
        const s2 = stops[i + 1];
        const dep1 = Date.parse(s1.actual_departure);
        const arr2 = Date.parse(s2.actual_arrival);

        if (simTimeMs > dep1 && simTimeMs < arr2) {
          const x1 = stationXMap.get(s1.station_id) ?? marginX;
          const x2 = stationXMap.get(s2.station_id) ?? svgWidth - marginX;
          const progress = Math.max(0, Math.min(1, (simTimeMs - dep1) / Math.max(1, arr2 - dep1)));

          const isDoubleTrack = ['SC_MJF', 'MJF_SC', 'MJF_BMO', 'BMO_MJF'].includes(`${s1.station_id}_${s2.station_id}`);
          let y = trackYMain;
          if (isDoubleTrack) {
            y = direction === 'UP' ? trackYUp : trackYDown;
          }

          const currentX = x1 + (x2 - x1) * progress;

          result.push({
            trainId,
            category,
            direction,
            status: 'moving',
            fromStation: s1.station_id,
            toStation: s2.station_id,
            platform: s2.assigned_platform,
            isLoop: false,
            progress,
            x: currentX,
            y,
            delayMin: 0,
            isHeld,
            speedKmh: category === 'Express' ? 95 : category === 'Freight' ? 55 : 75,
          });
          return;
        }
      }
    });

    return result;
  }, [schedule, trains, simTimeMs, stationXMap, pendingDecision, svgWidth, corridorStations]);

  // Train category color
  const getTrainColor = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'express':
        return '#f2b84b'; // Warm Amber / Gold
      case 'suburban':
      case 'local':
        return '#93b8ff'; // Commuter Blue
      case 'passenger':
        return '#c0a2ff'; // Soft Purple
      case 'freight':
        return '#ff6a5c'; // Cargo Red
      default:
        return '#93b8ff';
    }
  };

  const selectedTrainData = liveTrains.find((t) => t.trainId === selectedTrainId);

  return (
    <div className="rounded-xl border border-white/10 bg-[#141518]/90 overflow-hidden font-sans">
      {/* Top Header & Simulation Clock Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#16181d]/80 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-white/5 text-[#f2b84b] border border-white/10">
            <TrainFront className="h-3.5 w-3.5" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-white">
              Corridor Overview
            </span>
            <span className="rounded bg-white/5 px-2 py-0.5 text-[11px] font-mono font-medium text-white/70 border border-white/10">
              SC ↔ WDR (70 km)
            </span>
          </div>
        </div>

        {/* Live Simulation Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Clock Display */}
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs">
            <Clock className="h-3.5 w-3.5 text-[#f2b84b]" />
            <span className="font-mono font-bold text-white text-xs tabular-nums">
              {formatTime(new Date(simTimeMs).toISOString())}
            </span>
            <span className="text-[10px] text-white/40 uppercase tracking-wider">SIM TIME</span>
          </div>

          {/* Play/Pause Button */}
          <button
            type="button"
            onClick={() => setIsPlaying(!isPlaying)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition-all shadow-sm ${
              isPlaying
                ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold'
                : 'bg-white/10 text-white/90 border border-white/15 hover:bg-white/15'
            }`}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          {/* Speed Selector */}
          <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5">
            {[1, 5, 15].map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => setPlaySpeed(speed)}
                className={`rounded px-2.5 py-0.5 text-xs font-medium transition-all ${
                  playSpeed === speed
                    ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold shadow-sm'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>

          {/* Reset Clock Button */}
          <button
            type="button"
            onClick={() => setSimTimeMs(scheduleBounds.minMs + 1800000)}
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70 hover:text-white transition-colors"
            title="Reset simulation to initial traffic window"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Time Slider Bar */}
      <div className="flex items-center gap-3 border-b border-white/10 bg-[#141518]/90 px-4 py-2 text-xs">
        <span className="text-[11px] font-semibold text-white/50 whitespace-nowrap">
          Simulation Progress:
        </span>
        <input
          type="range"
          min={scheduleBounds.minMs}
          max={scheduleBounds.maxMs}
          value={simTimeMs}
          onChange={(e) => setSimTimeMs(Number(e.target.value))}
          className="flex-1 accent-[#f2b84b] cursor-pointer h-1.5 bg-white/10 rounded-lg"
        />
        <span className="font-mono text-xs tabular-nums text-[#f2b84b] font-bold whitespace-nowrap">
          {formatTime(new Date(simTimeMs).toISOString())}
        </span>
      </div>

      {/* Main Track Schematic SVG Canvas */}
      <div className="relative w-full bg-[#141518] overflow-x-auto p-4 select-none">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto min-w-[750px]"
          style={{ maxHeight: '380px' }}
        >
          <defs>
            {/* Maintenance Striped Pattern */}
            <pattern
              id="trackMaintHatch"
              width="8"
              height="8"
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line x1="0" y1="0" x2="0" y2="8" stroke="#f2b84b" strokeWidth="2.5" strokeOpacity="0.5" />
            </pattern>

            {/* Glowing train filter */}
            <filter id="trainLaser" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#f2b84b" floodOpacity="0.8" />
            </filter>
            <filter id="trainAlert" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#ff6a5c" floodOpacity="0.9" />
            </filter>
          </defs>

          {/* Section Type Zone Background Highlights */}
          {/* Double Track Zone (SC to BMO) */}
          <rect
            x={marginX - 20}
            y={trackYUp - 45}
            width={(stationXMap.get('BMO') ?? 250) - marginX + 30}
            height={trackYDown - trackYUp + 90}
            fill="#1c1f24"
            fillOpacity="0.5"
            rx="8"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
            strokeDasharray="4 2"
          />
          <text
            x={marginX}
            y={trackYUp - 26}
            fill="#93b8ff"
            fontSize="10"
            fontFamily="Inter, sans-serif"
            fontWeight="700"
            letterSpacing="0.05em"
          >
            DOUBLE TRACK SECTION (DEDICATED UP & DOWN LINES)
          </text>

          {/* Single Track Zone (BMO to WDR) */}
          <rect
            x={(stationXMap.get('BMO') ?? 250) + 15}
            y={trackYMain - loopYOffset - 35}
            width={(stationXMap.get('WDR') ?? svgWidth - marginX) - (stationXMap.get('BMO') ?? 250) + 10}
            height={loopYOffset * 2 + 70}
            fill="#23201a"
            fillOpacity="0.4"
            rx="8"
            stroke="rgba(242,184,75,0.2)"
            strokeWidth="1"
            strokeDasharray="4 2"
          />
          <text
            x={(stationXMap.get('BMO') ?? 250) + 30}
            y={trackYMain - loopYOffset - 20}
            fill="#f2b84b"
            fontSize="10"
            fontFamily="Inter, sans-serif"
            fontWeight="700"
            letterSpacing="0.05em"
          >
            SINGLE TRACK SECTION (BIDIRECTIONAL · CROSSING IN STATION PASSING LOOPS)
          </text>

          {/* ================= TRACK DRAWINGS ================= */}
          {/* 1. Double Track UP Line (SC -> BMO) */}
          <line
            x1={stationXMap.get('SC')}
            y1={trackYUp}
            x2={stationXMap.get('BMO')}
            y2={trackYUp}
            stroke="#2e384d"
            strokeWidth="4"
          />
          {/* UP Line Rails */}
          <line
            x1={stationXMap.get('SC')}
            y1={trackYUp - 2}
            x2={stationXMap.get('BMO')}
            y2={trackYUp - 2}
            stroke="#93b8ff"
            strokeWidth="1.2"
          />
          <line
            x1={stationXMap.get('SC')}
            y1={trackYUp + 2}
            x2={stationXMap.get('BMO')}
            y2={trackYUp + 2}
            stroke="#93b8ff"
            strokeWidth="1.2"
          />
          <text x={(marginX + (stationXMap.get('BMO') ?? 250)) / 2} y={trackYUp - 8} textAnchor="middle" fill="#93b8ff" fontSize="9" fontWeight="600">
            UP LINE ➔
          </text>

          {/* 2. Double Track DOWN Line (BMO -> SC) */}
          <line
            x1={stationXMap.get('SC')}
            y1={trackYDown}
            x2={stationXMap.get('BMO')}
            y2={trackYDown}
            stroke="#2e384d"
            strokeWidth="4"
          />
          {/* DOWN Line Rails */}
          <line
            x1={stationXMap.get('SC')}
            y1={trackYDown - 2}
            x2={stationXMap.get('BMO')}
            y2={trackYDown - 2}
            stroke="#93b8ff"
            strokeWidth="1.2"
          />
          <line
            x1={stationXMap.get('SC')}
            y1={trackYDown + 2}
            x2={stationXMap.get('BMO')}
            y2={trackYDown + 2}
            stroke="#93b8ff"
            strokeWidth="1.2"
          />
          <text x={(marginX + (stationXMap.get('BMO') ?? 250)) / 2} y={trackYDown + 14} textAnchor="middle" fill="#93b8ff" fontSize="9" fontWeight="600">
            ⬅ DOWN LINE
          </text>

          {/* 3. Transition Junction at BMO (Double track converges into single track) */}
          <path
            d={`M ${stationXMap.get('BMO')} ${trackYUp} L ${(stationXMap.get('BMO') ?? 250) + 35} ${trackYMain}`}
            stroke="#2e384d"
            strokeWidth="3.5"
            fill="none"
          />
          <path
            d={`M ${stationXMap.get('BMO')} ${trackYDown} L ${(stationXMap.get('BMO') ?? 250) + 35} ${trackYMain}`}
            stroke="#2e384d"
            strokeWidth="3.5"
            fill="none"
          />

          {/* 4. Single Track Mainline (BMO to WDR) */}
          <line
            x1={(stationXMap.get('BMO') ?? 250) + 35}
            y1={trackYMain}
            x2={stationXMap.get('WDR')}
            y2={trackYMain}
            stroke="#453823"
            strokeWidth="4.5"
          />
          <line
            x1={(stationXMap.get('BMO') ?? 250) + 35}
            y1={trackYMain - 2}
            x2={stationXMap.get('WDR')}
            y2={trackYMain - 2}
            stroke="#f2b84b"
            strokeWidth="1.3"
          />
          <line
            x1={(stationXMap.get('BMO') ?? 250) + 35}
            y1={trackYMain + 2}
            x2={stationXMap.get('WDR')}
            y2={trackYMain + 2}
            stroke="#f2b84b"
            strokeWidth="1.3"
          />

          {/* 5. Passing Loop Tracks at Single-Track Stations (MED, MOB, ME, WDR) */}
          {['MED', 'MOB', 'ME', 'WDR'].map((stId) => {
            const stX = stationXMap.get(stId) ?? 500;
            const loopHalfWidth = 35;
            const loopX1 = stX - loopHalfWidth;
            const loopX2 = stX + loopHalfWidth;
            const yLoop = trackYMain - loopYOffset;

            return (
              <g key={`loop-track-${stId}`}>
                {/* Loop divergent and convergent switch paths */}
                <path
                  d={`M ${loopX1 - 18} ${trackYMain} Q ${loopX1 - 8} ${trackYMain}, ${loopX1} ${yLoop} L ${loopX2} ${yLoop} Q ${loopX2 + 8} ${trackYMain}, ${loopX2 + 18} ${trackYMain}`}
                  stroke="#453823"
                  strokeWidth="3.2"
                  fill="none"
                />
                <line
                  x1={loopX1}
                  y1={yLoop}
                  x2={loopX2}
                  y2={yLoop}
                  stroke="#f2b84b"
                  strokeWidth="1.5"
                />
                <text
                  x={stX}
                  y={yLoop - 6}
                  textAnchor="middle"
                  fill="#f2b84b"
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  LOOP 1 (CROSSING)
                </text>
              </g>
            );
          })}

          {/* 6. Active Maintenance Block Hazard Overlay */}
          {activeMaintenance.map((m, idx) => {
            const [stA, stB] = m.section_id.split('_');
            const xA = stationXMap.get(stA) ?? marginX;
            const xB = stationXMap.get(stB) ?? svgWidth - marginX;
            const minX = Math.min(xA, xB) + 10;
            const widthX = Math.abs(xB - xA) - 20;

            return (
              <g key={`maint-hazard-${idx}`}>
                <rect
                  x={minX}
                  y={trackYMain - 15}
                  width={widthX}
                  height={30}
                  fill="url(#trackMaintHatch)"
                  stroke="#f2b84b"
                  strokeWidth="1.5"
                  rx="4"
                />
                <rect
                  x={minX + widthX / 2 - 80}
                  y={trackYMain - 11}
                  width="160"
                  height="22"
                  fill="#141518"
                  stroke="#f2b84b"
                  strokeWidth="1.2"
                  rx="4"
                />
                <text
                  x={minX + widthX / 2}
                  y={trackYMain + 4}
                  textAnchor="middle"
                  fill="#f2b84b"
                  fontSize="9.5"
                  fontWeight="700"
                  fontFamily="Inter, sans-serif"
                >
                  ⛔ TRACK BLOCK: {m.section_id}
                </text>
              </g>
            );
          })}

          {/* ================= STATION NODES & PLATFORM BERTHS ================= */}
          {corridorStations.map((st) => {
            const x = stationXMap.get(st.id) ?? marginX;
            const isSingle = ['MED', 'MOB', 'ME', 'WDR'].includes(st.id);
            const isFocused = stationFocus === st.id;

            return (
              <g
                key={`st-node-${st.id}`}
                onClick={() => onSelectStation?.(isFocused ? 'ALL' : st.id)}
                className="cursor-pointer group"
              >
                {/* Station Node Marker on Mainline */}
                <circle
                  cx={x}
                  cy={isSingle ? trackYMain : trackYUp}
                  r={isFocused ? 11 : 8}
                  fill="#141518"
                  stroke={isFocused ? '#f2b84b' : 'rgba(255,255,255,0.4)'}
                  strokeWidth={isFocused ? 3 : 2}
                  className="transition-all group-hover:scale-125"
                />
                {/* Second node for double track down line */}
                {!isSingle && (
                  <circle
                    cx={x}
                    cy={trackYDown}
                    r={isFocused ? 11 : 8}
                    fill="#141518"
                    stroke={isFocused ? '#f2b84b' : 'rgba(255,255,255,0.4)'}
                    strokeWidth={isFocused ? 3 : 2}
                    className="transition-all group-hover:scale-125"
                  />
                )}

                {/* Station Code Badge */}
                <rect
                  x={x - 22}
                  y={isSingle ? trackYMain + 18 : trackYDown + 16}
                  width="44"
                  height="18"
                  rx="4"
                  fill={isFocused ? '#f2b84b' : '#1e2024'}
                  stroke={isFocused ? '#f2b84b' : 'rgba(255,255,255,0.15)'}
                  strokeWidth="1.2"
                />
                <text
                  x={x}
                  y={isSingle ? trackYMain + 30 : trackYDown + 28}
                  textAnchor="middle"
                  fill={isFocused ? '#1c1710' : 'white'}
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="600"
                >
                  {st.id}
                </text>

                {/* Station Name & Km */}
                <text
                  x={x}
                  y={isSingle ? trackYMain + 46 : trackYDown + 44}
                  textAnchor="middle"
                  fill="white"
                  fontSize="11"
                  fontWeight="600"
                  className="group-hover:fill-[#f2b84b]"
                >
                  {st.name.replace(' Junction', ' Jn')}
                </text>
                <text
                  x={x}
                  y={isSingle ? trackYMain + 58 : trackYDown + 56}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.5)"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {st.km.toFixed(1)} km · {st.platforms} PF
                </text>
              </g>
            );
          })}

          {/* ================= LIVE MOVING TRAINS ================= */}
          {liveTrains.map((tr) => {
            const isSelected = selectedTrainId === tr.trainId;
            const isHovered = hoveredTrainId === tr.trainId;
            const color = getTrainColor(tr.category);

            return (
              <g
                key={`train-live-${tr.trainId}`}
                transform={`translate(${tr.x}, ${tr.y})`}
                onClick={() => {
                  setSelectedTrainId(tr.trainId);
                  onSelectTrain?.(tr.trainId);
                }}
                onMouseEnter={() => setHoveredTrainId(tr.trainId)}
                onMouseLeave={() => setHoveredTrainId(null)}
                className="cursor-pointer transition-transform"
                style={{
                  filter: tr.isHeld
                    ? 'url(#trainAlert)'
                    : isSelected || isHovered
                      ? 'url(#trainLaser)'
                      : undefined,
                }}
              >
                {/* Train Body Box */}
                <rect
                  x="-18"
                  y="-10"
                  width="36"
                  height="20"
                  rx="5"
                  fill={tr.isHeld ? '#3b1c1c' : '#141518'}
                  stroke={tr.isHeld ? '#ff6a5c' : color}
                  strokeWidth={isSelected || isHovered ? 2.5 : 1.8}
                />

                {/* Direction indicator arrow */}
                <path
                  d={tr.direction === 'UP' ? 'M 6 -3 L 12 0 L 6 3 Z' : 'M -6 -3 L -12 0 L -6 3 Z'}
                  fill={color}
                />

                {/* Train Number */}
                <text
                  x={tr.direction === 'UP' ? '-3' : '3'}
                  y="3"
                  textAnchor="middle"
                  fill="white"
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {tr.trainId.replace(/^[A-Z]+-/, '')}
                </text>

                {/* Train Floating Pill Banner above */}
                <g transform="translate(0, -18)">
                  <rect
                    x="-26"
                    y="-11"
                    width="52"
                    height="14"
                    rx="3"
                    fill={color}
                    opacity="0.95"
                  />
                  <text
                    x="0"
                    y="-1"
                    textAnchor="middle"
                    fill="#141518"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="700"
                  >
                    {tr.trainId}
                  </text>
                </g>

                {/* If held in loop, display warning alert banner */}
                {tr.isHeld && (
                  <g transform="translate(0, 22)">
                    <rect
                      x="-38"
                      y="-8"
                      width="76"
                      height="15"
                      rx="3"
                      fill="#ff6a5c"
                    />
                    <text
                      x="0"
                      y="2"
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="8"
                      fontWeight="bold"
                    >
                      ⚡ HELD IN LOOP
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Selected Train Quick HUD Overlay */}
        {selectedTrainData && (
          <div className="absolute top-4 right-4 z-30 rounded-xl border border-white/20 bg-[#16181d]/95 p-3.5 text-xs text-white shadow-2xl backdrop-blur-md max-w-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
              <span className="font-mono font-bold text-sm text-[#f2b84b]">
                {selectedTrainData.trainId}
              </span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/90">
                {selectedTrainData.category}
              </span>
            </div>
            <div className="space-y-1.5 text-white/70 text-[11px]">
              <div className="flex justify-between">
                <span>Direction:</span>
                <strong className="text-white font-medium">
                  {selectedTrainData.direction === 'UP' ? 'UP (SC ➔ WDR)' : 'DOWN (WDR ➔ SC)'}
                </strong>
              </div>
              <div className="flex justify-between">
                <span>Status:</span>
                <strong className={selectedTrainData.isHeld ? 'text-[#ff6a5c]' : 'text-[#55e0a3]'}>
                  {selectedTrainData.isHeld
                    ? '⚠️ Holding in Loop'
                    : selectedTrainData.status === 'dwelling'
                      ? `Dwelling at ${selectedTrainData.currentStation} (PF ${selectedTrainData.platform})`
                      : `Moving towards ${selectedTrainData.toStation}`}
                </strong>
              </div>
              <div className="flex justify-between">
                <span>Speed:</span>
                <strong className="text-white font-mono">{selectedTrainData.speedKmh} km/h</strong>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Footer Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 bg-[#141518]/90 px-4 py-2.5 text-xs text-white/70">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm bg-[#93b8ff]" />
            <span className="text-[#93b8ff] font-medium">Double Track (SC–BMO)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm bg-[#f2b84b]" />
            <span className="text-[#f2b84b] font-medium">Single Track & Loops (BMO–WDR)</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#ff6a5c]">
            <AlertTriangle className="h-3.5 w-3.5 text-[#ff6a5c]" />
            <span className="font-semibold">Train Held in Passing Loop</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#f2b84b]">
            <HardHat className="h-3.5 w-3.5 text-[#f2b84b]" />
            <span>Track Maintenance Block</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-white/60">
          <Info className="h-3.5 w-3.5 text-[#f2b84b]" />
          <span>Click any train or station to isolate movements</span>
        </div>
      </div>
    </div>
  );
}
