import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Compass,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Radio,
  AlertTriangle,
  Gauge,
  Clock,
  ArrowRight,
  TrainFront,
  Navigation,
  ZoomIn,
  ZoomOut,
  Sliders,
  Activity,
  Search,
  ListFilter,
  Zap,
  Info,
  Calendar,
  X,
} from 'lucide-react';

import {
  HYDERABAD_STATIONS,
  HYDERABAD_TRACK_SEGMENTS,
  ACTIVE_TSR_ZONES,
  WATCHLIST_20_TRAINS,
  type DataSourceType,
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

  // Three Data Sources Switcher: 'live' | 'replay' | 'simulated'
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceType>('live');

  // Live provider ping simulation counter
  const [dataAgeSeconds, setDataAgeSeconds] = useState<number>(24);

  // Simulation Clock: start at 16:25 (985 minutes from midnight)
  const [simMinute, setSimMinute] = useState<number>(985);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1); // 1x, 5x, 10x, 60x

  // Pin Any Train by Code Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Watchlist Drawer state
  const [watchlistOpen, setWatchlistOpen] = useState<boolean>(false);
  const [watchlistFilter, setWatchlistFilter] = useState<'all' | 'mainline' | 'vande' | 'mmts' | 'freight'>('all');

  // Selected train for inspector drawer
  const [selectedTrainNumber, setSelectedTrainNumber] = useState<string>('12723');
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
  const svgHeight = 700;

  // Active scenario
  const [activeScenario, setActiveScenario] = useState<'normal' | 'tsr' | 'conflict' | 'monsoon'>('conflict');

  // Keyboard shortcut '/' to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')
      ) {
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Live provider age heartbeat
  useEffect(() => {
    const timer = setInterval(() => {
      setDataAgeSeconds((prev) => (prev >= 60 ? 5 : prev + 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Adjust tracked train delays based on scenario and data source
  const scenarioTrains = useMemo(() => {
    return WATCHLIST_20_TRAINS.map((t) => {
      let delay = t.currentDelayMin;
      let reason = t.delayReason;

      if (activeScenario === 'monsoon') {
        delay += 12;
        reason = 'Suburban waterlogging caution between Secunderabad and Begumpet';
      } else if (activeScenario === 'tsr' && (t.trainNumber === '12727' || t.trainNumber === '47178')) {
        delay += 8;
        reason = 'Kinematic deceleration through KM 11.2 TSR-14 speed limit zone';
      } else if (activeScenario === 'normal') {
        if (t.trainNumber === 'T104' || t.trainNumber === 'T107') delay = 0;
        reason = 'Operating according to published timetable';
      }

      return {
        ...t,
        source: dataSourceMode,
        dataAgeSeconds: dataSourceMode === 'live' ? dataAgeSeconds : t.dataAgeSeconds,
        currentDelayMin: delay,
        delayReason: reason,
      };
    });
  }, [activeScenario, dataSourceMode, dataAgeSeconds]);

  // Base simulation minute: 16:00 IST (960 min from midnight)
  const BASE_SIM_MINUTE = 960;
  const currentRelativeMinute = simMinute >= 930 ? simMinute - BASE_SIM_MINUTE : simMinute;

  // Compute live positions of all 20 trains at currentRelativeMinute
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

  // Auto-tick simulation timer
  useEffect(() => {
    if (!isPlaying) return;

    const intervalMs = Math.max(80, Math.floor(1000 / playbackSpeed));
    const timer = setInterval(() => {
      setSimMinute((prev) => {
        if (prev >= 1080) return 930; // wrap around between 15:30 (930m) and 18:00 (1080m)
        return prev + 0.1;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed]);

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
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

  // Pin & fly to a train
  const handlePinTrain = (trainNo: string) => {
    const pos = livePositions.get(trainNo);
    setSelectedTrainNumber(trainNo);
    setIsSearchOpen(false);
    setSearchQuery('');

    if (pos) {
      const [targetX, targetY] = getSvgPoint(pos.lat, pos.lng);
      // Smooth center
      setZoom(1.35);
      setPan({
        x: svgWidth / 2 - targetX * 1.35,
        y: svgHeight / 2 - targetY * 1.35,
      });

      if (!voiceMuted) {
        speakTelemetry(pos);
      }
    }
  };

  // Sync with real wall clock
  const syncWithWallClock = () => {
    const d = new Date();
    const min = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    setSimMinute(min);
  };

  // Voice narration of selected train
  const speakTelemetry = (pos: LiveTrainPosition) => {
    if (voiceMuted) return;
    const text = `Train ${pos.trainNumber}, ${pos.name}. Speed: ${pos.speedKmh} kilometres per hour. Status: ${
      pos.state === 'dwelling'
        ? `Dwelling at ${pos.currentStationName}, scheduled departure in ${pos.dwellRemainingMin || 1} minutes.`
        : `Moving towards ${pos.nextStationName || 'destination'}.`
    } Punctuality: ${pos.delayMin > 0 ? `${pos.delayMin} minutes delayed` : 'Right time'}. ${
      pos.inTSRZone ? 'Caution: Running inside TSR-14 restriction zone.' : ''
    } Kavach ATP supervision status: ${pos.kavachStatus}.`;

    speak(text, prefs.language || 'en');
  };

  // Autocomplete train search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return scenarioTrains.slice(0, 8);
    const q = searchQuery.toLowerCase().trim();
    return scenarioTrains.filter(
      (t) => t.trainNumber.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
    );
  }, [searchQuery, scenarioTrains]);

  // Filtered watchlist trains
  const filteredWatchlist = useMemo(() => {
    if (watchlistFilter === 'all') return scenarioTrains;
    if (watchlistFilter === 'vande') return scenarioTrains.filter((t) => t.serviceType === 'Vande Bharat');
    if (watchlistFilter === 'mainline') return scenarioTrains.filter((t) => t.serviceType.includes('Express') && t.serviceType !== 'Vande Bharat');
    if (watchlistFilter === 'mmts') return scenarioTrains.filter((t) => t.serviceType === 'MMTS Commuter');
    if (watchlistFilter === 'freight') return scenarioTrains.filter((t) => t.serviceType === 'Freight Rake');
    return scenarioTrains;
  }, [scenarioTrains, watchlistFilter]);

  // Simulation clock display string (HH:MM:SS)
  const simTimeString = useMemo(() => {
    const totalSecs = Math.floor(simMinute * 60);
    const hrs = Math.floor(totalSecs / 3600) % 24;
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [simMinute]);

  return (
    <div className="live-radar-console relative w-full h-[calc(100vh-76px)] min-h-[660px] flex flex-col bg-[#070b10] text-slate-100 overflow-hidden select-none font-sans rounded-xl border border-slate-800 shadow-2xl">
      {/* 1. TOP OCC COMMAND BAR WITH 3-TIER DATA SOURCES & PIN-BY-CODE */}
      <header className="flex-shrink-0 flex flex-wrap items-center justify-between px-4 py-2 bg-[#0d141f]/95 backdrop-blur-md border-b border-slate-800/90 z-30 gap-2">
        {/* Left: Corridor Brand & 3-Tier Data Source Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-orange-500/10 border border-orange-500/30">
            <Radio size={15} className="text-orange-400 animate-pulse" />
            <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">
              Hyderabad OCC Live Radar
            </span>
          </div>

          {/* 3 Data Sources Selector */}
          <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-lg p-0.5 text-xs font-medium">
            <button
              onClick={() => setDataSourceMode('live')}
              className={`px-2.5 py-0.5 rounded transition-all flex items-center gap-1.5 ${
                dataSourceMode === 'live'
                  ? 'bg-emerald-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Priority 1: Real third-party provider status with freshness heartbeat"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>LIVE</span>
              <span className="text-[10px] font-mono opacity-80">{dataAgeSeconds}s</span>
            </button>

            <button
              onClick={() => setDataSourceMode('replay')}
              className={`px-2.5 py-0.5 rounded transition-all flex items-center gap-1.5 ${
                dataSourceMode === 'replay'
                  ? 'bg-cyan-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Priority 2: Genuine recorded snapshot (11 Nov 2026 09:00-12:00 IST)"
            >
              <Calendar size={12} />
              <span>REPLAY</span>
              <span className="text-[10px] font-mono opacity-80">09:14</span>
            </button>

            <button
              onClick={() => setDataSourceMode('simulated')}
              className={`px-2.5 py-0.5 rounded transition-all flex items-center gap-1.5 ${
                dataSourceMode === 'simulated'
                  ? 'bg-purple-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Priority 3: Timetable kinematic solver fallback"
            >
              <Zap size={12} />
              <span>SIMULATED</span>
            </button>
          </div>
        </div>

        {/* Center: PIN ANY TRAIN BY CODE SEARCH BOX (with / shortcut) */}
        <div className="relative flex items-center">
          <div className="relative flex items-center w-64 md:w-80">
            <Search size={14} className="absolute left-2.5 text-slate-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              placeholder="Pin train by code (12723, 20701...) · Press /"
              className="w-full bg-slate-900/90 border border-slate-700/80 rounded-lg pl-8 pr-12 py-1 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-orange-500 font-mono transition-colors"
            />
            <kbd className="absolute right-2 text-[10px] px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">
              /
            </kbd>
          </div>

          {/* Autocomplete Popup */}
          {isSearchOpen && (
            <div className="absolute top-9 left-0 right-0 max-h-72 overflow-y-auto bg-[#0f1724] border border-slate-700 rounded-xl shadow-2xl z-50 p-1 divide-y divide-slate-800">
              <div className="px-2 py-1 text-[10px] uppercase font-bold text-slate-400 tracking-wider flex justify-between items-center">
                <span>Select from 20 Corridor Trains</span>
                <button
                  onClick={() => setIsSearchOpen(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={12} />
                </button>
              </div>

              {searchResults.length > 0 ? (
                searchResults.map((t) => (
                  <button
                    key={t.trainNumber}
                    onClick={() => handlePinTrain(t.trainNumber)}
                    className="w-full text-left p-2 rounded-lg hover:bg-slate-800 flex items-center justify-between group transition-colors"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-white">
                        <span className="text-orange-400">{t.trainNumber}</span>
                        <span className="text-slate-200 truncate">{t.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {t.originId} → {t.destId} · {t.serviceType}
                      </div>
                    </div>

                    <div className="flex flex-col items-end flex-shrink-0">
                      <span
                        className={`text-[10px] font-bold font-mono px-1.5 py-0.2 rounded ${
                          t.currentDelayMin > 3 ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {t.currentDelayMin > 0 ? `+${t.currentDelayMin}m` : 'RT'}
                      </span>
                      <span className="text-[9px] text-slate-400 font-mono mt-0.5 uppercase">
                        {t.source}
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-3 text-center text-xs text-slate-400">
                  <p>Train &quot;{searchQuery}&quot; isn&apos;t running today.</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Pick from the 20 active trains in your watchlist.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Watchlist Drawer Button, Mode Switcher & Voice */}
        <div className="flex items-center gap-2">
          {/* Watchlist Toggle */}
          <button
            onClick={() => setWatchlistOpen(!watchlistOpen)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5 ${
              watchlistOpen
                ? 'bg-orange-500 text-white border-orange-400 font-bold'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title="Open 20-Train Watchlist Drawer"
          >
            <ListFilter size={14} />
            <span>Watchlist (20)</span>
          </button>

          {/* Mode Switcher */}
          <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-lg p-0.5 text-xs font-medium">
            <button
              onClick={() => setMapMode('geo')}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                mapMode === 'geo'
                  ? 'bg-orange-500 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Conformal City-Core OCC Geographic Radar"
            >
              <Compass size={13} />
              <span className="hidden sm:inline">Geographic OCC</span>
            </button>
            <button
              onClick={() => setMapMode('schematic')}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                mapMode === 'schematic'
                  ? 'bg-orange-500 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Topological Synoptic Signalling Panel"
            >
              <Sliders size={13} />
              <span className="hidden sm:inline">Schematic Panel</span>
            </button>
          </div>

          {/* Audio voice toggle */}
          <button
            onClick={() => {
              setVoiceMuted(!voiceMuted);
              if (voiceMuted && selectedTrain) speakTelemetry(selectedTrain);
            }}
            className={`p-1.5 rounded-lg border text-xs transition-colors flex items-center gap-1 ${
              voiceMuted
                ? 'bg-slate-800 border-slate-700 text-slate-400'
                : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
            }`}
            title={voiceMuted ? 'Voice readout muted' : 'Voice readout active'}
          >
            {voiceMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        </div>
      </header>

      {/* 2. MAIN RADAR CANVAS & PANELS */}
      <div className="relative flex-1 flex overflow-hidden">
        {/* WATCHLIST DRAWER (SLIDE-OUT ON LEFT) */}
        {watchlistOpen && (
          <aside className="absolute top-0 bottom-0 left-0 w-80 bg-[#0c131e]/98 backdrop-blur-md border-r border-slate-800 z-30 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
            {/* Drawer Header */}
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <ListFilter size={14} className="text-orange-400" />
                  Corridor 20-Train Watchlist
                </h3>
                <span className="text-[10px] text-slate-400">South Central Railway Active Rakes</span>
              </div>
              <button
                onClick={() => setWatchlistOpen(false)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X size={15} />
              </button>
            </div>

            {/* Category Filter Pills */}
            <div className="p-2 border-b border-slate-800 flex flex-wrap gap-1 text-[10px] font-medium">
              {[
                { id: 'all', label: 'All (20)' },
                { id: 'mainline', label: 'Express (10)' },
                { id: 'vande', label: 'Vande Bharat (2)' },
                { id: 'mmts', label: 'MMTS (6)' },
                { id: 'freight', label: 'Freight (2)' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setWatchlistFilter(tab.id as any)}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    watchlistFilter === tab.id
                      ? 'bg-orange-500 text-white font-bold'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Watchlist Train Rows */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 divide-y divide-slate-800/60">
              {filteredWatchlist.map((t) => {
                const pos = livePositions.get(t.trainNumber);
                const isSelected = selectedTrainNumber === t.trainNumber;

                return (
                  <div
                    key={t.trainNumber}
                    onClick={() => handlePinTrain(t.trainNumber)}
                    className={`pt-1.5 pb-1.5 px-2 rounded-lg cursor-pointer transition-colors flex items-center justify-between ${
                      isSelected
                        ? 'bg-orange-500/15 border border-orange-500/40 text-white'
                        : 'hover:bg-slate-800/60 text-slate-300'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold font-mono">
                        <span className="text-orange-400">{t.trainNumber}</span>
                        <span className="text-white truncate">{t.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {t.originId} → {t.destId} · {pos?.state === 'dwelling' ? 'Dwelling @ ' + pos.currentStationId : `${pos?.speedKmh || 0} km/h`}
                      </div>
                    </div>

                    <div className="flex flex-col items-end flex-shrink-0">
                      <span
                        className={`text-[10px] font-bold font-mono px-1.5 py-0.2 rounded ${
                          t.currentDelayMin > 3
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {t.currentDelayMin > 0 ? `+${t.currentDelayMin}m` : 'RT'}
                      </span>
                      <span className="text-[9px] text-slate-400 font-mono mt-0.5 uppercase">
                        {t.source}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {/* LEFT FLOATING LAYER CONTROLS */}
        <div className="absolute top-4 left-4 z-20 flex flex-col gap-2 max-w-[200px] w-full">
          {/* Zoom & Pan Controls */}
          <div className="flex items-center gap-1.5 bg-[#0f1722]/90 border border-slate-800 rounded-lg p-1 w-fit shadow-xl">
            <button
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-300"
              title="Zoom In"
            >
              <ZoomIn size={15} />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(0.7, z - 0.2))}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-300"
              title="Zoom Out"
            >
              <ZoomOut size={15} />
            </button>
            <button
              onClick={resetView}
              className="px-2 py-0.5 rounded hover:bg-slate-800 text-slate-300 text-[10px] font-mono"
              title="Reset View"
            >
              Reset
            </button>
          </div>
        </div>

        {/* CENTER: SVG RADAR CANVAS WITH CITY-CORE CONFORMAL EXPANSION */}
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
              {/* Luminous Glow Filters */}
              <filter id="trainGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              {/* Linear Gradients for Motion Wake Trails */}
              <linearGradient id="wakeTrailGreen" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.0" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.8" />
              </linearGradient>

              <linearGradient id="wakeTrailAmber" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.0" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.8" />
              </linearGradient>

              <linearGradient id="wakeTrailCyan" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.0" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8" />
              </linearGradient>
            </defs>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* 1. TRACK SEGMENTS (Double Ballast & MMTS Suburban) */}
              <g className="tracks-layer">
                {HYDERABAD_TRACK_SEGMENTS.map((seg) => {
                  const isMMTS = seg.type === 'mmts';
                  const pathData = seg.coordinates
                    .map((pt, idx) => {
                      const [x, y] = getSvgPoint(pt[0], pt[1]);
                      return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                    })
                    .join(' ');

                  return (
                    <g key={seg.id}>
                      {/* Outer track ballast */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke={isMMTS ? '#0e2a38' : '#172233'}
                        strokeWidth={isMMTS ? 8 : 7}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Active rail steel */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke={isMMTS ? '#06b6d4' : '#475569'}
                        strokeWidth={isMMTS ? 3.5 : 2.5}
                        strokeDasharray={isMMTS ? '8 4' : undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.85}
                      />
                    </g>
                  );
                })}
              </g>

              {/* 2. TSR-14 SPEED RESTRICTION ZONE (KM 11.2 - 11.8 on SC-HYB Line) */}
              {ACTIVE_TSR_ZONES.map((tsr) => {
                const pts = tsr.coordinates.map((c) => getSvgPoint(c[0], c[1]));
                const pathData = pts
                  .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`)
                  .join(' ');
                const midPoint = pts[Math.floor(pts.length / 2)] || [pts[0][0], pts[0][1]];

                return (
                  <g key={tsr.id}>
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

                    {/* Floating Caution Badge with clean offset */}
                    <g transform={`translate(${midPoint[0] - 65}, ${midPoint[1] - 28})`}>
                      <rect
                        width="130"
                        height="20"
                        rx="4"
                        fill="#1c1917"
                        stroke="#f59e0b"
                        strokeWidth="1.2"
                      />
                      <text
                        x="65"
                        y="14"
                        textAnchor="middle"
                        fill="#fef08a"
                        fontSize="9.5"
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        ⚠️ TSR-14: 20 km/h
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* 3. HEADWAY CONFLICT RADAR PULSE (At Secunderabad Jn Platform 1) */}
              {(() => {
                const scStation = HYDERABAD_STATIONS.find((s) => s.id === 'SC');
                if (!scStation) return null;
                const [scX, scY] = getSvgPoint(scStation.lat, scStation.lng, 'SC');

                return (
                  <g transform={`translate(${scX + 10}, ${scY - 32})`}>
                    {/* Radar warning rings */}
                    <circle
                      r="26"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="1.5"
                      opacity="0.6"
                      className="animate-ping"
                    />
                    <circle
                      r="16"
                      fill="rgba(239, 68, 68, 0.25)"
                      stroke="#ef4444"
                      strokeWidth="2"
                    />

                    {/* Interactive Banner */}
                    <g
                      className="cursor-pointer"
                      onClick={() => onReviewConflict?.('SC-PF1-CLASH')}
                      transform="translate(20, -14)"
                    >
                      <rect
                        width="180"
                        height="32"
                        rx="5"
                        fill="#450a0a"
                        stroke="#ef4444"
                        strokeWidth="1.5"
                      />
                      <text
                        x="8"
                        y="13"
                        fill="#fecaca"
                        fontSize="9.5"
                        fontWeight="bold"
                      >
                        HEADWAY CLASH: T104 / T107
                      </text>
                      <text
                        x="8"
                        y="25"
                        fill="#f87171"
                        fontSize="8.5"
                        fontFamily="monospace"
                      >
                        SC Platform 1 · Click to Solve →
                      </text>
                    </g>
                  </g>
                );
              })()}

              {/* 4. STATIONS (With Non-Overlapping Label Offsets & Berths) */}
              <g className="stations-layer">
                {HYDERABAD_STATIONS.map((station) => {
                  const [x, y] = getSvgPoint(station.lat, station.lng, station.id);
                  const isMajor = station.category === 'major-terminal';
                  const isSelected = selectedStationId === station.id;
                  const isSC = station.id === 'SC';
                  const freePlatforms = isSC ? '4/6 Free' : `${station.platforms - 1}/${station.platforms} Free`;

                  const offset = station.labelOffset;

                  return (
                    <g
                      key={station.id}
                      transform={`translate(${x}, ${y})`}
                      className="cursor-pointer group"
                      onClick={() => setSelectedStationId(station.id)}
                    >
                      {/* Selection Halo */}
                      {isSelected && (
                        <circle
                          r="18"
                          fill="none"
                          stroke="#f97316"
                          strokeWidth="2.5"
                          strokeDasharray="4 2"
                          className="animate-spin"
                        />
                      )}

                      {/* Station Core Node */}
                      <circle
                        r={isMajor ? 9 : 6}
                        fill={isMajor ? '#f97316' : '#0284c7'}
                        stroke="#ffffff"
                        strokeWidth={isMajor ? 2.5 : 1.5}
                        className="transition-transform group-hover:scale-125"
                      />

                      {/* Station Label Callout with Non-Colliding Offset */}
                      <g transform={`translate(${offset.x}, ${offset.y})`}>
                        {/* Station Pill Background */}
                        <rect
                          x="0"
                          y="0"
                          width={station.name.length * 6.5 + 45}
                          height="24"
                          rx="4"
                          fill="#0b131e"
                          stroke={isMajor ? '#f97316' : '#38bdf8'}
                          strokeWidth="1"
                          filter="drop-shadow(0 2px 5px rgba(0,0,0,0.7))"
                        />

                        {/* Station Code Badge */}
                        <text
                          x="6"
                          y="16"
                          fill="#f97316"
                          fontSize="10"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {station.id}
                        </text>

                        {/* Station Name */}
                        <text
                          x="34"
                          y="15"
                          fill="#ffffff"
                          fontSize="10"
                          fontWeight="bold"
                        >
                          {station.name.replace(/\s*\(.*\)/, '')}
                        </text>

                        {/* Capacity Pill */}
                        <rect
                          x={station.name.length * 6.5 - 15}
                          y="4"
                          width="55"
                          height="16"
                          rx="3"
                          fill={isSC ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.2)'}
                          stroke={isSC ? '#ef4444' : '#10b981'}
                          strokeWidth="0.8"
                        />
                        <text
                          x={station.name.length * 6.5 + 12}
                          y="15"
                          textAnchor="middle"
                          fill={isSC ? '#fca5a5' : '#86efac'}
                          fontSize="8.5"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {freePlatforms}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </g>

              {/* 5. MOVING TRAINS WITH MOTION WAKE TRAILS & RAKE SILHOUETTES */}
              <g className="trains-layer">
                {scenarioTrains.map((train) => {
                  const pos = livePositions.get(train.trainNumber);
                  if (!pos) return null;

                  const [x, y] = getSvgPoint(pos.lat, pos.lng);
                  const isSelected = selectedTrainNumber === train.trainNumber;
                  const isConflict = pos.hasConflict;
                  const isDelayed = pos.delayMin > 3;

                  // Traffic light color code
                  const statusColor = isConflict
                    ? '#ef4444' // Red
                    : isDelayed
                    ? '#f59e0b' // Amber
                    : '#10b981'; // Green

                  // Motion wake trail line
                  const trailPath = pos.trailPoints
                    .map((pt, idx) => {
                      const [tx, ty] = getSvgPoint(pt[0], pt[1]);
                      return `${idx === 0 ? 'M' : 'L'} ${tx} ${ty}`;
                    })
                    .join(' ');

                  return (
                    <g
                      key={train.trainNumber}
                      className="cursor-pointer transition-transform duration-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePinTrain(train.trainNumber);
                      }}
                    >
                      {/* Motion Wake Trail behind train */}
                      {pos.state === 'moving' && pos.trailPoints.length > 1 && (
                        <path
                          d={trailPath}
                          fill="none"
                          stroke={statusColor}
                          strokeWidth="3.5"
                          strokeOpacity="0.4"
                          strokeLinecap="round"
                        />
                      )}

                      {/* Moving Train Marker Body */}
                      <g transform={`translate(${x}, ${y})`}>
                        {/* Beacon / Radar Glow for active moving train */}
                        {pos.state === 'moving' && (
                          <circle
                            r="20"
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
                            r="18"
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="2"
                            strokeDasharray="4 3"
                            className="animate-spin"
                          />
                        )}

                        {/* Directional Locomotive Icon rotated to bearing */}
                        <g transform={`rotate(${pos.bearingDeg})`}>
                          <path
                            d="M 0 -11 L 7 8 L 0 5 L -7 8 Z"
                            fill={statusColor}
                            stroke="#ffffff"
                            strokeWidth="1.5"
                            filter="url(#trainGlow)"
                          />
                        </g>

                        {/* Sleek Floating Micro-Pill: [12723 · 74 km/h] */}
                        <g transform="translate(12, -14)">
                          <rect
                            width="90"
                            height="22"
                            rx="4"
                            fill="#0b131e"
                            stroke={statusColor}
                            strokeWidth={isSelected ? '2' : '1'}
                            filter="drop-shadow(0 2px 5px rgba(0,0,0,0.8))"
                          />

                          {/* Train Number */}
                          <text
                            x="6"
                            y="11"
                            fill="#ffffff"
                            fontSize="9"
                            fontWeight="bold"
                            fontFamily="monospace"
                          >
                            {train.trainNumber}
                          </text>

                          {/* Speed readout */}
                          <text
                            x="6"
                            y="19"
                            fill={pos.inTSRZone ? '#f59e0b' : '#94a3b8'}
                            fontSize="7.5"
                            fontFamily="monospace"
                          >
                            {pos.state === 'dwelling' ? 'DWELL' : `${pos.speedKmh} km/h`}
                          </text>

                          {/* Non-color symbol: check, clock, or warn */}
                          <text
                            x="78"
                            y="14"
                            textAnchor="middle"
                            fill={statusColor}
                            fontSize="9"
                            fontWeight="bold"
                          >
                            {isConflict ? '⚠' : isDelayed ? '⏱' : '✓'}
                          </text>
                        </g>
                      </g>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        </div>

        {/* RIGHT: INSPECTOR DRAWER WITH JOURNEY TIMELINE STRIP */}
        <aside className="w-80 md:w-96 flex-shrink-0 bg-[#0f1722]/95 backdrop-blur-md border-l border-slate-800 flex flex-col z-20 shadow-2xl">
          {selectedTrain ? (
            <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-3.5">
              {/* Header with Title & Service */}
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
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

              {/* Data Source & Provenance Disclosure Badge */}
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono">
                <span className="text-slate-400 flex items-center gap-1">
                  <Info size={12} className="text-cyan-400" />
                  Source:
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    selectedTrain.source === 'live'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : selectedTrain.source === 'replay'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  }`}
                >
                  {selectedTrain.source === 'live'
                    ? `LIVE · updated ${selectedTrain.dataAgeSeconds}s ago`
                    : selectedTrain.source === 'replay'
                    ? `REPLAY · ${selectedTrain.recordedAt}`
                    : 'SIMULATED'}
                </span>
              </div>

              {/* Estimation Disclaimer */}
              <p className="text-[10px] text-slate-400 leading-tight italic px-1">
                {selectedTrain.isEstimated
                  ? `* Position estimated between ${selectedTrain.fromStationId || 'Origin'} and ${selectedTrain.nextStationId || 'Next'} based on schedule & reported delay.`
                  : '* Direct satellite / Kavach ATP telemetry.'}
              </p>

              {/* Kinematic Speedometer Gauge */}
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

                <div className="my-1.5">
                  <span className="text-3xl font-black font-mono tracking-tight text-white">
                    {selectedTrain.speedKmh}
                  </span>
                  <span className="text-xs font-bold text-slate-400 ml-1.5">KM/H</span>
                </div>

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

              {/* 2 Quick Operational Indicators */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Movement</span>
                  <strong className="text-xs text-slate-100 font-semibold capitalize flex items-center gap-1 mt-0.5">
                    {selectedTrain.state === 'dwelling' ? (
                      <>
                        <Clock size={12} className="text-amber-400" />
                        Dwelling ({selectedTrain.dwellRemainingMin || 1}m)
                      </>
                    ) : selectedTrain.state === 'moving' ? (
                      <>
                        <Navigation size={12} className="text-emerald-400" />
                        Running Track
                      </>
                    ) : (
                      'Terminal'
                    )}
                  </strong>
                </div>

                <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Punctuality</span>
                  <strong
                    className={`text-xs font-semibold font-mono flex items-center gap-1 mt-0.5 ${
                      selectedTrain.delayMin > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {selectedTrain.delayMin > 0 ? `+${selectedTrain.delayMin} min delay` : 'Right-Time'}
                  </strong>
                </div>
              </div>

              {/* JOURNEY TIMELINE STRIP (HALTS & PLATFORMS) */}
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-2">
                <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  <span>Journey Timeline Strip</span>
                  <span className="font-mono text-cyan-400">{selectedTrain.journeyStops.length} Halts</span>
                </div>

                <div className="space-y-2 relative pl-3 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-700">
                  {selectedTrain.journeyStops.map((stop, idx) => {
                    const isPassed = currentRelativeMinute > stop.schedDepMin + selectedTrain.delayMin;
                    const isCurrent = currentRelativeMinute >= stop.schedArrMin + selectedTrain.delayMin && currentRelativeMinute <= stop.schedDepMin + selectedTrain.delayMin;

                    return (
                      <div key={idx} className="relative flex items-center justify-between text-[11px]">
                        <span
                          className={`absolute -left-3 w-2 h-2 rounded-full ${
                            isCurrent
                              ? 'bg-orange-500 ring-2 ring-orange-300'
                              : isPassed
                              ? 'bg-emerald-500'
                              : 'bg-slate-600'
                          }`}
                        />
                        <div className="pl-1">
                          <strong className={isCurrent ? 'text-orange-400 font-bold' : isPassed ? 'text-slate-400' : 'text-slate-200'}>
                            {stop.stationName}
                          </strong>
                          <span className="text-[10px] text-slate-400 ml-1.5 font-mono">
                            PF {stop.platform}
                          </span>
                        </div>

                        <span className="font-mono text-[10px] text-slate-400">
                          {stop.expectedTime}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Explainable AI ("Why?") */}
              <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-1">
                <div className="flex items-center gap-1.5 text-orange-400 font-bold text-[11px]">
                  <Activity size={12} />
                  <span>Explainable AI Rationale</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {selectedTrain.hasConflict
                    ? 'CRITICAL: Train is approaching Secunderabad Jn Platform 1 with less than 5 minutes headway margin behind another rake. Interlocking holds signal at danger.'
                    : selectedTrain.inTSRZone
                    ? 'Speed restricted to 20 km/h due to active TSR-14 track screening between Hussain Sagar and Khairatabad. Kinematic slack applied.'
                    : selectedTrain.delayMin > 0
                    ? `Train has accumulated ${selectedTrain.delayMin} min delay due to ${selectedTrain.delayReason}. Priority rake status preserved.`
                    : 'Nominal corridor run. Automatic 5-minute safety headway enforced under Kavach supervision.'}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-1.5 pt-1 border-t border-slate-800">
                {selectedTrain.hasConflict && (
                  <button
                    onClick={() => onReviewConflict?.('SC-PF1-CLASH')}
                    className="w-full py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-rose-900/50"
                  >
                    <AlertTriangle size={14} />
                    <span>Review Conflict in Decision Support</span>
                  </button>
                )}

                <button
                  onClick={() => onNavigate?.('platforms')}
                  className="w-full py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center justify-center gap-2 border border-slate-700"
                >
                  <span>Open Platform Board</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400">
              <TrainFront size={36} className="text-slate-600 mb-2" />
              <p className="text-xs">Select or pin any train on the map to inspect live kinematics &amp; journey progress.</p>
            </div>
          )}
        </aside>
      </div>

      {/* 3. BOTTOM: SIMULATION TIME-MACHINE & SCENARIO CONTROL BAR */}
      <footer className="flex-shrink-0 bg-[#0d141f]/95 backdrop-blur-md border-t border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-3 z-30">
        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center gap-1.5 shadow"
            title={isPlaying ? 'Pause Simulation' : 'Play Simulation'}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
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
            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs flex items-center gap-1"
            title="Synchronize to current real time"
          >
            <Clock size={12} />
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
          <div className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 font-mono font-bold text-xs text-orange-400">
            {simTimeString} IST
          </div>
        </div>

        {/* Scenario Injection Selector */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-400 hidden lg:inline text-[11px]">Scenario:</span>
          <button
            onClick={() => setActiveScenario('conflict')}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              activeScenario === 'conflict'
                ? 'bg-rose-500 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Secunderabad Platform 1 headway conflict"
          >
            SC Conflict
          </button>
          <button
            onClick={() => setActiveScenario('tsr')}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              activeScenario === 'tsr'
                ? 'bg-amber-500 text-black font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="TSR-14 restriction at KM 11.2 (20 km/h limit)"
          >
            TSR Zone
          </button>
          <button
            onClick={() => setActiveScenario('monsoon')}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
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
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
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
