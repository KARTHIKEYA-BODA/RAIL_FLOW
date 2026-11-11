import { useState, useRef, useMemo } from 'react';
import {
  Clock,
  ArrowRight,
  Volume2,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import type { ConflictItem, Recommendation } from '../../types/railway';

interface Props {
  incident: ConflictItem | null;
  suggested: Recommendation | null;
  conflictCount: number;
  activeDelayCount: number;
  totalTrains: number;
  onTimePct: number;
  onReview: (id?: string) => void;
  onReadAlert: () => void;
}

export function SorvoCorridorHero({
  incident,
  suggested,
  conflictCount,
  activeDelayCount,
  totalTrains,
  onTimePct,
  onReview,
  onReadAlert,
}: Props) {
  // Scrub cursor state (0 to 100 percentage across the 45-minute horizon)
  const [scrubPct, setScrubPct] = useState(65);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Compute scrub time in minutes (0m to 45m)
  const scrubMinute = Math.round((scrubPct / 100) * 45);

  // Dynamic scrub readout data
  const scrubData = useMemo(() => {
    // Kinematic curve formula: starts at nominal 7m headway, drops down to 1.8m at conflict horizon (min 35), then recovers with plan
    const baselineHeadway = 7 - (scrubPct > 70 ? 5.2 * Math.sin(((scrubPct - 70) / 30) * Math.PI) : (scrubPct / 70) * 5.2);
    const headway = Math.max(1.4, Math.round(baselineHeadway * 10) / 10);
    const isUnderHeadway = headway < 5.0;

    return {
      minute: scrubMinute,
      headwayGap: headway,
      isUnderHeadway,
      speedKmh: isUnderHeadway ? 28 : 75,
      statusText: isUnderHeadway
        ? `Safety buffer violation: Headway ${headway}m (< 5m standard). T104 & T107 overlap.`
        : `Nominal headway: ${headway}m spacing. Block telemetry clear.`,
    };
  }, [scrubPct, scrubMinute]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = Math.round((x / rect.width) * 100);
    setScrubPct(pct);
  };

  // Generate 30 bars for the real-time OCC block occupancy histogram
  const histogramBars = useMemo(() => {
    const bars = [];
    for (let i = 0; i < 30; i++) {
      // Height between 20% and 90%
      const baseHeight = 35 + Math.sin(i * 0.4) * 25 + (i > 22 ? 25 : 0);
      const isCritical = i >= 24 && i <= 27 && conflictCount > 0;
      bars.push({
        minute: -30 + i,
        heightPct: Math.min(95, Math.max(15, baseHeight)),
        isCritical,
        trainCount: Math.round(10 + Math.sin(i * 0.3) * 5),
      });
    }
    return bars;
  }, [conflictCount]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* LEFT 8 COLUMNS: FEATURED HERO INCIDENT & SCRUBBABLE CURVE */}
      <div className="lg:col-span-8 rounded-2xl border p-6 flex flex-col justify-between relative overflow-hidden sorvo-glass sorvo-hero-card">
        {/* Ambient warm glow behind hero */}
        <div
          className="absolute -top-24 -left-24 w-80 h-80 rounded-full pointer-events-none opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #ff8c42 0%, transparent 70%)' }}
        />

        {/* Top Badges & Time Horizon */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 relative z-10">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-sm" style={{ background: 'rgba(255, 140, 66, 0.15)', color: 'var(--sorvo-orange, #ff8c42)', border: '1px solid rgba(255, 140, 66, 0.3)' }}>
              <span className="w-2 h-2 rounded-full bg-[#ff8c42] animate-pulse" />
              <span>Critical Dispatch Horizon</span>
            </span>
            <span className="text-xs font-mono sorvo-muted-text">Secunderabad Jn · Platform 1</span>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs sorvo-muted-text">
            <Clock size={14} className="text-[#ff8c42]" />
            <span>Predicted clash in <b>35 min</b></span>
          </div>
        </div>

        {/* Hero Title & Subtext */}
        <div className="mb-6 relative z-10">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight leading-snug sorvo-hero-title">
            {incident
              ? `Platform 1 at Secunderabad: ${(incident.trains_involved || ['T104', 'T107']).join(' & ')} Headway Clash`
              : 'Hyderabad Triangle Corridor: Movements Clear and Nominal'}
          </h2>
          <p className="text-xs sm:text-sm mt-1.5 max-w-2xl leading-relaxed sorvo-hero-subtitle">
            {suggested
              ? suggested.new_platform
                ? `Solver Recommendation: Reallocate ${suggested.train_id} to Platform ${suggested.new_platform}. Preserves 5-minute safety headway with zero downstream delay.`
                : suggested.description
              : 'All 15 monitored trains are operating within nominal 5-minute safety headway buffers. Automatic conflict detection standing by.'}
          </p>
        </div>

        {/* 4 Core Quick Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6 relative z-10">
          <div className="p-3 rounded-xl border sorvo-stat-box">
            <span className="text-[11px] font-medium block sorvo-stat-label">Monitored Trains</span>
            <strong className="text-lg font-bold font-mono mt-0.5 block sorvo-stat-value">{totalTrains}</strong>
          </div>
          <div className="p-3 rounded-xl border sorvo-stat-box">
            <span className="text-[11px] font-medium block sorvo-stat-label">On-Time Performance</span>
            <strong className="text-lg font-bold font-mono text-emerald-500 dark:text-emerald-400 mt-0.5 block">{onTimePct.toFixed(1)}%</strong>
          </div>
          <div className="p-3 rounded-xl border sorvo-stat-box">
            <span className="text-[11px] font-medium block sorvo-stat-label">Active Delays</span>
            <strong className="text-lg font-bold font-mono text-amber-500 dark:text-amber-400 mt-0.5 block">{activeDelayCount}</strong>
          </div>
          <div className="p-3 rounded-xl border sorvo-stat-box">
            <span className="text-[11px] font-medium block sorvo-stat-label">Open Conflicts</span>
            <strong className="text-lg font-bold font-mono text-rose-500 dark:text-rose-400 mt-0.5 block">{conflictCount}</strong>
          </div>
        </div>

        {/* EMBEDDED GLASS RETENTION & KINEMATICS CURVE (Sorvo signature) */}
        <div className="sorvo-curve-card p-4 border relative z-10 mb-6">
          {/* Header Readout */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold flex items-center gap-1.5 sorvo-curve-title">
                <Activity size={14} className="text-[#ff8c42]" />
                <span>Headway Margin &amp; Trajectory Forecast</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${scrubData.isUnderHeadway ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {scrubData.headwayGap}m Headway
              </span>
            </div>
            <span className="font-mono text-[11px] sorvo-muted-text">
              Scrub cursor: <b className="sorvo-stat-value">+{scrubData.minute}m</b> ({scrubData.speedKmh} km/h)
            </span>
          </div>

          <p className="text-[11px] mb-3 truncate sorvo-hero-subtitle">
            {scrubData.statusText}
          </p>

          {/* Interactive SVG Curve */}
          <div className="relative h-28 w-full select-none">
            <svg
              ref={svgRef}
              className="w-full h-full cursor-crosshair overflow-visible"
              viewBox="0 0 400 100"
              preserveAspectRatio="none"
              onMouseMove={handleMouseMove}
            >
              <defs>
                <linearGradient id="sorvoCurveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ff8c42" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#ff8c42" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Dotted 5-minute safety threshold guideline */}
              <line
                className="sorvo-curve-guide"
                x1="0"
                y1="45"
                x2="400"
                y2="45"
                strokeDasharray="4 4"
                strokeWidth="1.5"
              />
              <text className="sorvo-curve-guide-text" x="395" y="40" textAnchor="end" fontSize="9" fontFamily="monospace">
                5 min safety headway threshold
              </text>

              {/* Area fill under curve */}
              <path
                d="M 0,25 Q 120,20 200,35 T 310,88 T 400,20 L 400,100 L 0,100 Z"
                fill="url(#sorvoCurveGrad)"
              />

              {/* Main Kinematic Trajectory Bezier Curve */}
              <path
                d="M 0,25 Q 120,20 200,35 T 310,88 T 400,20"
                fill="none"
                stroke="#ff8c42"
                strokeWidth="2.5"
              />

              {/* Critical Clash Zone Marker (min 30-38) */}
              <circle cx="310" cy="88" r="4.5" fill="#ff978c" stroke="#ffffff" strokeWidth="1.5" />
            </svg>

            {/* Scrub vertical guide line */}
            <div
              className="sorvo-scrub-line"
              style={{ left: `${scrubPct}%` }}
            />
            {/* Glowing orange scrub handle */}
            <div
              className="sorvo-scrub-handle"
              style={{ left: `${scrubPct}%`, top: `${Math.min(90, Math.max(15, (scrubPct > 70 ? 80 : 30)))}%` }}
            />
          </div>

          {/* Timeline axis labels */}
          <div className="flex justify-between text-[10px] font-mono sorvo-muted-text mt-2">
            <span>Now (00:00)</span>
            <span>+15 min</span>
            <span className="text-rose-400 font-bold">+35 min (Clash Horizon)</span>
            <span>+45 min</span>
          </div>
        </div>

        {/* Bottom Actions Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t sorvo-border-subtle relative z-10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onReview(incident?.id)}
              className="sorvo-btn-primary text-xs"
            >
              <span>Review Conflict Plan</span>
              <ArrowRight size={14} />
            </button>
            <button
              onClick={onReadAlert}
              className="text-xs px-3.5 py-2 rounded-full border sorvo-quiet-btn flex items-center gap-1.5 transition-colors"
            >
              <Volume2 size={14} />
              <span>Read Aloud</span>
            </button>
          </div>

          <span className="text-xs font-semibold text-emerald-500 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 size={14} />
            <span>Reallocation avoids +18m cascade across 3 following rakes</span>
          </span>
        </div>
      </div>

      {/* RIGHT 4 COLUMNS: "MONITORING RIGHT NOW" OCC TELEMETRY (Sorvo style) */}
      <div className="lg:col-span-4 rounded-2xl border p-6 flex flex-col justify-between sorvo-glass sorvo-telemetry-card">
        <div>
          {/* Top Live OCC Header */}
          <div className="flex items-center justify-between gap-2 mb-4">
            <span className="text-xs font-bold uppercase tracking-wider sorvo-stat-label">Live OCC Telemetry</span>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#ff8c42]">
              <span className="w-2 h-2 rounded-full bg-[#ff8c42] animate-ping" />
              <span>Live 0.8s Sync</span>
            </div>
          </div>

          {/* Large Live Counter */}
          <div className="mb-6">
            <strong className="text-4xl sm:text-5xl font-bold font-mono tracking-tight block sorvo-telemetry-count">
              15 Trains
            </strong>
            <p className="text-xs mt-1 sorvo-muted-text">
              Active across Hyderabad Triangle (HYB · SC · KCG) with 100% Kavach ATP headway supervision.
            </p>
          </div>

          {/* 30-Minute Block Safety Spacing Histogram */}
          <div className="mb-6">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-medium sorvo-muted-text">Headway margin trend</span>
              <span className="font-mono text-[11px] sorvo-muted-text">Last 30 mins</span>
            </div>

            <div className="h-20 flex items-end gap-1 px-1 py-1 rounded-xl border sorvo-hist-container">
              {histogramBars.map((bar, i) => (
                <div
                  key={i}
                  className={`sorvo-histogram-bar flex-1 ${bar.isCritical ? 'bg-rose-500' : 'bg-[#ff8c42]/60 hover:bg-[#ff8c42]'}`}
                  style={{ height: `${bar.heightPct}%` }}
                  title={`Minute ${bar.minute}: ${bar.trainCount} trains on track`}
                />
              ))}
            </div>

            <div className="flex justify-between text-[10px] font-mono sorvo-muted-text mt-1 px-1">
              <span>-30 min</span>
              <span>-15 min</span>
              <span>Now</span>
            </div>
          </div>
        </div>

        {/* Priority Corridor Rakes List */}
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2.5 sorvo-stat-label">
            Active Priority Rakes
          </h4>
          <div className="space-y-2">
            <div className="p-2.5 rounded-xl border flex items-center justify-between text-xs sorvo-rake-card">
              <div>
                <strong className="block font-bold sorvo-rake-title">12723 Telangana Express</strong>
                <span className="text-[11px] sorvo-muted-text">HYB → NDLS · Superfast</span>
              </div>
              <span className="text-emerald-500 dark:text-emerald-400 font-mono font-bold">On time</span>
            </div>

            <div className="p-2.5 rounded-xl border flex items-center justify-between text-xs sorvo-rake-card">
              <div>
                <strong className="block font-bold sorvo-rake-title">12727 Godavari Express</strong>
                <span className="text-[11px] sorvo-muted-text">HYB → VSKP · Express</span>
              </div>
              <span className="text-amber-500 dark:text-amber-400 font-mono font-bold">+10m late</span>
            </div>

            <div className="p-2.5 rounded-xl border flex items-center justify-between text-xs sorvo-rake-card">
              <div>
                <strong className="block font-bold sorvo-rake-title">47155 MMTS Local</strong>
                <span className="text-[11px] sorvo-muted-text">SC → HYB · Suburban</span>
              </div>
              <span className="text-emerald-500 dark:text-emerald-400 font-mono font-bold">On time</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
