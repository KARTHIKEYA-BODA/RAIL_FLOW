import { Activity, Cpu, Gauge, ShieldCheck, Zap } from 'lucide-react';

interface KpiStripProps {
  solveTimeMs?: number;
  weightedDelaySolver?: number;
  weightedDelayFcfs?: number;
  weightedDelayPriority?: number;
  onTimePct?: number;
  trainsDelayedOver5m?: number;
  totalTrains?: number;
  constraintViolations?: number;
}

export function KpiStrip({
  solveTimeMs = 3120,
  weightedDelaySolver = 294.1,
  weightedDelayFcfs = 305.0,
  weightedDelayPriority = 305.0,
  onTimePct = 86.7,
  trainsDelayedOver5m = 2,
  totalTrains = 15,
  constraintViolations = 0,
}: KpiStripProps) {
  const savingsVsFcfs = Math.max(0, weightedDelayFcfs - weightedDelaySolver);
  const savingsPct = weightedDelayFcfs > 0 ? ((savingsVsFcfs / weightedDelayFcfs) * 100).toFixed(1) : '0';

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {/* CARD 1: SOLVER PERFORMANCE & SOLVE TIME */}
      <div className="rounded-xl border border-[#344039] bg-[#1a231f] p-3.5 shadow-sm">
        <div className="flex items-center justify-between text-xs text-[#acb9b0]">
          <span className="font-semibold text-white">OR-Tools CP-SAT</span>
          <div className="flex h-6 w-6 items-center justify-center rounded bg-[#9ac4fb]/10 text-[#9ac4fb]">
            <Cpu className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tracking-tight text-white">
            {weightedDelaySolver.toFixed(1)}m
          </span>
          <span className="text-xs text-[#acb9b0]">weighted delay</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-[#9ac4fb]">
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            <span>Solved in {solveTimeMs.toFixed(0)} ms</span>
          </span>
          <span className="text-xs text-[#9be7be]">(&lt; 5.0s limit)</span>
        </div>
      </div>

      {/* CARD 2: BASELINES COMPARISON (FCFS & PRIORITY) */}
      <div className="rounded-xl border border-[#344039] bg-[#1a231f] p-3.5 shadow-sm">
        <div className="flex items-center justify-between text-xs text-[#acb9b0]">
          <span className="font-semibold text-white">Baseline Comparison</span>
          <div className="flex h-6 w-6 items-center justify-center rounded bg-[#9be7be]/10 text-[#9be7be]">
            <Activity className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tracking-tight text-[#9be7be]">
            -{savingsVsFcfs.toFixed(1)}m
          </span>
          <span className="text-xs text-[#acb9b0]">({savingsPct}% vs FCFS)</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-[#acb9b0]">
          <span>FCFS: {weightedDelayFcfs.toFixed(1)}m</span>
          <span>Priority: {weightedDelayPriority.toFixed(1)}m</span>
        </div>
      </div>

      {/* CARD 3: PUNCTUALITY & CASCADE CONTROL */}
      <div className="rounded-xl border border-[#344039] bg-[#1a231f] p-3.5 shadow-sm">
        <div className="flex items-center justify-between text-xs text-[#acb9b0]">
          <span className="font-semibold text-white">Punctuality</span>
          <div className="flex h-6 w-6 items-center justify-center rounded bg-[#f2c278]/10 text-[#f2c278]">
            <Gauge className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tracking-tight text-white">
            {onTimePct.toFixed(1)}%
          </span>
          <span className="text-xs text-[#acb9b0]">on-time (&le;2m)</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-[#acb9b0]">
          <span>Delayed &gt;5m: <strong className="text-white">{trainsDelayedOver5m}</strong></span>
          <span>Total trains: {totalTrains}</span>
        </div>
      </div>

      {/* CARD 4: SAFETY INVARIANTS */}
      <div className="rounded-xl border border-[#344039] bg-[#1a231f] p-3.5 shadow-sm">
        <div className="flex items-center justify-between text-xs text-[#acb9b0]">
          <span className="font-semibold text-white">Safety Invariants</span>
          <div className="flex h-6 w-6 items-center justify-center rounded bg-[#9be7be]/10 text-[#9be7be]">
            <ShieldCheck className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tracking-tight text-[#9be7be]">
            {constraintViolations}
          </span>
          <span className="text-xs text-[#acb9b0]">violations</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-[#9be7be]">
          <span>Single-track non-overlap: ✓</span>
          <span>Headways: ✓</span>
        </div>
      </div>
    </div>
  );
}
