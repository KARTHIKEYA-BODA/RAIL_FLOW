import { useState, useEffect, useCallback } from 'react';
import type { ElementType } from 'react';
import {
  X,
  Clock,
  AlertTriangle,
  Radio,
  Gauge,
  Ban,
  HelpCircle,
  ShieldAlert,
  Check,
  Send,
} from 'lucide-react';
import { createIncident, type IncidentCreatePayload } from '../../lib/operationsApi';
import type { Incident, StationArrival } from '../../types/railway';
import { notify } from '../../lib/notify';
import { config } from '../../config';

interface StationReportSheetProps {
  open: boolean;
  onClose: () => void;
  stationId?: string;
  stationName?: string;
  defaultTrainId?: string;
  availableTrains?: StationArrival[];
  platformsCount?: number;
  onReportSubmitted?: (incident: Incident) => void;
  trainOptions?: { id: string; name: string }[];
}

type ReportType = 'late_train' | 'loco_failure' | 'signal_failure' | 'speed_restriction' | 'platform_blocked' | 'safety_incident' | 'other';

const REPORT_TYPES: { id: ReportType; label: string; icon: ElementType; isSafety?: boolean; desc: string }[] = [
  { id: 'late_train', label: 'Late train', icon: Clock, desc: 'Entry/throat delay outside outer home' },
  { id: 'loco_failure', label: 'Loco failure', icon: AlertTriangle, desc: 'Stalled rake or engine trouble' },
  { id: 'signal_failure', label: 'Signal failure', icon: Radio, desc: 'Aspect blank, lamp fused, interlocking fail' },
  { id: 'speed_restriction', label: 'Speed restriction', icon: Gauge, desc: 'TSR caution order on turnout/block' },
  { id: 'platform_blocked', label: 'Platform blocked', icon: Ban, desc: 'Overrun rake, obstruction, track ballast' },
  { id: 'other', label: 'Other', icon: HelpCircle, desc: 'Shunting or operational disturbance' },
  { id: 'safety_incident', label: 'Safety incident', icon: ShieldAlert, isSafety: true, desc: 'Critical line hazard, trespasser, derailment' },
];

const NO_ARRIVALS: StationArrival[] = [];

const DURATION_PRESETS = [
  { label: '10 min', value: 10 },
  { label: '20 min', value: 20 },
  { label: '30 min', value: 30 },
  { label: '60 min', value: 60 },
  { label: '45 min', value: 45 },
];

export function StationReportSheet({
  open,
  onClose,
  stationId = 'SC',
  stationName = 'Secunderabad Jn',
  defaultTrainId,
  availableTrains = NO_ARRIVALS,
  platformsCount = 6,
  onReportSubmitted,
  trainOptions = [],
}: StationReportSheetProps) {
  // Step in 3-step sequence (1: Type, 2: Train/Platform, 3: Duration/Note)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form fields
  const [selectedType, setSelectedType] = useState<ReportType>('late_train');
  const [selectedTrain, setSelectedTrain] = useState<string>(defaultTrainId || '');
  const [selectedPlatform, setSelectedPlatform] = useState<number | null>(null);
  const [blockId, setBlockId] = useState('');
  const [blocks, setBlocks] = useState<Array<{ id: string; from_station: string; to_station: string }>>([]);
  useEffect(() => { if (open) fetch(`${config.API_BASE_URL}/corridor/blocks`).then(r => r.ok ? r.json() : []).then(setBlocks).catch(() => setBlocks([])); }, [open]);
  const [durationMin, setDurationMin] = useState<number>(15);
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Sync default train when opened
  useEffect(() => {
    if (open) {
      setStep(1);
      if (defaultTrainId) {
        setSelectedTrain(defaultTrainId);
      } else if (availableTrains.length > 0) {
        setSelectedTrain(availableTrains[0].train_id);
      }
    }
  }, [open, defaultTrainId, availableTrains]);

  // Submission handler
  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if ((selectedType === 'late_train' || selectedType === 'loco_failure') && !selectedTrain) { notify.error('Select a simulated train', 'This report needs a train from the simulation.'); return; }
    if (['loco_failure', 'signal_failure', 'speed_restriction'].includes(selectedType) && !blockId) { notify.error('Select a section', 'Choose the affected simulated block.'); return; }
    if (selectedType === 'platform_blocked' && !selectedPlatform) { notify.error('Select a platform', 'Choose the blocked simulated platform.'); return; }
    setIsSubmitting(true);

    const payload: IncidentCreatePayload = {
      station: stationId,
      type: selectedType,
      train_ids: selectedTrain ? [selectedTrain] : [],
      platform: selectedPlatform,
      block_id: blockId || null,
      est_duration_min: durationMin,
      note: note.trim() || undefined,
      reported_by: `Station Master ${stationId}`,
    };

    try {
      const res = await createIncident(payload);
      const inc: Incident = res.incident;

      // Trigger callback
      onReportSubmitted?.(inc);
      notify.success(
        `Incident Logged (${inc.id})`,
        'Provisional simulation report. Section Control can review and confirm it.'
      );

      if (res.safety_alert) {
        notify.warning('Safety Alert Notice', res.safety_alert);
      }

      onClose();
    } catch (err: unknown) {
      notify.error('Report not sent', err instanceof Error ? err.message : 'The backend is unavailable. Use official channels for real incidents.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    stationId,
    selectedType,
    selectedTrain,
    selectedPlatform,
    blockId,
    durationMin,
    note,
    onReportSubmitted,
    onClose,
  ]);

  // Keyboard shortcut listener (Enter = submit, Escape = close)
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        if (step < 3) {
          setStep((prev) => (prev + 1) as 2 | 3);
        } else {
          handleSubmit();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, step, handleSubmit, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl hud-card rounded-t-3xl shadow-2xl p-6 text-white pb-8 animate-in slide-in-from-bottom duration-250"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#f2b84b]/15 border border-[#f2b84b]/40 flex items-center justify-center text-[#f2b84b] font-bold text-sm">
              10s
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white tracking-tight">
                  Station Master 10-Second Report
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/60 border border-white/10 font-mono">
                  [I] Shortcut
                </span>
              </div>
              <p className="text-xs text-white/50">
                {stationName} ({stationId}) · Auto-logged at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-amber-200 mb-4">Simulation only: this report does not notify railway staff. Use official channels for real incidents.</p>

        {/* Step Tabs */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          <button
            onClick={() => setStep(1)}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              step === 1
                ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] shadow-md shadow-[#f2b84b]/20 font-bold'
                : 'bg-white/5 text-white/60 hover:text-white border border-white/10'
            }`}
          >
            <span>1. Type</span>
            {selectedType && <Check className="w-3 h-3" />}
          </button>
          <button
            onClick={() => setStep(2)}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              step === 2
                ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] shadow-md shadow-[#f2b84b]/20 font-bold'
                : 'bg-white/5 text-white/60 hover:text-white border border-white/10'
            }`}
          >
            <span>2. Target</span>
            {(selectedTrain || selectedPlatform) && <Check className="w-3 h-3" />}
          </button>
          <button
            onClick={() => setStep(3)}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              step === 3
                ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] shadow-md shadow-[#f2b84b]/20 font-bold'
                : 'bg-white/5 text-white/60 hover:text-white border border-white/10'
            }`}
          >
            <span>3. Duration</span>
            {durationMin && <Check className="w-3 h-3" />}
          </button>
        </div>

        {/* STEP 1: Incident Type */}
        {step === 1 && (
          <div className="space-y-4">
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider block">
              Step 1 · Select Incident Category (Minimum 48px tap targets)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {REPORT_TYPES.map((t) => {
                const isSelected = selectedType === t.id;
                const IconComponent = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedType(t.id);
                      setStep(2);
                    }}
                    className={`min-h-[52px] p-3 rounded-xl flex items-center gap-3 text-left transition-all border cursor-pointer ${
                      isSelected
                        ? t.isSafety
                          ? 'bg-[#451212] border-[#ff6a5c] text-white shadow-lg shadow-red-950/40 ring-1 ring-[#ff6a5c]'
                          : 'bg-[#f2b84b]/15 border-[#f2b84b] text-white ring-1 ring-[#f2b84b]'
                        : t.isSafety
                        ? 'bg-red-950/30 border-red-500/30 text-red-400 hover:bg-red-950/50'
                        : 'bg-white/[0.04] border-white/10 text-white/80 hover:bg-white/[0.08]'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? t.isSafety
                            ? 'bg-[#ff6a5c] text-white'
                            : 'bg-[#f2b84b] text-[#1c1710]'
                          : t.isSafety
                          ? 'bg-[#ff6a5c]/20 text-[#ff6a5c]'
                          : 'bg-white/10 text-white/70'
                      }`}
                    >
                      <IconComponent className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold leading-tight truncate">{t.label}</div>
                      <div className="text-[10px] text-white/50 truncate">{t.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 2: Train or Platform */}
        {step === 2 && (
          <div className="space-y-4">
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider block">
              Step 2 · Target Train or Platform
            </label>

            {['loco_failure', 'signal_failure', 'speed_restriction'].includes(selectedType) && <div><label htmlFor="incident-block" className="text-xs text-white/60 mb-1.5 block">Affected simulated section:</label><select id="incident-block" value={blockId} onChange={e => setBlockId(e.target.value)} className="w-full bg-[#17181b] border border-white/10 rounded-xl px-3 py-3 text-white"><option value="">Select a section</option>{blocks.map(b => <option key={b.id} value={b.id}>{b.from_station} – {b.to_station}</option>)}</select><p className="text-xs text-white/50 mt-2">These are modelled sections; a report does not establish a real location.</p></div>}
            {/* Platform chips (P1 - P6) */}
            <div>
              <span className="text-xs text-white/60 mb-1.5 block">Select Platform (if station throat / berth):</span>
              <div className="grid grid-cols-6 gap-2">
                {Array.from({ length: platformsCount }, (_, i) => i + 1).map((pNum) => {
                  const isSelected = selectedPlatform === pNum;
                  return (
                    <button
                      key={`pf-chip-${pNum}`}
                      onClick={() => setSelectedPlatform(isSelected ? null : pNum)}
                      className={`h-12 rounded-xl text-xs font-bold flex flex-col items-center justify-center border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] border-[#f2b84b] shadow-md shadow-[#f2b84b]/20 font-black'
                          : 'bg-white/[0.04] border-white/10 text-white/80 hover:bg-white/[0.08]'
                      }`}
                    >
                      <span className="text-[10px] opacity-75 font-mono">PF</span>
                      <span className="text-sm font-mono">{pNum}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {availableTrains.length === 0 && trainOptions.length > 0 && <div><label htmlFor="report-train" className="text-xs text-white/60 mb-1.5 block">Select simulated train:</label><select id="report-train" value={selectedTrain} onChange={event => setSelectedTrain(event.target.value)} className="w-full bg-[#17181b] border border-white/10 rounded-xl px-3 py-3 text-white"><option value="">Select a train</option>{trainOptions.map(train => <option value={train.id} key={train.id}>{train.name} ({train.id})</option>)}</select></div>}
            {/* Train Quick-Select Chips */}
            <div>
              <span className="text-xs text-white/60 mb-1.5 block">Or select arriving train:</span>
              <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
                {availableTrains.slice(0, 8).map((t) => {
                  const isSelected = selectedTrain === t.train_id;
                  return (
                    <button
                      key={`train-chip-${t.train_id}`}
                      onClick={() => setSelectedTrain(isSelected ? '' : t.train_id)}
                      className={`px-3 py-2 rounded-xl text-xs font-medium border flex items-center gap-2 transition-all min-h-[44px] cursor-pointer ${
                        isSelected
                          ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] border-[#f2b84b] font-bold'
                          : 'bg-white/[0.04] border-white/10 text-white/80 hover:bg-white/[0.08]'
                      }`}
                    >
                      <span className="font-mono">{t.train_id}</span>
                      <span className="text-[11px] opacity-75">({t.category})</span>
                      {t.delay_minutes > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                          +{t.delay_minutes.toFixed(0)}m
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Duration & Optional Note */}
        {step === 3 && (
          <div className="space-y-4">
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider block">
              Step 3 · Expected Duration & Notes
            </label>

            {/* Duration Presets */}
            <div>
              <span className="text-xs text-white/60 mb-1.5 block">Estimated duration:</span>
              <div className="grid grid-cols-5 gap-2">
                {DURATION_PRESETS.map((d) => {
                  const isSelected = durationMin === d.value;
                  return (
                    <button
                      key={`dur-${d.label}`}
                      onClick={() => setDurationMin(d.value)}
                      className={`h-11 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] border-[#f2b84b] shadow-md shadow-[#f2b84b]/20'
                          : 'bg-white/[0.04] border-white/10 text-white/80 hover:bg-white/[0.08]'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Note text field */}
            <div>
              <span className="text-xs text-white/60 mb-1.5 block">Optional field note:</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Broken rail on crossover, points motor flashing, stalled rake"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#f2b84b] focus:ring-1 focus:ring-[#f2b84b]"
              />
            </div>

            {/* Auto-filled details recap */}
            <div className="p-3 rounded-xl bg-black/40 border border-white/10 text-[11px] text-white/50 flex items-center justify-between">
              <span>Station: <strong className="text-white">{stationName}</strong></span>
              <span>Reporter: <strong className="text-white">Station Master {stationId}</strong></span>
              <span>Re-plan: <strong className="text-[#f2b84b]">simulated</strong></span>
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/10">
          {step > 1 ? (
            <button
              onClick={() => setStep((prev) => (prev - 1) as 1 | 2)}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white/80 transition-colors cursor-pointer"
            >
              Back
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white/50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}

          {step < 3 ? (
            <button
              onClick={() => setStep((prev) => (prev + 1) as 2 | 3)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] text-xs font-bold flex items-center gap-2 shadow-md shadow-[#f2b84b]/20 hover:brightness-105 transition-all cursor-pointer"
            >
              <span>Next Step</span>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] text-xs font-bold flex items-center gap-2 shadow-md shadow-[#f2b84b]/30 hover:brightness-105 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Logging...' : 'Submit Report (Enter)'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
