import { useEffect, useState } from 'react';
import { AlertOctagon, RotateCcw, X, Zap } from 'lucide-react';
import { Button } from '../ui/Button';
import { injectDisruption, clearDisruptions, evaluateWhatIf, commitWhatIf, type DisruptionPayload } from '../../lib/operationsApi';
import { notify } from '../../lib/notify';
import type { Train } from '../../types/railway';

interface DisruptionInjectorModalProps {
  open: boolean;
  onClose: () => void;
  onInjected?: () => void;
  trains?: Train[];
}

export function DisruptionInjectorModal({ open, onClose, onInjected, trains: suppliedTrains }: DisruptionInjectorModalProps) {
  const [disType, setDisType] = useState<'late_train' | 'loco_failure' | 'signal_failure' | 'speed_restriction'>('late_train');
  const [trainId, setTrainId] = useState('');
  const trains = suppliedTrains ?? [];
  const [blockId, setBlockId] = useState('BMO_MED');
  const [durationMin, setDurationMin] = useState(15);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ delta_weighted_delay_min: number; solve_time_ms: number } | null>(null);

  useEffect(() => { setPreview(null); }, [disType, trainId, blockId, durationMin, open]);

  if (!open) return null;

  const disruptionPayload = (): DisruptionPayload => ({
    disruption_type: disType,
    train_id: (disType === 'late_train' || disType === 'loco_failure') ? (trainId || trains[0]?.id) : undefined,
    block_id: (disType !== 'late_train') ? blockId : undefined,
    duration_minutes: durationMin,
  });

  const handlePreview = async () => {
    setLoading(true);
    try { setPreview(await evaluateWhatIf({ disruption: disruptionPayload() })); }
    catch (err: any) { notify.error('Preview failed', err.message); }
    finally { setLoading(false); }
  };

  const handleCommit = async () => {
    setLoading(true);
    try { await commitWhatIf(); notify.success('Disruption applied', 'The simulated plan was updated.'); onInjected?.(); onClose(); }
    catch (err: any) { notify.error('Could not apply preview', err.message); }
    finally { setLoading(false); }
  };

  const handleInject = async () => {
    setLoading(true);
    try {
      const payload = disruptionPayload();
      const res = await injectDisruption(payload);
      notify.success(
        'Disruption Injected & Re-planned',
        `CP-SAT solved in ${res.solve_time_ms} ms. ${res.recommendations?.length || 0} recommendations generated.`
      );
      if (onInjected) onInjected();
      onClose();
    } catch (err: any) {
      notify.error('Disruption injection failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    try {
      await clearDisruptions();
      notify.info('Disruptions Cleared', 'Schedule restored to nominal operating conditions.');
      if (onInjected) onInjected();
      onClose();
    } catch (err: any) {
      notify.error('Clear failed', err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="fixed inset-0 bg-black/75 backdrop-blur-md cursor-pointer"
        onClick={onClose}
        aria-label="Close modal"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report disruption"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto hud-card p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#ff6a5c]/10 text-[#ff6a5c] border border-[#ff6a5c]/20">
              <AlertOctagon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Inject Operational Disruption</h2>
              <p className="text-xs text-white/50">
                Triggers CP-SAT re-optimization in real time (&lt; 5 seconds).
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close disruption dialog"
            onClick={onClose}
            className="rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1">Disruption Scenario</label>
            <select
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-[#f2b84b] focus:outline-none"
              value={disType}
              onChange={(e: any) => setDisType(e.target.value)}
            >
              <option value="late_train">Late Priority Train (Enters Corridor with Initial Delay)</option>
              <option value="loco_failure">Locomotive Failure (Halts inside Single-Track Block)</option>
              <option value="signal_failure">Signal Failure (Speed restricted to 25 km/h + 5m Headway)</option>
              <option value="speed_restriction">Temporary Speed Restriction (TSR 30 km/h)</option>
            </select>
          </div>

          {(disType === 'late_train' || disType === 'loco_failure') && (
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1">Target Train</label>
              <select
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-[#f2b84b] focus:outline-none"
                value={trainId || trains[0]?.id || ''}
                onChange={(e) => setTrainId(e.target.value)}
              >
                {trains.map(train => <option key={train.id} value={train.id}>{train.id} · {train.type}</option>)}
              </select>
            </div>
          )}

          {disType !== 'late_train' && (
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1">Track Section Block</label>
              <select
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-[#f2b84b] focus:outline-none"
                value={blockId}
                onChange={(e) => setBlockId(e.target.value)}
              >
                <option value="BMO_MED">BMO_MED (Bolarum - Medchal, Single Track)</option>
                <option value="MED_MOB">MED_MOB (Medchal - Manoharabad, Single Track)</option>
                <option value="MOB_ME">MOB_ME (Manoharabad - Masaipet, Single Track)</option>
                <option value="SC_MJF">SC_MJF (Secunderabad - Malkajgiri, Double Track)</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1">Disruption Duration (Minutes)</label>
            <input
              type="number"
              min="5"
              max="60"
              step="5"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white font-mono focus:border-[#f2b84b] focus:outline-none"
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            />
          </div>
        </div>

        {preview && (
          <div role="status" className="mt-4 rounded-xl border border-[#93b8ff]/30 bg-[#93b8ff]/10 p-3.5 text-xs text-white">
            <strong className="text-[#93b8ff]">Preview — not applied</strong>
            <p className="mt-1 text-white/80">
              Weighted delay change: {preview.delta_weighted_delay_min >= 0 ? '+' : ''}
              {preview.delta_weighted_delay_min.toFixed(1)} min · solver {(preview.solve_time_ms / 1000).toFixed(2)} s
            </p>
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-white/10">
          <Button variant="outline" onClick={handlePreview} disabled={loading} className="text-xs">
            Preview
          </Button>
          {preview && (
            <Button onClick={handleCommit} disabled={loading} className="text-xs">
              Apply preview
            </Button>
          )}
          <Button
            variant="outline"
            className="border-white/15 text-white/70 hover:bg-white/10 text-xs"
            onClick={handleClear}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Clear Disruptions
          </Button>

          <Button
            className="bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold text-xs shadow-md shadow-[#f2b84b]/20 hover:brightness-105 h-9"
            onClick={handleInject}
            disabled={loading}
          >
            <Zap className="h-4 w-4 mr-1.5" />
            {loading ? 'Re-planning with CP-SAT...' : 'Inject & Re-optimize'}
          </Button>
        </div>
      </div>
    </div>
  );
}
