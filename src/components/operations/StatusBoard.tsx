import type { SystemHealth } from '../../context/DashboardShellContext';
import { ShieldCheck, Activity } from 'lucide-react';

interface StatusBoardProps {
  trainCount: number;
  onTimePct: number;
  conflictCount: number;
  avgDelay: string;
  systemHealth: SystemHealth;
}

const healthStyles: Record<SystemHealth, string> = {
  OPTIMAL: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  DELAYS: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  CONFLICTS: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
};

export function StatusBoard({
  trainCount,
  onTimePct,
  conflictCount,
  avgDelay: _avgDelay,
  systemHealth,
}: StatusBoardProps) {
  return (
    <div className="space-y-2.5">
      <div
        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium ${healthStyles[systemHealth]}`}
        role="status"
      >
        <span className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          <span>Interlocking State</span>
        </span>
        <span className="font-bold uppercase tracking-wider">{systemHealth}</span>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#090e1a] px-3 py-2 text-xs text-slate-400">
        <span className="flex items-center gap-1 text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Kavach 5m Buffer</span>
        </span>
        <span>{trainCount} Rakes · {onTimePct}% On-time</span>
        {conflictCount > 0 ? (
          <span className="text-rose-400 font-bold">{conflictCount} Alerts</span>
        ) : (
          <span className="text-emerald-400">0 Conflicts</span>
        )}
      </div>
    </div>
  );
}
