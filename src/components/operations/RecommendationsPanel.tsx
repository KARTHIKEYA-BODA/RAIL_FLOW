import { useState } from 'react';
import { CheckCircle2, Lightbulb, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

export interface ExplainableRecommendationItem {
  id: string;
  decision_type: string;
  train_id: string;
  train_name: string;
  other_train_id?: string;
  other_train_name?: string;
  station_id: string;
  action_description: string;
  hold_minutes: number;
  one_line_reason: string;
  weighted_minutes_saved: number;
  affected_trains_count: number;
  rejection_cost_weighted_min: number;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

interface RecommendationsPanelProps {
  open: boolean;
  recommendations: any[];
  onClose: () => void;
  onApply: (id: string) => void;
  onReject?: (id: string, reasonCode: string) => void;
  applyingId?: string | null;
}

export function RecommendationsPanel({
  open,
  recommendations,
  onClose,
  onApply,
  onReject,
  applyingId,
}: RecommendationsPanelProps) {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('CONTROLLER_PREFERENCE');

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:bg-black/20"
        onClick={onClose}
        aria-label="Close recommendations panel"
      />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-[#344039] bg-[#111816] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#344039] px-4 py-3 bg-[#1a231f]">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <Lightbulb className="h-5 w-5 text-[#9ac4fb]" />
            Solver Recommendations & Explanations
            <Badge variant="info">{recommendations.length}</Badge>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-[#acb9b0] hover:bg-[#344039] hover:text-white"
            aria-label="Close recommendations"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-3 bg-[#111816] border-b border-[#344039] text-xs text-[#acb9b0]">
          Every recommendation is calculated from CP-SAT mathematical optimization and carries a one-line counterfactual explanation you can accept or reject.
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {recommendations.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-[#acb9b0]">
              <CheckCircle2 className="h-10 w-10 text-[#9be7be] mb-2" />
              <p className="font-medium text-white">Nominal Dispatch Operating</p>
              <p className="text-xs text-[#acb9b0] mt-1">No active holds or precedence overrides needed. The CP-SAT timetable is optimal.</p>
            </div>
          ) : (
            recommendations.map((rec) => {
              const oneLine = rec.one_line_reason || rec.description || `Adjust ${rec.train_id}`;
              const saved = rec.weighted_minutes_saved ?? rec.cost_benefit?.delay_reduction ?? 0;
              const penalty = rec.rejection_cost_weighted_min ?? saved;
              const isRejecting = rejectingId === rec.id;

              return (
                <article
                  key={rec.id}
                  className="rounded-lg border border-[#344039] bg-[#1a231f] p-4 transition-all hover:border-[#9ac4fb]/40"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#9ac4fb]">{rec.id}</span>
                        <span className="rounded bg-[#233128] px-1.5 py-0.5 text-xs text-[#acb9b0]">
                          {rec.decision_type || 'PRECEDENCE'}
                        </span>
                        {rec.station_id && (
                          <span className="rounded bg-[#233128] px-1.5 py-0.5 text-xs text-[#acb9b0]">
                            {rec.station_id}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1.5 text-sm font-semibold text-white leading-snug">
                        {oneLine}
                      </h3>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="text-base font-bold text-[#9be7be]">
                        +{saved.toFixed(0)}m
                      </div>
                      <div className="text-[10px] text-[#acb9b0]">saved</div>
                    </div>
                  </div>

                  <div className="my-2 rounded border border-[#344039]/60 bg-[#111816] p-2 text-xs text-[#acb9b0]">
                    <div className="flex items-center justify-between">
                      <span>Action: <strong>{rec.action_description || rec.description}</strong></span>
                      <span>Impact: <strong>{rec.affected_trains_count || 3} trains</strong></span>
                    </div>
                  </div>

                  {isRejecting ? (
                    <div className="mt-3 rounded border border-[#ffab9e]/40 bg-[#ffab9e]/10 p-3 text-xs">
                      <div className="font-semibold text-[#ffab9e]">
                        ⚠️ Rejecting costs +{penalty.toFixed(1)} weighted minutes
                      </div>
                      <p className="mt-1 text-[#acb9b0]">
                        The solver will fix your alternative as a constraint and re-solve.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <select
                          className="flex-1 rounded border border-[#344039] bg-[#111816] px-2 py-1 text-xs text-white"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        >
                          <option value="CONTROLLER_PREFERENCE">Controller judgment</option>
                          <option value="PLATFORM_OCCUPIED">Platform unavailable locally</option>
                          <option value="PASSENGER_CONNECTION">Guaranteed passenger connection</option>
                          <option value="CREW_EXPIRATION">Crew duty hours constraint</option>
                        </select>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            if (onReject) onReject(rec.id, rejectReason);
                            setRejectingId(null);
                          }}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRejectingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        className="flex-1 bg-[#9be7be] hover:bg-[#85d4ab] text-black font-semibold text-xs h-8"
                        onClick={() => onApply(rec.id)}
                        disabled={applyingId === rec.id}
                      >
                        <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                        {applyingId === rec.id ? 'Applying…' : 'Accept recommendation'}
                      </Button>
                      <Button
                        variant="outline"
                        className="border-[#ffab9e]/40 text-[#ffab9e] hover:bg-[#ffab9e]/10 text-xs h-8"
                        onClick={() => setRejectingId(rec.id)}
                      >
                        <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
