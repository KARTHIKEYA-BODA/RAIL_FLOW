import { useState } from 'react';
import {
  HelpCircle,
  ShieldCheck,
  Layers,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '../ui/Button';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function JudgeCheatSheetModal({ open, onClose }: Props) {
  const [selectedTopic, setSelectedTopic] = useState<'overview' | 'math' | 'demo' | 'faq'>('overview');

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="judge-modal-title"
    >
      <div className="w-full max-w-3xl rounded-xl border border-[#2A323C] bg-[#14181D] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2A323C] bg-[#1B2027] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#2A323C] bg-[#14181D] text-[#5B9BD5]">
              <HelpCircle className="h-5 w-5" />
            </div>
            <div>
              <h2 id="judge-modal-title" className="text-base font-semibold text-[#E6E9ED]">
                Evaluation &amp; Architecture Briefing
              </h2>
              <p className="text-xs text-[#9AA4B0]">
                Engineering defense, solver mechanics, and evaluation walkthrough.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#9AA4B0] hover:text-white hover:bg-[#2A323C] transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Topic Selector Tabs */}
        <div className="flex border-b border-[#2A323C] bg-[#14181D] px-6 pt-3 gap-2">
          {[
            { id: 'overview', label: 'System Overview' },
            { id: 'math', label: 'Algorithms & Solver' },
            { id: 'demo', label: 'Evaluation Walkthrough' },
            { id: 'faq', label: 'Technical Defense FAQ' },
          ].map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedTopic(t.id as typeof selectedTopic)}
              className={`px-3 py-2 text-xs font-semibold rounded-t-md transition-colors ${
                selectedTopic === t.id
                  ? 'bg-[#1B2027] text-white border-t border-x border-[#2A323C]'
                  : 'text-[#9AA4B0] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {selectedTopic === 'overview' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#2A323C] bg-[#1B2027] p-4 space-y-2">
                <span className="font-semibold text-white block">Core Problem Definition</span>
                <p className="text-[#9AA4B0] leading-relaxed">
                  In dense junction triangles (Secunderabad, Hyderabad Deccan, Kacheguda), a single platform delay or headway violation creates rapid secondary ripple delays that paralyze corridor throughput. TrainVision AI operates as a high-performance OCC decision support system that predicts, resolves, and verifies conflict-free dispatching in real time.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-[#2A323C] bg-[#1B2027] p-3 text-center">
                  <ShieldCheck className="h-5 w-5 text-[#3FB57F] mx-auto mb-1.5" />
                  <strong className="text-white block font-medium">Kavach ATP Ready</strong>
                  <span className="text-[11px] text-[#9AA4B0]">5-minute safety headway enforcement</span>
                </div>
                <div className="rounded-lg border border-[#2A323C] bg-[#1B2027] p-3 text-center">
                  <Zap className="h-5 w-5 text-[#5B9BD5] mx-auto mb-1.5" />
                  <strong className="text-white block font-medium">Sub-Second Heuristic</strong>
                  <span className="text-[11px] text-[#9AA4B0]">&lt;15ms greedy resolution response</span>
                </div>
                <div className="rounded-lg border border-[#2A323C] bg-[#1B2027] p-3 text-center">
                  <Layers className="h-5 w-5 text-[#E0A030] mx-auto mb-1.5" />
                  <strong className="text-white block font-medium">ISA-101 Compliant</strong>
                  <span className="text-[11px] text-[#9AA4B0]">Calm graphite ground, high-contrast alerts only</span>
                </div>
              </div>
            </div>
          )}

          {selectedTopic === 'math' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-[#2A323C] bg-[#1B2027] p-4 space-y-2">
                <span className="font-semibold text-white block">Two-Tier Solver Architecture</span>
                <p className="text-[#9AA4B0] leading-relaxed">
                  The platform utilizes a dual-engine architecture designed for operational resilience:
                </p>
                <div className="space-y-2 pt-2">
                  <div className="rounded border border-[#2A323C] bg-[#14181D] p-2.5">
                    <strong className="text-[#5B9BD5] block">Tier 1: Greedy Dispatch Heuristic (&lt;15ms)</strong>
                    <p className="text-[11px] text-[#9AA4B0] mt-0.5">
                      Sorts trains by operational priority (Vande Bharat Tier 10 &gt; Express Tier 9 &gt; Passenger Tier 7 &gt; Freight Tier 4). Traverses platform interval trees to identify the earliest zero-conflict berth diversion.
                    </p>
                  </div>
                  <div className="rounded border border-[#2A323C] bg-[#14181D] p-2.5">
                    <strong className="text-[#3FB57F] block">Tier 2: Integer Linear Programming (ILP Formulation)</strong>
                    <p className="text-[11px] text-[#9AA4B0] mt-0.5">
                      Minimizes $\sum (w_i \cdot \Delta t_i) + \sum P_c$, where $w_i$ is train priority weight, $\Delta t_i$ is schedule delay, and $P_c$ is penalty for platform double-booking.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedTopic === 'demo' && (
            <div className="space-y-3">
              <span className="font-semibold text-white block">Suggested 2-Minute Live Evaluation Flow:</span>
              <ol className="space-y-2 list-decimal list-inside text-[#E6E9ED]">
                <li className="rounded border border-[#2A323C] bg-[#1B2027] p-2.5">
                  <strong>Observe Baseline Conflict:</strong> Notice the top persistent alert: <code>SC Platform 1 Clash</code> between Express T104 and Express T107.
                </li>
                <li className="rounded border border-[#2A323C] bg-[#1B2027] p-2.5">
                  <strong>Open Decision Support:</strong> Click <em>Review</em> or go to <em>Conflicts</em> $\rightarrow$ inspect side-by-side fix options comparing platform reassignment vs. holding.
                </li>
                <li className="rounded border border-[#2A323C] bg-[#1B2027] p-2.5">
                  <strong>Apply Resolution:</strong> Click <em>Apply Recommendation</em> (Move T104 to SC P3) $\rightarrow$ verify that the platform board, timetable, and conflict banner update simultaneously with 0 secondary delay.
                </li>
                <li className="rounded border border-[#2A323C] bg-[#1B2027] p-2.5">
                  <strong>Test TSR Kinematics:</strong> Open <em>TSR / Field Report</em> in header $\rightarrow$ calculate temporary speed restriction impact (e.g. 30 km/h) on SC South throat.
                </li>
              </ol>
            </div>
          )}

          {selectedTopic === 'faq' && (
            <div className="space-y-2.5">
              <div className="rounded-lg border border-[#2A323C] bg-[#1B2027] p-3">
                <strong className="text-white block">Q: Does the system make autonomous changes without controller approval?</strong>
                <p className="text-[#9AA4B0] mt-1 leading-relaxed">
                  No. The system adheres to strict Human-in-the-Loop design. It operates in Advisory mode by default, providing recommendations with transparent trade-off metrics. Every action includes a 30-second safety Undo window.
                </p>
              </div>
              <div className="rounded-lg border border-[#2A323C] bg-[#1B2027] p-3">
                <strong className="text-white block">Q: How does this scale to larger divisions?</strong>
                <p className="text-[#9AA4B0] mt-1 leading-relaxed">
                  The interval-tree occupancy indexing executes in $O(N \log N)$ time, allowing instant calculation across hundreds of trains and platforms without server lag.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end border-t border-[#2A323C] bg-[#1B2027] px-6 py-3">
          <Button variant="default" size="sm" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
