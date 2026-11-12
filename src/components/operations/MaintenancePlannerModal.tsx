import { useState } from 'react';
import { Check, Cpu, HardHat, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { commitMaintenance, planMaintenance, type MaintenancePayload } from '../../lib/operationsApi';
import { notify } from '../../lib/notify';

interface MaintenancePlannerModalProps {
  open: boolean;
  onClose: () => void;
  onScheduled?: () => void;
}

export function MaintenancePlannerModal({ open, onClose, onScheduled }: MaintenancePlannerModalProps) {
  const [sectionId, setSectionId] = useState('BMO_MED');
  const [durationMin, setDurationMin] = useState(90);
  const [startTime, setStartTime] = useState('01:00');
  const [endTime, setEndTime] = useState('05:00');
  const [loading, setLoading] = useState(false);
  const [planResult, setPlanResult] = useState<any | null>(null);

  if (!open) return null;

  const handleOptimize = async () => {
    setLoading(true);
    try {
      const payload: MaintenancePayload = {
        section_id: sectionId,
        duration_minutes: durationMin,
        allowed_start_time: startTime,
        allowed_end_time: endTime,
        track_affected: 'both',
      };
      const res = await planMaintenance(payload);
      setPlanResult(res);
      notify.success('Preview ready', 'Review the suggested slot before committing it.');
    } catch (err: any) {
      notify.error('Planning failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    setLoading(true);
    try {
      await commitMaintenance(planResult.maintenance_id);
      notify.success('Maintenance scheduled', planResult.optimal_slot);
      setPlanResult(null);
      onScheduled?.();
      onClose();
    } catch (err: any) {
      notify.error('Could not commit maintenance', err.message);
    } finally {
      setLoading(false);
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
        aria-label="Plan maintenance"
        className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto hud-card p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f2b84b]/10 text-[#f2b84b] border border-[#f2b84b]/20">
              <HardHat className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Maintenance Block Optimization</h2>
              <p className="text-xs text-white/50">
                Compare feasible start times by total weighted delay. Maintenance is a hard track constraint.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close maintenance planner"
            onClick={onClose}
            className="rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* INPUTS */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1">Track Section</label>
            <select
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-[#f2b84b] focus:outline-none"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              <option value="BMO_MED">BMO-MED (Single line, 13.8 km)</option>
              <option value="MED_MOB">MED-MOB (Single line, 14.5 km)</option>
              <option value="MOB_ME">MOB-ME (Single line, 14.3 km)</option>
              <option value="SC_MJF">SC-MJF (Double line, 6.5 km)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1">Duration (Min)</label>
            <input
              type="number"
              min="30"
              max="240"
              step="15"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white font-mono focus:border-[#f2b84b] focus:outline-none"
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1">Window Start</label>
            <input
              type="time"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white font-mono focus:border-[#f2b84b] focus:outline-none"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1">Window End</label>
            <input
              type="time"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white font-mono focus:border-[#f2b84b] focus:outline-none"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            className="bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold text-xs h-9 shadow-md shadow-[#f2b84b]/20 hover:brightness-105"
            onClick={handleOptimize}
            disabled={loading}
          >
            <Cpu className="h-4 w-4 mr-1.5" />
            {loading ? 'Evaluating slots…' : 'Find a slot'}
          </Button>
        </div>

        {/* RESULTS & COST CURVE */}
        {planResult && (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="rounded-lg border border-[#55e0a3]/30 bg-[#55e0a3]/10 p-3 text-xs text-[#55e0a3]">
              <strong>Preview — not yet scheduled:</strong> {planResult.optimal_slot} ({planResult.optimal_weighted_delay_min.toFixed(1)} weighted delay-minutes)
            </div>

            <p className="mt-2 text-xs text-white/60">{planResult.recommendation}</p>

            <div className="mt-4">
              <span className="text-xs font-semibold text-white">Delay Cost Curve Across Window</span>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {planResult.cost_curve.map((slot: any, idx: number) => {
                  const isOptimal = slot.start_time === planResult.optimal_slot.split(' - ')[0];
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg border p-2 text-xs text-center transition-all ${
                        isOptimal
                          ? 'border-[#55e0a3] bg-[#55e0a3]/15 font-bold text-[#55e0a3]'
                          : 'border-white/10 bg-black/40 text-white/60'
                      }`}
                    >
                      <div className="font-mono text-xs">{slot.start_time} - {slot.end_time}</div>
                      <div className="mt-1 text-sm font-mono font-bold">
                        {slot.is_feasible ? `${slot.weighted_delay_min.toFixed(1)}m` : 'No solution'}
                      </div>
                      <div className="text-[10px] text-white/50">
                        {slot.affected_trains} trains delayed over 2 min
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                className="bg-gradient-to-b from-[#55e0a3] to-[#3db882] hover:brightness-105 text-[#141518] font-bold text-xs"
                onClick={handleCommit}
                disabled={loading}
              >
                <Check className="h-4 w-4 mr-1.5" />
                {loading ? 'Checking…' : 'Commit maintenance'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
