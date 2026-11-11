import { useEffect } from 'react';
import { X, Train as TrainIcon, SlidersHorizontal, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { ScheduleEntry, Train } from '../../types/railway';
import { formatTime } from '../../lib/dateTimeUtils';
import { getTrainStatus, calculateDelayMinutes } from '../../lib/scheduleUtils';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface TrainDetailDrawerProps {
  entry: ScheduleEntry | null;
  train: Train | null;
  onClose: () => void;
  onOverride?: (trainId: string) => void;
}

const statusVariant = {
  'on-time': 'success' as const,
  delayed: 'warning' as const,
  overridden: 'info' as const,
  conflict: 'destructive' as const,
};

export function TrainDetailDrawer({ entry, train, onClose, onOverride }: TrainDetailDrawerProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!entry) return null;

  const status = train ? getTrainStatus(entry, [train]) : 'on-time';
  const delayMin = calculateDelayMinutes(entry.actual_arrival, entry.scheduled_arrival || train?.scheduled_arrival);

  const stationsVisited = ['HYB', 'SC', 'KCG'];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Train ${entry.train_id} details`}>
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-label="Close drawer"
      />

      {/* Drawer Panel */}
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-[#344039] bg-[#111816] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#344039] bg-[#1a231f] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#344039] bg-[#111816] text-[#9ac4fb]">
              <TrainIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-mono text-lg font-semibold tracking-tight text-white">{entry.train_id}</h2>
                <Badge variant={statusVariant[status]}>{status.replace('-', ' ')}</Badge>
              </div>
              <p className="text-xs text-[#acb9b0]">
                {train?.origin || 'HYB'} → {train?.destination || 'KCG'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#acb9b0] hover:bg-[#344039] hover:text-white transition-colors"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {/* Corridor Progress Tracker */}
          <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3.5 shadow-sm">
            <span className="text-[11px] uppercase font-semibold text-[#acb9b0]">
              Corridor progress
            </span>
            <div className="mt-3 flex items-center justify-between">
              {stationsVisited.map((st, i) => {
                const isCurrent = entry.station_id === st;
                return (
                  <div key={st} className="flex items-center flex-1">
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all ${
                          isCurrent
                            ? 'bg-[#9ac4fb] text-[#111816]'
                            : 'border border-[#344039] bg-[#111816] text-[#acb9b0]'
                        }`}
                      >
                        {st}
                      </div>
                      <span className="mt-1 text-[11px] font-mono text-[#acb9b0]">
                        {isCurrent ? `Platform ${entry.assigned_platform}` : 'Leg'}
                      </span>
                    </div>
                    {i < stationsVisited.length - 1 && (
                      <div className="h-0.5 flex-1 mx-2 bg-[#344039]" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Operational Metrics Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3">
              <span className="text-[#acb9b0]">Train type</span>
              <div className="mt-1 font-semibold text-white">{train?.type || 'Express'}</div>
            </div>
            <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3">
              <span className="text-[#acb9b0]">Priority tier</span>
              <div className="mt-1 font-semibold text-[#9ac4fb]">
                Level {train?.priority ?? 5} / 10
              </div>
            </div>
            <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3">
              <span className="text-[#acb9b0]">Arrival</span>
              <div className="mt-1 font-mono font-medium text-white">
                {formatTime(entry.actual_arrival)}
              </div>
            </div>
            <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3">
              <span className="text-[#acb9b0]">Departure</span>
              <div className="mt-1 font-mono font-medium text-white">
                {formatTime(entry.actual_departure)}
              </div>
            </div>
          </div>

          {/* Delay Impact Banner */}
          {delayMin > 0 ? (
            <div className="rounded-lg border border-[#f2c278]/40 bg-[#f2c278]/10 p-3">
              <div className="flex items-center gap-1.5 text-[#f2c278] font-semibold mb-1">
                <AlertTriangle className="h-4 w-4" />
                <span>Active delay: +{Math.round(delayMin)} min</span>
              </div>
              <p className="text-[#acb9b0]">
                Scheduled arrival was {train?.scheduled_arrival ? formatTime(train.scheduled_arrival) : 'N/A'}.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-[#9be7be]/30 bg-[#9be7be]/10 p-3 text-[#9be7be] flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              <span>Operating on schedule within buffer.</span>
            </div>
          )}

          {/* Dispatcher Audit Reason */}
          {entry.reason && (
            <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3.5">
              <span className="text-[11px] uppercase font-semibold text-[#acb9b0]">
                Dispatch assignment note
              </span>
              <p className="mt-1.5 text-xs text-[#f1f5ef] leading-relaxed">{entry.reason}</p>
            </div>
          )}
        </div>

        {/* Action Footer */}
        {onOverride && (
          <div className="border-t border-[#344039] bg-[#1a231f] p-4">
            <Button
              className="w-full flex items-center justify-center gap-2"
              variant="outline"
              onClick={() => onOverride(entry.train_id)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Manual platform override
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}
