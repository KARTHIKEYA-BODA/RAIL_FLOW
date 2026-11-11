import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Compass,
  Layers,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Radio,
  AlertTriangle,
  Gauge,
  Clock,
  ArrowRight,
  CheckCircle2,
  TrainFront,
  Navigation,
  ZoomIn,
  ZoomOut,
  Sliders,
  Activity,
} from 'lucide-react';

import {
  HYDERABAD_STATIONS,
  HYDERABAD_TRACK_SEGMENTS,
  ACTIVE_TSR_ZONES,
  TRACKED_MMTS_TRAINS,
} from '../../lib/hyderabadGeoData';

import {
  positionOfTrain,
  projectGeoToSvg,
  SCHEMATIC_STATION_COORDS,
  type LiveTrainPosition,
} from '../../lib/kinematicMapEngine';

import { usePreferences, speak } from '../../context/WorkspacePreferences';

interface LiveCorridorMapProps {
  onReviewConflict?: (id?: string) => void;
  onNavigate?: (section: any) => void;
}

export function LiveCorridorMap({ onReviewConflict, onNavigate }: LiveCorridorMapProps) {
  const prefs = usePreferences();

  // Mode: 'geo' (OCC Radar Geographic Projection) or 'schematic' (Topological Diagram)
  const [mapMode, setMapMode] = useState<'geo' | 'schematic'>('geo');

  // Simulation Clock: start at 16:25 (985 minutes from midnight)
  const [simMinute, setSimMinute] = useState<number>(985);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1); // 1x, 5x, 10x, 60x

  // Layer Toggles
  const [layers, setLayers] = useState({
    tracks: true,
    mmts: true,
    trains: true,
    stations: true,
    tsr: true,
    conflicts: true,
    radarPulse: true,
  });

  // Selected train for inspector drawer
  const [selectedTrainNumber, setSelectedTrainNumber] = useState<string>('47155');
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

  // Pan & Zoom state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const startPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Audio readout state
  const [voiceMuted, setVoiceMuted] = useState<boolean>(false);

  // SVG dimensions
  const svgWidth = 1000;
  const svgHeight = 720;

  // Active scenario
  const [activeScenario, setActiveScenario] = useState<'normal' | 'tsr' | 'conflict' | 'monsoon'>('conflict');

  // Adjust tracked train delays based on scenario
  const scenarioTrains = useMemo(() => {
    return TRACKED_MMTS_TRAINS.map((t) => {
      let delay = t.currentDelayMin;
      let reason = t.delayReason;

      if (activeScenario === 'monsoon') {
        delay += 12;
        reason = 'Suburban waterlogging caution between Secunderabad and Begumpet';
      } else if (activeScenario === 'tsr' && (t.trainNumber === '47178' || t.trainNumber === '12727')) {
        delay += 6;
        reason = 'Kinematic deceleration through KM 11.2 TSR-14 speed limit zone';
      } else if (activeScenario === 'normal') {
        if (t.trainNumber === 'T104') delay = 0;
        if (t.trainNumber === 'T107') delay = 0;
        reason = 'Operating according to published timetable';
      }

      return {
        ...t,
        currentDelayMin: delay,
        delayReason: reason,
      };
    });
  }, [activeScenario]);

  // Base simulation minute: 16:00 IST (960 min from midnight)
  const BASE_SIM_MINUTE = 960;
  const currentRelativeMinute = simMinute >= 930 ? simMinute - BASE_SIM_MINUTE : simMinute;

  // Compute live positions of all trains at currentRelativeMinute
  const livePositions = useMemo(() => {
    const map = new Map<string, LiveTrainPosition>();
    for (const t of scenarioTrains) {
      map.set(t.trainNumber, positionOfTrain(t, currentRelativeMinute));
    }
    return map;
  }, [scenarioTrains, currentRelativeMinute]);

  // Selected train live telemetry
  const selectedTrain = useMemo(() => {
    return livePositions.get(selectedTrainNumber) || null;
  }, [livePositions, selectedTrainNumber]);

  // Auto-tick timer
  useEffect(() => {
    if (!isPlaying) return;

    const intervalMs = Math.max(100, Math.floor(1000 / playbackSpeed));
    const timer = setInterval(() => {
      setSimMinute((prev) => {
        // wrap around between 15:30 (930m) and 18:00 (1080m)
        if (prev >= 1080) return 930;
        return prev + 0.1; // 6 seconds in simulation per tick at 1x
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed]);

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // only left click
    setIsPanning(true);
    startPanRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - startPanRef.current.x,
      y: e.clientY - startPanRef.current.y,
    });
  };

  const handleMouseUp = () => setIsPanning(false);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Convert GPS point to SVG coordinate based on active map mode
  const getSvgPoint = useCallback(
    (lat: number, lng: number, stationCode?: string): [number, number] => {
      if (mapMode === 'schematic' && stationCode && SCHEMATIC_STATION_COORDS[stationCode]) {
        return SCHEMATIC_STATION_COORDS[stationCode];
      }
      return projectGeoToSvg(lat, lng, svgWidth, svgHeight, 60);
    },
    [mapMode]
  );

  // Sync with real wall clock
  const syncWithWallClock = () => {
    const d = new Date();
    const min = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    setSimMinute(min);
  };

  // Voice narration of selected train
  const speakTelemetry = (pos: LiveTrainPosition) => {
    if (voiceMuted) return;
    const text = `${pos.name}. Current speed: ${pos.speedKmh} kilometres per hour. Status: ${
      pos.state === 'dwelling'
        ? `Dwelling at ${pos.currentStationName}, departing in ${pos.dwellRemainingMin || 1} minutes.`
        : `Moving towards ${pos.nextStationName || 'destination'}.`
    } Punctuality: ${pos.delayMin > 0 ? `${pos.delayMin} minutes delayed` : 'Right time'}. ${
      pos.inTSRZone ? 'Caution: Running inside TSR-14 speed restriction zone.' : ''
    } Kavach safety status: ${pos.kavachStatus}.`;

    speak(text, prefs.language || 'en');
  };

  // Simulation clock display string (HH:MM:SS)
  const simTimeString = useMemo(() => {
    const totalSecs = Math.floor(simMinute * 60);
    const hrs = Math.floor(totalSecs / 3600) % 24;
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [simMinute]);

  return (
    <div className="relative w-full h-[calc(100vh-80px)] min-h-[640px] flex flex-col bg-[#0b1017] text-slate-100 overflow-hidden select-none font-sans rounded-xl border border-slate-800 shadow-2xl">
      {/* 1. TOP HEADER & TELEMETRY STRIP */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-[#0f1722]/90 backdrop-blur-md border-b border-slate-800 z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-orange-500/10 border border-orange-500/30">
            <Radio size={16} className="text-orange-400 animate-pulse" />
            <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">
              Hyderabad OCC Live Radar
            </span>
          </div>

          <span className="hidden md:inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            Simulated live: positions computed from timetable &amp; reported delays
          </span>
        </div>

        {/* View Mode Toggle & Audio Readout */}
        <div className="flex items-center gap-2">
          {/* Mode Switcher */}
          <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-lg p-0.5 text-xs font-medium">
            <button
              onClick={() => setMapMode('geo')}
              className={`px-3 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                mapMode === 'geo'
                  ? 'bg-orange-500 text-white font-bold shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Real WGS84 Geographic GPS Alignments"
            >
              <Compass size={14} />
              <span>Geographic OCC Radar</span>
            </button>
            <button
              onClick={() => setMapMode('schematic')}
              className={`px-3 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                mapMode === 'schematic'
                  ? 'bg-orange-500 text-white font-bold shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Topological Synoptic Schematic Diagram"
            >
              <Sliders size={14} />
              <span>Schematic Diagram</span>
            </button>
          </div>

          {/* Sound / Readout */}
          <button
            onClick={() => {
              setVoiceMuted(!voiceMuted);
              if (voiceMuted && selectedTrain) speakTelemetry(selectedTrain);
            }}
            className={`p-1.5 rounded-lg border text-xs transition-colors flex items-center gap-1.5 ${
              voiceMuted
                ? 'bg-slate-800 border-slate-700 text-slate-400'
                : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
            }`}
            title={voiceMuted ? 'Voice readout muted' : 'Voice readout active'}
          >
            {voiceMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            <span className="hidden sm:inline text-[11px]">{voiceMuted ? 'Mute' : 'Voice On'}</span>
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE: LAYERS (LEFT), SVG RADAR (CENTER), INSPECTOR (RIGHT) */}
      <div className="relative flex-1 flex overflow-hidden">
        {/* LEFT: FLOATING LAYER TOGGLES */}
        <div className="absolute top-4 left-4 z-20 flex flex-col gap-2 max-w-[210px] w-full">
          <div className="bg-[#0f1722]/95 backdrop-blur-md border border-slate-800 rounded-xl p-3 shadow-xl">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Layers size={14} className="text-orange-400" />
                Corridor Layers
              </span>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <label className="flex items-center justify-between cursor-pointer hover:bg-slate-800/50 p-1 rounded">
                <span className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-1 rounded bg-slate-400" />
                  Corridor Tracks
                </span>
                <input
                  type="checkbox"
                  checked={layers.tracks}
                  onChange={(e) => setLayers({ ...layers, tracks: e.target.checked })}
                  className="rounded text-orange-500 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:bg-slate-800/50 p-1 rounded">
                <span className="flex items-center gap-2 text-cyan-300">
                  <span className="w-2.5 h-1 rounded bg-cyan-400" />
                  MMTS Suburban
                </span>
                <input
                  type="checkbox"
                  checked={layers.mmts}
                  onChange={(e) => setLayers({ ...layers, mmts: e.target.checked })}
                  className="rounded text-cyan-500 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:bg-slate-800/50 p-1 rounded">
                <span className="flex items-center gap-2 text-emerald-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  Moving Trains
                </span>
                <input
                  type="checkbox"
                  checked={layers.trains}
                  onChange={(e) => setLayers({ ...layers, trains: e.target.checked })}
                  className="rounded text-emerald-500 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:bg-slate-800/50 p-1 rounded">
                <span className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded border border-slate-400" />
                  Station Berths
                </span>
                <input
                  type="checkbox"
                  checked={layers.stations}
                  onChange={(e) => setLayers({ ...layers, stations: e.target.checked })}
                  className="rounded text-orange-500 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:bg-slate-800/50 p-1 rounded">
                <span className="flex items-center gap-2 text-amber-300">
                  <span className="w-2.5 h-1 rounded bg-amber-400" />
                  TSR-14 Zone
                </span>
                <input
                  type="checkbox"
                  checked={layers.tsr}
                  onChange={(e) => setLayers({ ...layers, tsr: e.target.checked })}
                  className="rounded text-amber-500 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:bg-slate-800/50 p-1 rounded">
                <span className="flex items-center gap-2 text-rose-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                  Headway Conflict
                </span>
                <input
                  type="checkbox"
                  checked={layers.conflicts}
                  onChange={(e) => setLayers({ ...layers, conflicts: e.target.checked })}
                  className="rounded text-rose-500 focus:ring-0"
                />
              </label>
            </div>
          </div>

          {/* Quick Corridor Overview Stats */}
          <div className="bg-[#0f1722]/95 backdrop-blur-md border border-slate-800 rounded-xl p-3 shadow-xl text-xs space-y-1.5">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Corridor Telemetry
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span>Active MMTS Rakes</span>
              <strong className="font-mono text-cyan-400">4 Rakes</strong>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span>Mainline Rakes</span>
              <strong className="font-mono text-orange-400">4 Trains</strong>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span>Kavach Supervision</span>
              <strong className="font-mono text-emerald-400">100%</strong>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span>Min Headway Standard</span>
              <strong className="font-mono text-slate-200">5.0 min</strong>
            </div>
          </div>

          {/* Zoom & Pan Controls */}
          <div className="flex items-center gap-1.5 bg-[#0f1722]/90 border border-slate-800 rounded-lg p-1 w-fit shadow-lg">
            <button
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}
              className="p-1 rounded hover:bg-slate-800 text-slate-300"
              title="Zoom In"
            >
              <ZoomIn size={15} />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(0.7, z - 0.2))}
              className="p-1 rounded hover:bg-slate-800 text-slate-300"
              title="Zoom Out"
            >
              <ZoomOut size={15} />
            </button>
            <button
              onClick={resetView}
              className="p-1 rounded hover:bg-slate-800 text-slate-300 text-[10px] font-mono"
              title="Reset View"
            >
              Reset
            </button>
          </div>
        </div>

        {/* CENTER: SVG RADAR CANVAS */}
        <div
          className={`flex-1 relative overflow-hidden bg-[#070b10] ${
            isPanning ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Subtle Radar Scanning Grid Lines */}
          <div
            className="absolute inset-0 pointer-events-none opacity-20"
            style={{
              backgroundImage:
                'radial-gradient(circle at center, rgba(30, 58, 138, 0.25) 0%, transparent 70%), linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)',
              backgroundSize: '100% 100%, 40px 40px, 40px 40px',
            }}
          />

          <svg
            className="w-full h-full"
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              {/* Gradients */}
              <linearGradient id="mainlineGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#818cf8" stopOpacity="0.8" />
              </linearGradient>

              <linearGradient id="mmtsGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.9" />
              </linearGradient>

              {/* TSR Hazard Stripe Pattern */}
              <pattern
                id="tsrHatch"
                width="10"
                height="10"
                patternTransform="rotate(45 0 0)"
                patternUnits="userSpaceOnUse"
              >
                <line x1="0" y1="0" x2="0" y2="10" stroke="#f59e0b" strokeWidth="3" />
                <line x1="0" y1="0" x2="10" y2="0" stroke="transparent" strokeWidth="7" />
              </pattern>

              {/* Pulsing Glow Filters */}
              <filter id="radarGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* 1. TRACK SEGMENTS */}
              {layers.tracks && (
                <g className="tracks-layer">
                  {HYDERABAD_TRACK_SEGMENTS.map((seg) => {
                    if (seg.type === 'mmts' && !layers.mmts) return null;

                    // Convert polyline to SVG path
                    const pathData = seg.coordinates
                      .map((pt, idx) => {
                        const [x, y] = getSvgPoint(pt[0], pt[1]);
                        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                      })
                      .join(' ');

                    const isMMTS = seg.type === 'mmts';

                    return (
                      <g key={seg.id}>
                        {/* Background track ballast */}
                        <path
                          d={pathData}
                          fill="none"
                          stroke={isMMTS ? '#083344' : '#1e293b'}
                          strokeWidth={isMMTS ? 8 : 7}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {/* Rail core line */}
                        <path
                          d={pathData}
                          fill="none"
                          stroke={isMMTS ? '#06b6d4' : '#64748b'}
                          strokeWidth={isMMTS ? 3.5 : 2.5}
                          strokeDasharray={isMMTS ? '6 3' : undefined}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={0.85}
                        />
                      </g>
                    );
                  })}
                </g>
              )}

              {/* 2. TSR-14 SPEED RESTRICTION ZONE (KM 11.2 - 11.8 on SC-HYB Line) */}
              {layers.tsr &&
                ACTIVE_TSR_ZONES.map((tsr) => {
                  const pts = tsr.coordinates.map((c) => getSvgPoint(c[0], c[1]));
                  const pathData = pts
                    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`)
                    .join(' ');
                  const midPoint = pts[Math.floor(pts.length / 2)] || [pts[0][0], pts[0][1]];

                  return (
                    <g key={tsr.id}>
                      {/* Warning highlight corridor */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="14"
                        strokeOpacity="0.25"
                        strokeLinecap="round"
                      />
                      <path
                        d={pathData}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="4"
                        strokeDasharray="8 4"
                      />

                      {/* Floating Caution Badge */}
                      <g transform={`translate(${midPoint[0] - 65}, ${midPoint[1] - 28})`}>
                        <rect
                          width="130"
                          height="22"
                          rx="4"
                          fill="#1c1917"
                          stroke="#f59e0b"
                          strokeWidth="1.2"
                        />
                        <text
                          x="65"
                          y="15"
                          textAnchor="middle"
                          fill="#fef08a"
                          fontSize="10"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          ⚠️ TSR-14: 20 km/h
                        </text>
                      </g>
                    </g>
                  );
                })}

              {/* 3. HEADWAY CONFLICT PULSE (At Secunderabad Jn Platform 1) */}
              {layers.conflicts && (
                <g>
                  {(() => {
                    const scStation = HYDERABAD_STATIONS.find((s) => s.id === 'SC');
                    if (!scStation) return null;
                    const [scX, scY] = getSvgPoint(scStation.lat, scStation.lng, 'SC');

                    return (
                      <g transform={`translate(${scX + 15}, ${scY - 15})`}>
                        {/* Radar warning rings */}
                        <circle
                          r="28"
                          fill="none"
                          stroke="#ef4444"
                          strokeWidth="1.5"
                          opacity="0.6"
                          className="animate-ping"
                        />
                        <circle
                          r="18"
                          fill="rgba(239, 68, 68, 0.25)"
                          stroke="#ef4444"
                          strokeWidth="2"
                        />
                        <text
                          x="0"
                          y="4"
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="11"
                          fontWeight="bold"
                        >
                          ⚠
                        </text>

                        {/* Interactive Banner */}
                        <g
                          className="cursor-pointer"
                          onClick={() => onReviewConflict?.('SC-PF1-CLASH')}
                          transform="translate(18, -12)"
                        >
                          <rect
                            width="180"
                            height="34"
                            rx="6"
                            fill="#450a0a"
                            stroke="#ef4444"
                            strokeWidth="1.5"
                          />
                          <text
                            x="10"
                            y="14"
                            fill="#fecaca"
                            fontSize="10"
                            fontWeight="bold"
                          >
                            HEADWAY CLASH: T104 / T107
                          </text>
                          <text
                            x="10"
                            y="27"
                            fill="#f87171"
                            fontSize="9"
                            fontFamily="monospace"
                          >
                            SC Platform 1 · Click to Solve →
                          </text>
                        </g>
                      </g>
                    );
                  })()}
                </g>
              )}

              {/* 4. STATIONS */}
              {layers.stations && (
                <g className="stations-layer">
                  {HYDERABAD_STATIONS.map((station) => {
                    const [x, y] = getSvgPoint(station.lat, station.lng, station.id);
                    const isMajor = station.category === 'major-terminal';
                    const isSelected = selectedStationId === station.id;

                    // Compute free platforms for station
                    const isSC = station.id === 'SC';
                    const freePlatforms = isSC ? '4/6 Free' : `${station.platforms - 1}/${station.platforms} Free`;

                    return (
                      <g
                        key={station.id}
                        transform={`translate(${x}, ${y})`}
                        className="cursor-pointer group"
                        onClick={() => setSelectedStationId(station.id)}
                      >
                        {/* Selected halo */}
                        {isSelected && (
                          <circle
                            r="20"
                            fill="none"
                            stroke="#f97316"
                            strokeWidth="2.5"
                            strokeDasharray="4 2"
                            className="animate-spin"
                          />
                        )}

                        {/* Station node body */}
                        <circle
                          r={isMajor ? 10 : 6}
                          fill={isMajor ? '#f97316' : '#0284c7'}
                          stroke="#ffffff"
                          strokeWidth={isMajor ? 2.5 : 1.5}
                          className="transition-transform group-hover:scale-125"
                        />

                        {/* Station Name & Platform Badge */}
                        <g transform={`translate(${isMajor ? 14 : 10}, -4)`}>
                          {/* Station Code Badge */}
                          <rect
                            x="-2"
                            y="-11"
                            width={station.id.length * 9 + 12}
                            height="16"
                            rx="3"
                            fill="#0f172a"
                            stroke={isMajor ? '#f97316' : '#38bdf8'}
                            strokeWidth="1"
                          />
                          <text
                            x="4"
                            y="1"
                            fill="#ffffff"
                            fontSize="10"
                            fontWeight="bold"
                            fontFamily="monospace"
                          >
                            {station.id}
                          </text>

                          {/* Full Name & Regional Script */}
                          <text
                            x={station.id.length * 9 + 16}
                            y="1"
                            fill="#e2e8f0"
                            fontSize="11"
                            fontWeight={isMajor ? 'bold' : 'normal'}
                          >
                            {station.name}
                          </text>

                          {/* Free Berths Pill */}
                          <rect
                            x="0"
                            y="7"
                            width="64"
                            height="13"
                            rx="3"
                            fill={isSC ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}
                            stroke={isSC ? '#ef4444' : '#10b981'}
                            strokeWidth="0.8"
                          />
                          <text
                            x="4"
                            y="17"
                            fill={isSC ? '#fca5a5' : '#86efac'}
                            fontSize="8.5"
                            fontWeight="bold"
                            fontFamily="monospace"
                          >
                            {isSC ? '⚠ 1 Conflict' : freePlatforms}
                          </text>
                        </g>
                      </g>
                    );
                  })}
                </g>
              )}

              {/* 5. MOVING TRAINS WITH LIVE KINEMATIC POSITIONING */}
              {layers.trains && (
                <g className="trains-layer">
                  {scenarioTrains.map((train) => {
                    const pos = livePositions.get(train.trainNumber);
                    if (!pos) return null;

                    const [x, y] = getSvgPoint(pos.lat, pos.lng);
                    const isSelected = selectedTrainNumber === train.trainNumber;
                    const isConflict = pos.hasConflict;
                    const isDelayed = pos.delayMin > 3;
                    
                    // Color code
                    const statusColor = isConflict
                      ? '#ef4444' // Red
                      : isDelayed
                      ? '#f59e0b' // Amber
                      : '#10b981'; // Green

                    return (
                      <g
                        key={train.trainNumber}
                        transform={`translate(${x}, ${y})`}
                        className="cursor-pointer transition-transform duration-300"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTrainNumber(train.trainNumber);
                          speakTelemetry(pos);
                        }}
                      >
                        {/* Beacon / Radar Glow for active moving train */}
                        {pos.state === 'moving' && (
                          <circle
                            r="22"
                            fill="none"
                            stroke={statusColor}
                            strokeWidth="1.2"
                            opacity="0.4"
                            className="animate-ping"
                          />
                        )}

                        {/* Selected Train Halo */}
                        {isSelected && (
                          <circle
                            r="20"
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="2"
                            strokeDasharray="4 3"
                            className="animate-spin"
                          />
                        )}

                        {/* Train Marker: Directional Arrow or Locomotive Body */}
                        <g transform={`rotate(${pos.bearingDeg})`}>
                          <path
                            d="M 0 -12 L 8 10 L 0 6 L -8 10 Z"
                            fill={statusColor}
                            stroke="#ffffff"
                            strokeWidth="1.5"
                            filter="url(#radarGlow)"
                          />
                        </g>

                        {/* Floating Live Telemetry Badge: [TrainID · Speed] */}
                        <g transform="translate(14, -14)">
                          {/* Badge Background */}
                          <rect
                            width="95"
                            height="24"
                            rx="5"
                            fill="#0b131e"
                            stroke={statusColor}
                            strokeWidth={isSelected ? '2' : '1'}
                            filter="drop-shadow(0 2px 6px rgba(0,0,0,0.6))"
                          />

                          {/* Train Number */}
                          <text
                            x="6"
                            y="11"
                            fill="#ffffff"
                            fontSize="9.5"
                            fontWeight="bold"
                            fontFamily="monospace"
                          >
                            {train.trainNumber}
                          </text>

                          {/* Live Speed in km/h */}
                          <text
                            x="6"
                            y="20"
                            fill={pos.inTSRZone ? '#f59e0b' : '#94a3b8'}
                            fontSize="8"
                            fontFamily="monospace"
                          >
                            {pos.state === 'dwelling'
                              ? 'DWELLING'
                              : `${pos.speedKmh} km/h`}
                          </text>

                          {/* Punctuality Indicator Dot */}
                          <circle
                            cx="85"
                            cy="12"
                            r="4"
                            fill={statusColor}
                          />
                        </g>
                      </g>
                    );
                  })}
                </g>
              )}
            </g>
          </svg>
        </div>

        {/* RIGHT: LIVE TRAIN & INCIDENT INSPECTOR DRAWER */}
        <aside className="w-80 md:w-96 flex-shrink-0 bg-[#0f1722]/95 backdrop-blur-md border-l border-slate-800 flex flex-col z-20 shadow-2xl">
          {selectedTrain ? (
            <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4">
              {/* Header with Close and Readout */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3 h-3 rounded-full ${
                      selectedTrain.hasConflict
                        ? 'bg-rose-500 animate-ping'
                        : selectedTrain.delayMin > 3
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                  />
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5 font-mono">
                      <span>{selectedTrain.trainNumber}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-sans">
                        {selectedTrain.serviceType}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 truncate max-w-[200px]">
                      {selectedTrain.name}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => speakTelemetry(selectedTrain)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                  title="Read aloud train status in voice"
                >
                  <Volume2 size={16} />
                </button>
              </div>

              {/* Large Speedometer Gauge */}
              <div className="bg-slate-900/90 rounded-xl p-3 border border-slate-800 text-center relative overflow-hidden">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span className="flex items-center gap-1">
                    <Gauge size={14} className="text-orange-400" />
                    Kinematic Speed
                  </span>
                  <span
                    className={`font-mono font-bold text-[10px] px-2 py-0.5 rounded ${
                      selectedTrain.inTSRZone
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {selectedTrain.inTSRZone ? '⚠️ TSR 20 KM/H LIMIT' : 'TRACK NOMINAL'}
                  </span>
                </div>

                <div className="my-2">
                  <span className="text-4xl font-black font-mono tracking-tight text-white">
                    {selectedTrain.speedKmh}
                  </span>
                  <span className="text-xs font-bold text-slate-400 ml-1.5">KM/H</span>
                </div>

                {/* Progress bar visual for speed */}
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      selectedTrain.inTSRZone
                        ? 'bg-amber-500'
                        : selectedTrain.speedKmh > 60
                        ? 'bg-emerald-400'
                        : 'bg-cyan-400'
                    }`}
                    style={{ width: `${Math.min(100, (selectedTrain.speedKmh / 90) * 100)}%` }}
                  />
                </div>
              </div>

              {/* 3 Key Operational Indicators */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Movement State</span>
                  <strong className="text-sm text-slate-100 font-semibold capitalize flex items-center gap-1.5 mt-0.5">
                    {selectedTrain.state === 'dwelling' ? (
                      <>
                        <Clock size={13} className="text-amber-400" />
                        Dwelling ({selectedTrain.dwellRemainingMin || 1}m)
                      </>
                    ) : selectedTrain.state === 'moving' ? (
                      <>
                        <Navigation size={13} className="text-emerald-400" />
                        Running Track
                      </>
                    ) : (
                      'Terminal'
                    )}
                  </strong>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Punctuality</span>
                  <strong
                    className={`text-sm font-semibold font-mono flex items-center gap-1 mt-0.5 ${
                      selectedTrain.delayMin > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {selectedTrain.delayMin > 0 ? `+${selectedTrain.delayMin} min delay` : 'Right-Time'}
                  </strong>
                </div>
              </div>

              {/* Kavach Safety Supervision Banner */}
              <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-xs">
                <div className="flex items-center gap-2 text-emerald-300 font-semibold mb-1">
                  <CheckCircle2 size={15} />
                  <span>Kavach 4.0 ATP Supervision: {selectedTrain.kavachStatus}</span>
                </div>
                <p className="text-[11px] text-emerald-200/70 leading-relaxed">
                  Automatic safety enforcement. 5-minute safety headway locked across track circuits.
                </p>
              </div>

              {/* Next Stop & Berthing Guidance */}
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-2">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Upcoming Movement
                </div>
                <div className="flex items-center justify-between text-slate-200">
                  <span>Next Station:</span>
                  <strong className="text-white font-semibold">
                    {selectedTrain.nextStationName || 'Terminus'}
                  </strong>
                </div>
                <div className="flex items-center justify-between text-slate-200">
                  <span>Assigned Platform:</span>
                  <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 font-mono font-bold">
                    Platform {selectedTrain.nextPlatform || 1}
                  </span>
                </div>
              </div>

              {/* Plain-Language Explainable AI ("Why?") */}
              <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-orange-400 font-bold text-[11px]">
                  <Activity size={13} />
                  <span>Kinematic Operational Rationale</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {selectedTrain.hasConflict
                    ? 'CRITICAL: Train is approaching Secunderabad Junction Platform 1 with less than 5 minutes headway gap behind another rake. Collision avoidance lock engaged.'
                    : selectedTrain.inTSRZone
                    ? 'Train is restricted to 20 km/h under TSR-14 safety rules for track renewal at KM 11.2. Kinematic running-time buffer added.'
                    : selectedTrain.delayMin > 0
                    ? `Train has accumulated ${selectedTrain.delayMin} min delay due to ${selectedTrain.delayReason}. Priority rake status preserved.`
                    : 'Train is running on nominal headway spacing with clear signal aspects and zero track conflicts.'}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                {selectedTrain.hasConflict && (
                  <button
                    onClick={() => onReviewConflict?.('SC-PF1-CLASH')}
                    className="w-full py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-rose-900/50"
                  >
                    <AlertTriangle size={15} />
                    <span>Review Conflict in Decision Support</span>
                  </button>
                )}

                <button
                  onClick={() => onNavigate?.('platforms')}
                  className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center justify-center gap-2 border border-slate-700"
                >
                  <span>Open Station Platform Board</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400">
              <TrainFront size={36} className="text-slate-600 mb-2" />
              <p className="text-xs">Click any moving train or station on the map to inspect live kinematics.</p>
            </div>
          )}
        </aside>
      </div>

      {/* 3. BOTTOM: SIMULATION TIME-MACHINE & SCENARIO CONTROL BAR */}
      <footer className="flex-shrink-0 bg-[#0f1722]/95 backdrop-blur-md border-t border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 z-30">
        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-md"
            title={isPlaying ? 'Pause Simulation' : 'Play Simulation'}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            <span>{isPlaying ? 'Pause' : 'Resume'}</span>
          </button>

          {/* Speed Multipliers */}
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5 text-xs font-mono">
            {[1, 5, 10, 60].map((spd) => (
              <button
                key={spd}
                onClick={() => setPlaybackSpeed(spd)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  playbackSpeed === spd
                    ? 'bg-slate-700 text-orange-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          {/* Live Now button */}
          <button
            onClick={syncWithWallClock}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs flex items-center gap-1"
            title="Synchronize to current real time"
          >
            <Clock size={13} />
            <span>Live (Now)</span>
          </button>
        </div>

        {/* Time Slider & Scrub Clock */}
        <div className="flex-1 max-w-xl flex items-center gap-3">
          <span className="text-xs font-mono text-slate-400">15:30</span>
          <input
            type="range"
            min={930} // 15:30
            max={1080} // 18:00
            step={0.5}
            value={simMinute}
            onChange={(e) => setSimMinute(parseFloat(e.target.value))}
            className="flex-1 accent-orange-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
          />
          <span className="text-xs font-mono text-slate-400">18:00</span>

          {/* Current Simulation Clock Readout */}
          <div className="px-3 py-1 rounded-md bg-slate-900 border border-slate-700/80 font-mono font-bold text-sm text-orange-400">
            {simTimeString} IST
          </div>
        </div>

        {/* Scenario Injection Selector */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-400 hidden lg:inline">Scenario:</span>
          <button
            onClick={() => setActiveScenario('conflict')}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              activeScenario === 'conflict'
                ? 'bg-rose-500 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Secunderabad Platform 1 headway conflict (T104/T107)"
          >
            SC Conflict
          </button>
          <button
            onClick={() => setActiveScenario('tsr')}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              activeScenario === 'tsr'
                ? 'bg-amber-500 text-black font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="TSR-14 restriction at KM 11.2 (20 km/h limit)"
          >
            TSR Slowdown
          </button>
          <button
            onClick={() => setActiveScenario('monsoon')}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              activeScenario === 'monsoon'
                ? 'bg-cyan-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Heavy rain waterlogging caution"
          >
            Monsoon
          </button>
          <button
            onClick={() => setActiveScenario('normal')}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              activeScenario === 'normal'
                ? 'bg-emerald-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Clear nominal timetable"
          >
            Clear
          </button>
        </div>
      </footer>
    </div>
  );
}
