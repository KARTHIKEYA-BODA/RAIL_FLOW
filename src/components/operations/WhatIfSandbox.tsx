import { useState } from 'react';
import { Check, Cpu, FlaskConical, Zap } from 'lucide-react';
import { Button } from '../ui/Button';
import { evaluateWhatIf, commitWhatIf, type DisruptionPayload, type OverridePayload } from '../../lib/operationsApi';
import { notify } from '../../lib/notify';

interface WhatIfSandboxProps {
  onPlanCommitted?: () => void;
}

export function WhatIfSandbox({ onPlanCommitted }: WhatIfSandboxProps) {
  const [disruptionType, setDisruptionType] = useState<'late_train' | 'loco_failure' | 'signal_failure' | 'speed_restriction'>('late_train');
  const [selectedTrain, setSelectedTrain] = useState('T101');
  const [durationMin, setDurationMin] = useState(15);
  const [selectedBlock, setSelectedBlock] = useState('BMO_MED');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [committed, setCommitted] = useState(false);

  const handleEvaluate = async () => {
    setLoading(true);
    setCommitted(false);
    try {
      const payload: { disruption?: DisruptionPayload; override?: OverridePayload } = {};

      if (disruptionType === 'late_train') {
        payload.disruption = {
          disruption_type: 'late_train',
          train_id: selectedTrain,
          duration_minutes: durationMin,
        };
      } else if (disruptionType === 'loco_failure') {
        payload.disruption = {
          disruption_type: 'loco_failure',
          train_id: selectedTrain,
          block_id: selectedBlock,
          duration_minutes: durationMin,
        };
      } else if (disruptionType === 'signal_failure') {
        payload.disruption = {
          disruption_type: 'signal_failure',
          block_id: selectedBlock,
          duration_minutes: durationMin,
          speed_restriction_kmh: 25.0,
          additional_headway_sec: 300,
        };
      } else {
        payload.disruption = {
          disruption_type: 'speed_restriction',
          block_id: selectedBlock,
          duration_minutes: durationMin,
          speed_restriction_kmh: 30.0,
        };
      }

      const res = await evaluateWhatIf(payload);
      setResult(res);
      notify.info('What-If Scenario Evaluated', res.summary);
    } catch (err: any) {
      notify.error('Evaluation failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    try {
      await commitWhatIf();
      setCommitted(true);
      notify.success('Scenario Committed to Live Plan', 'The dispatch schedule and recommendations have been updated.');
      if (onPlanCommitted) onPlanCommitted();
    } catch (err: any) {
      notify.error('Commit failed', err.message);
    }
  };

  const handleDiscard = () => {
    setResult(null);
    setCommitted(false);
    notify.info('What-If Scenario Discarded', 'Live dispatch schedule remains unchanged.');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#344039] bg-[#1a231f] p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-[#344039] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#9ac4fb]/10 text-[#9ac4fb]">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">What-If Dispatch Sandbox</h2>
              <p className="text-xs text-[#acb9b0]">
                Test hypothetical disruptions and dispatch decisions in an isolated sandbox. The live plan is untouched until you commit.
              </p>
            </div>
          </div>
          <span className="rounded border border-[#9ac4fb]/30 bg-[#9ac4fb]/10 px-2.5 py-1 text-xs font-mono text-[#9ac4fb]">
            SANDBOX ISOLATED
          </span>
        </div>

        {/* CONTROLS */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-[#acb9b0] mb-1.5">Disruption Type</label>
            <select
              className="w-full rounded border border-[#344039] bg-[#111816] px-3 py-2 text-xs text-white"
              value={disruptionType}
              onChange={(e: any) => setDisruptionType(e.target.value)}
            >
              <option value="late_train">Late Priority Train Entry</option>
              <option value="loco_failure">Locomotive Failure on Track</option>
              <option value="signal_failure">Signal Failure / Caution</option>
              <option value="speed_restriction">Temporary Speed Restriction (TSR)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#acb9b0] mb-1.5">Target Train / Track</label>
            {disruptionType === 'late_train' || disruptionType === 'loco_failure' ? (
              <select
                className="w-full rounded border border-[#344039] bg-[#111816] px-3 py-2 text-xs text-white"
                value={selectedTrain}
                onChange={(e) => setSelectedTrain(e.target.value)}
              >
                <option value="T101">T101 (Express 12001 - Weight 3.0)</option>
                <option value="T102">T102 (Local Suburban - Weight 2.0)</option>
                <option value="T103">T103 (Passenger - Weight 1.5)</option>
                <option value="T104">T104 (Express Charminar - Weight 3.0)</option>
              </select>
            ) : (
              <select
                className="w-full rounded border border-[#344039] bg-[#111816] px-3 py-2 text-xs text-white"
                value={selectedBlock}
                onChange={(e) => setSelectedBlock(e.target.value)}
              >
                <option value="BMO_MED">BMO_MED (Single Track 13.8km)</option>
                <option value="MED_MOB">MED_MOB (Single Track 14.5km)</option>
                <option value="SC_MJF">SC_MJF (Double Track 6.5km)</option>
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[#acb9b0] mb-1.5">Duration (Minutes)</label>
            <input
              type="number"
              min="5"
              max="120"
              step="5"
              className="w-full rounded border border-[#344039] bg-[#111816] px-3 py-2 text-xs text-white font-mono"
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            />
          </div>

          <div className="flex items-end">
            <Button
              className="w-full bg-[#9ac4fb] hover:bg-[#85b5f2] text-black font-semibold text-xs h-9"
              onClick={handleEvaluate}
              disabled={loading}
            >
              <Cpu className="h-4 w-4 mr-1.5" />
              {loading ? 'Solving (CP-SAT)...' : 'Evaluate What-If'}
            </Button>
          </div>
        </div>

        {/* COMPARISON RESULTS */}
        {result && (
          <div className="mt-6 rounded-lg border border-[#344039] bg-[#111816] p-4">
            <div className="flex items-center justify-between border-b border-[#344039] pb-3 mb-4">
              <span className="font-semibold text-sm text-white">CP-SAT Sandbox Evaluation Results</span>
              <span className="flex items-center gap-1.5 font-mono text-xs text-[#9ac4fb]">
                <Zap className="h-3.5 w-3.5" />
                Solved in {result.solve_time_ms} ms
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded border border-[#344039] bg-[#1a231f] p-3">
                <span className="text-xs text-[#acb9b0]">Current Live Plan</span>
                <div className="mt-1 text-xl font-bold font-mono text-white">
                  {result.current_weighted_delay_min.toFixed(1)}m
                </div>
                <span className="text-[11px] text-[#acb9b0]">total weighted delay</span>
              </div>

              <div className="rounded border border-[#344039] bg-[#1a231f] p-3">
                <span className="text-xs text-[#acb9b0]">What-If Sandbox Plan</span>
                <div className="mt-1 text-xl font-bold font-mono text-[#f2c278]">
                  {result.hypothetical_weighted_delay_min.toFixed(1)}m
                </div>
                <span className="text-[11px] text-[#acb9b0]">with mitigation applied</span>
              </div>

              <div className="rounded border border-[#344039] bg-[#1a231f] p-3">
                <span className="text-xs text-[#acb9b0]">Predicted Delay Impact</span>
                <div className={`mt-1 text-xl font-bold font-mono ${result.delta_weighted_delay_min > 0 ? 'text-[#ffab9e]' : 'text-[#9be7be]'}`}>
                  {result.delta_weighted_delay_min > 0 ? `+${result.delta_weighted_delay_min.toFixed(1)}m` : `${result.delta_weighted_delay_min.toFixed(1)}m`}
                </div>
                <span className="text-[11px] text-[#acb9b0]">
                  Affects {result.affected_trains_count} downstream trains
                </span>
              </div>
            </div>

            <p className="mt-3 text-xs text-[#acb9b0]">
              {result.summary}
            </p>

            <div className="mt-4 flex items-center justify-end gap-3 pt-3 border-t border-[#344039]">
              <Button
                variant="outline"
                className="border-[#344039] text-[#acb9b0] hover:bg-[#344039] text-xs"
                onClick={handleDiscard}
              >
                Discard Scenario
              </Button>
              <Button
                className="bg-[#9be7be] hover:bg-[#85d4ab] text-black font-semibold text-xs"
                onClick={handleCommit}
                disabled={committed}
              >
                <Check className="h-4 w-4 mr-1.5" />
                {committed ? 'Committed to Live Plan' : 'Commit to Live Operations'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
