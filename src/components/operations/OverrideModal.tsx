import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/input';

export interface DelayImpact {
  current: number;
  predicted: number;
  difference: number;
}

interface OverrideModalProps {
  open: boolean;
  trainId: string | null;
  stationId?: string;
  platform: number;
  maxPlatform?: number;
  message: string;
  delayImpact: DelayImpact | null;
  loading?: boolean;
  onPlatformChange: (platform: number) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function OverrideModal({
  open,
  trainId,
  stationId,
  platform,
  maxPlatform = 6,
  message,
  delayImpact,
  loading,
  onPlatformChange,
  onClose,
  onSubmit,
}: OverrideModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => prev?.focus();
  }, [open]);

  if (!open || !trainId) return null;

  const impactLabel =
    delayImpact && delayImpact.difference > 2
      ? 'High delay impact'
      : delayImpact && delayImpact.difference > 0
        ? 'Moderate delay impact'
        : 'No additional delay';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" role="presentation">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="override-title"
        tabIndex={-1}
        className="relative z-50 w-full max-w-md rounded-xl border border-[#344039] bg-[#111816] p-6 shadow-2xl"
      >
        <h2 id="override-title" className="text-base font-semibold text-[#f1f5ef]">
          Manual platform override
        </h2>
        <p className="mt-1.5 text-xs text-[#acb9b0]">
          Train <span className="font-mono font-medium text-white">{trainId}</span> · {stationId}
        </p>
        <label className="mt-4 block text-xs font-semibold uppercase text-[#acb9b0]">
          New platform
          <Input
            type="number"
            min={1}
            max={maxPlatform}
            value={platform}
            onChange={(e) => onPlatformChange(Number(e.target.value))}
            className="mt-1 w-full bg-[#1a231f] border-[#344039] text-sm text-white"
          />
          <span className="mt-1 block text-[11px] text-[#acb9b0] font-normal normal-case">Platforms 1–{maxPlatform}</span>
        </label>
        {delayImpact && (
          <div
            className={`mt-3 rounded-lg border p-3 text-xs ${
              delayImpact.difference > 2
                ? 'border-[#ffab9e]/40 bg-[#ffab9e]/10'
                : delayImpact.difference > 0
                  ? 'border-[#f2c278]/40 bg-[#f2c278]/10'
                  : 'border-[#9be7be]/40 bg-[#9be7be]/10'
            }`}
          >
            <p className="font-semibold text-white">{impactLabel}</p>
            <dl className="mt-2 space-y-1 text-xs text-[#f1f5ef] tabular-nums">
              <div className="flex justify-between">
                <dt className="text-[#acb9b0]">Current</dt>
                <dd>{delayImpact.current.toFixed(1)} min</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#acb9b0]">Predicted</dt>
                <dd>{delayImpact.predicted.toFixed(1)} min</dd>
              </div>
              <div className="flex justify-between font-semibold text-white">
                <dt>Impact</dt>
                <dd>
                  {delayImpact.difference > 0 ? '+' : ''}
                  {delayImpact.difference.toFixed(1)} min
                </dd>
              </div>
            </dl>
          </div>
        )}
        {message && <p className="mt-2 text-xs text-[#ffab9e]">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={delayImpact && delayImpact.difference > 2 ? 'destructive' : 'default'}
            size="sm"
            onClick={onSubmit}
            disabled={loading || !Number.isInteger(platform) || platform < 1 || platform > maxPlatform}
          >
            {delayImpact && delayImpact.difference > 2 ? 'Apply (high delay)' : 'Apply override'}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DelayWarningModalProps {
  open: boolean;
  trainId: string;
  platform: number;
  delayImpact: DelayImpact | null;
  onCancel: () => void;
  onProceed: () => void;
}

export function DelayWarningModal({
  open,
  trainId,
  platform,
  delayImpact,
  onCancel,
  onProceed,
}: DelayWarningModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div
        role="alertdialog"
        aria-labelledby="delay-warning-title"
        className="relative z-50 w-full max-w-md rounded-xl border border-[#ffab9e]/40 bg-[#111816] p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-[#ffab9e]" aria-hidden />
          <h2 id="delay-warning-title" className="text-base font-semibold text-[#ffab9e]">
            High delay warning
          </h2>
        </div>
        <p className="text-xs text-[#f1f5ef]">
          Moving train <span className="font-mono font-medium text-white">{trainId}</span> to platform{' '}
          <span className="font-mono font-medium text-white">{platform}</span> will cause significant delays.
        </p>
        {delayImpact && (
          <dl className="mt-3 space-y-1 rounded-lg border border-[#ffab9e]/30 bg-[#ffab9e]/10 p-3 text-xs tabular-nums text-[#f1f5ef]">
            <div className="flex justify-between">
              <dt className="text-[#acb9b0]">Current delay</dt>
              <dd>{delayImpact.current.toFixed(1)} min</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#acb9b0]">Predicted delay</dt>
              <dd>{delayImpact.predicted.toFixed(1)} min</dd>
            </div>
            <div className="flex justify-between font-semibold text-[#ffab9e]">
              <dt>Additional</dt>
              <dd>+{delayImpact.difference.toFixed(1)} min</dd>
            </div>
          </dl>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onProceed}>
            Proceed anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
