import { useState, useId, useMemo } from 'react';
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertTriangle,
  X,
  Play,
  Download,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Clock,
  Shuffle,
  Info,
} from 'lucide-react';
import { useOperationsFeed } from '../../context/OperationsFeedContext';
import { notify } from '../../lib/notify';
import {
  autoDetectColumns,
  validateTimetableRows,
  analyseAndOptimizeTimetable,
  DEMO_PRESETS,
  type ColumnMapping,
  type RawTimetableRow,
  type ValidationReport,
  type TimetableAnalysisResult,
  type StandardTimetableRow,
} from '../../lib/timetableEngine';
import { analysisToCorridor, indianServiceDate, parseTimetableCsv } from '../../lib/timetableImport';
import { downloadFile, escapeCsv } from '../../lib/corridorStatus';
import { usePreferences } from '../../context/WorkspacePreferences';
import { ModalFrame } from '../ui/ModalFrame';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportAnalyseModal({ open, onClose }: Props) {
  const fileInputId = useId();
  const prefs = usePreferences();
  const [serviceDate,setServiceDate] = useState(indianServiceDate);
  const [approved,setApproved] = useState(false);
  const feed = useOperationsFeed();

  // Wizard state: 'upload' | 'mapping' | 'results'
  const [step, setStep] = useState<'upload' | 'mapping' | 'results'>('upload');

  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<RawTimetableRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    trainId: '',
    stationId: '',
    scheduledArrival: '',
  });

  const [validation, setValidation] = useState<{
    report: ValidationReport;
    standardRows: StandardTimetableRow[];
  } | null>(null);

  const [analysisResult, setAnalysisResult] = useState<TimetableAnalysisResult | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'conflicts' | 'saved' | 'delayed'>('all');
  const [sourceName, setSourceName] = useState<string>('Custom Timetable');



  // Process raw CSV string
  const processCsvText = (csv: string, name: string) => {
    try {
      const {headers,rows} = parseTimetableCsv(csv);
      setApproved(false);
      const detected = autoDetectColumns(headers);
      setRawHeaders(headers);
      setRawRows(rows);
      setMapping(detected);
      setSourceName(name);

      // Perform initial validation
      const val = validateTimetableRows(rows, detected);
      setValidation(val);
      setStep('mapping');
      notify.success(`Loaded ${rows.length} rows from ${name}`);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to parse CSV.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) { notify.error('Choose a CSV smaller than 2 MB.'); return; }
    const reader = new FileReader();
    reader.onerror = () => notify.error('The file could not be read. Try again.');
    reader.onload = (event) => {
      const content = event.target?.result as string;
      processCsvText(content, file.name);
    };
    reader.readAsText(file);
  };

  const handleLoadPreset = (presetId: string) => {
    const p = DEMO_PRESETS.find((d) => d.id === presetId);
    if (!p) return;
    processCsvText(p.csvContent, p.name);
  };

  const handleUpdateMapping = (field: keyof ColumnMapping, selectedHeader: string) => {
    const updated = { ...mapping, [field]: selectedHeader };
    setMapping(updated);
    if (rawRows.length > 0) {
      const val = validateTimetableRows(rawRows, updated);
      setValidation(val);
    }
  };

  const handleRunAnalysis = () => {
    if (!validation || validation.standardRows.length === 0) {
      notify.error('Cannot analyse: no valid timetable rows.');
      return;
    }

    setIsSolving(true);
    setTimeout(() => {
      try {
        const res = analyseAndOptimizeTimetable(validation.standardRows,5);
        setAnalysisResult(res);setStep('results');setApproved(false);
        notify.success('Timetable analysis ready');
      } catch (error) { notify.error(error instanceof Error ? error.message : 'Analysis failed.'); }
      finally { setIsSolving(false); }
    },0);
  };

  const handleApplyToCorridor = () => {
    if (!analysisResult) return;

    if (!approved || prefs.role === 'viewer' || feed.isLiveBackend || analysisResult.conflictsAfter.length) return;
    try {
      const {schedule,trains} = analysisToCorridor(analysisResult,serviceDate);
      feed.importTimetable(schedule,trains,sourceName);
      notify.success('Imported timetable loaded into this simulation session');
      onClose();
    } catch (error) { notify.error(error instanceof Error ? error.message : 'Import failed.'); }
  };

  const handleExportCsv = () => {
    if (!analysisResult) return;
    const columns = ['Train','Station','Platform before','Platform after','Scheduled arrival','Scheduled departure','Proposed arrival','Proposed departure','Delay before','Delay after','Delay saved','Reason','Action'];
    const rows = analysisResult.stops.map(s=>[s.trainId,s.stationId,s.platformBefore,s.platformAfter,s.schedArrival,s.schedDeparture,s.proposedArrival,s.proposedDeparture,s.delayBeforeMin,s.delayAfterMin,s.delaySavedMin,s.rootCause,s.actionTaken]);
    downloadFile('TrainVision_timetable_'+serviceDate+'.csv',[columns,...rows].map(row=>row.map(escapeCsv).join(',')).join('\n'));
  };

  // Filtered rows in results
  const filteredStops = useMemo(() => {
    if (!analysisResult) return [];
    if (activeFilter === 'conflicts') return analysisResult.stops.filter((s) => s.isConflictParticipant);
    if (activeFilter === 'saved') return analysisResult.stops.filter((s) => s.delaySavedMin > 0);
    if (activeFilter === 'delayed') return analysisResult.stops.filter((s) => s.delayAfterMin > 0);
    return analysisResult.stops;
  }, [analysisResult, activeFilter]);

  if (!open) return null;
  return (
    <ModalFrame open={open} onClose={onClose} label="Import and analyse timetable"><div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      style={{
        background: 'rgba(9, 12, 16, 0.78)',
        backdropFilter: 'blur(16px)',
      }}
    >
      <div
        className="w-full max-w-5xl rounded-2xl flex flex-col shadow-2xl overflow-hidden border sorvo-modal-card"
        style={{
          maxHeight: '92vh',
        }}
      >
        {/* Modal Top Header */}
        <header className="px-6 py-4 flex items-center justify-between border-b flex-shrink-0" style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}>
          <div className="flex items-center gap-3">
            <span
              className="w-10 h-10 rounded-xl grid place-items-center shadow-lg"
              style={{
                background: 'linear-gradient(135deg, #ff8c42 0%, #f07a2e 100%)',
                color: '#fff',
              }}
            >
              <FileSpreadsheet size={20} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-white">Import &amp; Analyse Timetable</h2>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold border" style={{ background: 'rgba(255, 140, 66, 0.12)', borderColor: '#ff8c42', color: '#ff8c42' }}>
                  Greedy OCC Engine
                </span>
              </div>
              <p className="text-xs text-slate-400">Accept any judge timetable sheet, auto-map headers, catch errors, and solve cascading conflicts in &lt; 2s.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {step !== 'upload' && (
              <button
                onClick={() => setStep('upload')}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 transition-colors"
              >
                Change File
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Wizard Steps Navigation Bar */}
        <div className="px-6 py-2.5 bg-black/20 border-b flex items-center gap-6 text-xs font-semibold flex-shrink-0" style={{ borderColor: 'rgba(255, 255, 255, 0.06)' }}>
          <button
            onClick={() => setStep('upload')}
            className={`flex items-center gap-2 pb-1 border-b-2 transition-colors ${step === 'upload' ? 'border-[#ff8c42] text-[#ff8c42]' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            <span>1. Timetable Upload</span>
          </button>
          <span className="text-slate-600">/</span>
          <button
            disabled={!validation}
            onClick={() => validation && setStep('mapping')}
            className={`flex items-center gap-2 pb-1 border-b-2 transition-colors ${step === 'mapping' ? 'border-[#ff8c42] text-[#ff8c42]' : 'border-transparent text-slate-400 hover:text-slate-200 disabled:opacity-40'}`}
          >
            <span>2. Column Mapper &amp; Validator</span>
            {validation?.report.errors.length ? (
              <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] grid place-items-center font-bold">
                {validation.report.errors.length}
              </span>
            ) : null}
          </button>
          <span className="text-slate-600">/</span>
          <button
            disabled={!analysisResult}
            onClick={() => analysisResult && setStep('results')}
            className={`flex items-center gap-2 pb-1 border-b-2 transition-colors ${step === 'results' ? 'border-[#ff8c42] text-[#ff8c42]' : 'border-transparent text-slate-400 hover:text-slate-200 disabled:opacity-40'}`}
          >
            <span>3. Optimization Plan &amp; Audit</span>
            {analysisResult && (
              <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] grid place-items-center font-bold">
                ✓
              </span>
            )}
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* STEP 1: UPLOAD & PRESETS */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* Drag and Drop Zone */}
              <div
                className="border-2 border-dashed rounded-xl p-8 text-center transition-all hover:border-[#ff8c42] cursor-pointer group"
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderColor: 'rgba(255, 255, 255, 0.15)',
                }}
                onClick={() => document.getElementById(fileInputId)?.click()}
              >
                <input
                  id={fileInputId}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <span className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 grid place-items-center mx-auto mb-3 text-[#ff8c42] group-hover:scale-110 transition-transform">
                  <Upload size={24} />
                </span>
                <h3 className="text-base font-semibold text-white">Drag &amp; drop any Timetable CSV file</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  Accepts real Indian Railways timetables, custom judge test sheets, or any column naming convention. The engine auto-aligns headers.
                </p>
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400 font-mono">
                  <span>Minimum columns:</span>
                  <span className="px-2 py-0.5 rounded bg-white/10 text-white">train_id</span>
                  <span className="px-2 py-0.5 rounded bg-white/10 text-white">station_id</span>
                  <span className="px-2 py-0.5 rounded bg-white/10 text-white">arrival</span>
                </div>
              </div>

              {/* Pre-packaged Judge Demo Datasets */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Pre-Packaged Judge Demonstration Sheets</h4>
                  <span className="text-[11px] text-slate-500 font-medium">Click to load instantly</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {DEMO_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => handleLoadPreset(preset.id)}
                      className="p-4 rounded-xl text-left border transition-all hover:scale-[1.02] flex flex-col justify-between group"
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderColor: 'rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <strong className="text-sm font-bold text-white group-hover:text-[#ff8c42] transition-colors">
                            {preset.name}
                          </strong>
                        </div>
                        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-amber-300 mb-2">
                          {preset.badge}
                        </span>
                        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                          {preset.description}
                        </p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-[#ff8c42] font-semibold">
                        <span>Load this sheet</span>
                        <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: COLUMN MAPPER & VALIDATOR */}
          {step === 'mapping' && validation && (
            <div className="space-y-6">
              {/* Validation Summary Pill */}
              <div
                className="p-4 rounded-xl border flex items-center justify-between gap-4"
                style={{
                  background: validation.report.errors.length === 0 ? 'rgba(95, 224, 184, 0.08)' : 'rgba(255, 151, 140, 0.08)',
                  borderColor: validation.report.errors.length === 0 ? 'rgba(95, 224, 184, 0.3)' : 'rgba(255, 151, 140, 0.3)',
                }}
              >
                <div className="flex items-center gap-3">
                  {validation.report.errors.length === 0 ? (
                    <span className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 grid place-items-center">
                      <CheckCircle2 size={18} />
                    </span>
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-rose-500/20 text-rose-400 grid place-items-center">
                      <AlertTriangle size={18} />
                    </span>
                  )}
                  <div>
                    <strong className="text-sm font-bold text-white">
                      {validation.report.totalRows} rows parsed from &ldquo;{sourceName}&rdquo;
                    </strong>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {validation.report.validRows} valid rows ready for solver.
                      {validation.report.errors.length > 0 && ` Flagged ${validation.report.errors.length} bad rows (isolated safely, will not crash).`}
                      {validation.report.warnings.length > 0 && ` ${validation.report.warnings.length} non-blocking warnings.`}
                    </p>
                  </div>
                </div>

                <button
                  disabled={validation.standardRows.length === 0 || isSolving}
                  onClick={handleRunAnalysis}
                  className="px-5 py-2.5 rounded-xl font-bold text-sm text-white flex items-center gap-2 shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
                  style={{
                    background: 'linear-gradient(135deg, #ff8c42 0%, #f07a2e 100%)',
                  }}
                >
                  <Play size={16} fill="currentColor" />
                  <span>{isSolving ? 'Solving…' : 'Analyse Timetable'}</span>
                </button>
              </div>

              {/* Validation Flagged Errors (if any) */}
              {validation.report.errors.length > 0 && (
                <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-800/40 text-xs text-rose-200 space-y-1.5">
                  <strong className="font-semibold block text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle size={14} /> Catching Row Defects (Graceful Recovery):
                  </strong>
                  <ul className="list-disc list-inside space-y-1 text-slate-300">
                    {validation.report.errors.map((err, i) => (
                      <li key={i}>
                        Row {err.rowNumber} {err.trainId ? `[${err.trainId}]` : ''}: {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Column Mapping Selectors */}
              <div className="p-4 rounded-xl border space-y-3" style={{ background: 'rgba(255, 255, 255, 0.02)', borderColor: 'rgba(255, 255, 255, 0.08)' }}>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Header Alignment Mapper</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 font-semibold block mb-1">Train ID *</label>
                    <select
                      value={mapping.trainId}
                      onChange={(e) => handleUpdateMapping('trainId', e.target.value)}
                      className="w-full text-xs rounded-lg px-2.5 py-1.5 bg-black/40 border border-slate-700 text-white"
                    >
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 font-semibold block mb-1">Station Code *</label>
                    <select
                      value={mapping.stationId}
                      onChange={(e) => handleUpdateMapping('stationId', e.target.value)}
                      className="w-full text-xs rounded-lg px-2.5 py-1.5 bg-black/40 border border-slate-700 text-white"
                    >
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 font-semibold block mb-1">Arrival Time *</label>
                    <select
                      value={mapping.scheduledArrival}
                      onChange={(e) => handleUpdateMapping('scheduledArrival', e.target.value)}
                      className="w-full text-xs rounded-lg px-2.5 py-1.5 bg-black/40 border border-slate-700 text-white"
                    >
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 font-semibold block mb-1">Departure Time</label>
                    <select
                      value={mapping.scheduledDeparture || ''}
                      onChange={(e) => handleUpdateMapping('scheduledDeparture', e.target.value)}
                      className="w-full text-xs rounded-lg px-2.5 py-1.5 bg-black/40 border border-slate-700 text-white"
                    >
                      <option value="">(Same as arrival)</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 font-semibold block mb-1">Platform</label>
                    <select
                      value={mapping.platform || ''}
                      onChange={(e) => handleUpdateMapping('platform', e.target.value)}
                      className="w-full text-xs rounded-lg px-2.5 py-1.5 bg-black/40 border border-slate-700 text-white"
                    >
                      <option value="">(Default: PF 1)</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 5-Row Data Preview */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Mapped Preview (First 5 Rows)</h4>
                <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}>
                  <table className="w-full text-left text-xs">
                    <thead className="bg-black/30 text-slate-400 font-semibold border-b border-white/5">
                      <tr>
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Train ID</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Station</th>
                        <th className="px-3 py-2">PF</th>
                        <th className="px-3 py-2">Arr</th>
                        <th className="px-3 py-2">Dep</th>
                        <th className="px-3 py-2">Reported Delay</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {validation.standardRows.slice(0, 5).map((r) => (
                        <tr key={r.id} className="hover:bg-white/5">
                          <td className="px-3 py-2 text-slate-500 font-mono">#{r.rowNumber}</td>
                          <td className="px-3 py-2 font-bold text-[#ff8c42]">{r.trainId}</td>
                          <td className="px-3 py-2 text-slate-300">{r.trainType}</td>
                          <td className="px-3 py-2 font-mono font-semibold">{r.stationId}</td>
                          <td className="px-3 py-2 text-slate-300">PF {r.platform}</td>
                          <td className="px-3 py-2 font-mono text-emerald-400">{r.scheduledArrival}</td>
                          <td className="px-3 py-2 font-mono text-emerald-400">{r.scheduledDeparture}</td>
                          <td className="px-3 py-2 text-slate-400 font-mono">
                            {r.reportedDelayMin > 0 ? (
                              <span className="text-amber-400">+{r.reportedDelayMin}m</span>
                            ) : (
                              '0m'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: RESULTS, BEFORE/AFTER AUDIT & APPLY */}
           {step === 'results' && <div className="import-approval">
 <label>Service date (IST)<input type="date" value={serviceDate} onChange={e=>{setServiceDate(e.target.value);setApproved(false);}}/></label>
 <label className="check-row"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/><span>I reviewed the proposal and understand it replaces this session's timetable.</span></label>
 <p className="muted">{feed.isLiveBackend?'Import is disabled for a connected backend.':prefs.role==='viewer'?'Viewer mode is read-only.':analysisResult?.conflictsAfter.length?'Resolve the remaining conflicts before importing.':'Times use the selected date in IST. This is a local simulation import.'}</p>
 </div>}
 {step === 'results' && analysisResult && (
            <div className="space-y-6">
              {/* Top 3 KPI Hero Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Metric 1: Total Delay */}
                <div
                  className="p-4 rounded-xl border flex flex-col justify-between"
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <span className="text-xs text-slate-400 font-semibold flex items-center justify-between">
                    <span>Total Corridor Delay</span>
                    <Clock size={14} className="text-[#ff8c42]" />
                  </span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <strong className="text-2xl font-bold font-mono text-white">
                      {analysisResult.metrics.totalDelayBeforeMin}m
                    </strong>
                    <span className="text-xs text-slate-400 font-mono">→</span>
                    <strong className="text-2xl font-bold font-mono text-emerald-400">
                      {analysisResult.metrics.totalDelayAfterMin}m
                    </strong>
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-400 mt-1">
                    ↓ {analysisResult.metrics.delaySavedMin} minutes saved ({Math.round((analysisResult.metrics.delaySavedMin / Math.max(1, analysisResult.metrics.totalDelayBeforeMin)) * 100)}% recovery)
                  </span>
                </div>

                {/* Metric 2: Platform Conflicts */}
                <div
                  className="p-4 rounded-xl border flex flex-col justify-between"
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <span className="text-xs text-slate-400 font-semibold flex items-center justify-between">
                    <span>Platform Conflicts</span>
                    <ShieldCheck size={14} className="text-emerald-400" />
                  </span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <strong className="text-2xl font-bold font-mono text-rose-400">
                      {analysisResult.metrics.conflictsBeforeCount}
                    </strong>
                    <span className="text-xs text-slate-400 font-mono">→</span>
                    <strong className="text-2xl font-bold font-mono text-emerald-400">
                      {analysisResult.metrics.conflictsAfterCount}
                    </strong>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400 mt-1">
                    {analysisResult.metrics.conflictsBeforeCount - analysisResult.metrics.conflictsAfterCount} clashes resolved via reassignment &amp; dwell tuning
                  </span>
                </div>

                {/* Metric 3: On-Time Performance */}
                <div
                  className="p-4 rounded-xl border flex flex-col justify-between"
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <span className="text-xs text-slate-400 font-semibold flex items-center justify-between">
                    <span>On-Time Performance (≤ 2m)</span>
                    <Sparkles size={14} className="text-amber-400" />
                  </span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <strong className="text-2xl font-bold font-mono text-slate-300">
                      {analysisResult.metrics.onTimePctBefore}%
                    </strong>
                    <span className="text-xs text-slate-400 font-mono">→</span>
                    <strong className="text-2xl font-bold font-mono text-[#ff8c42]">
                      {analysisResult.metrics.onTimePctAfter}%
                    </strong>
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-400 mt-1">
                    +{Math.round((analysisResult.metrics.onTimePctAfter - analysisResult.metrics.onTimePctBefore) * 10) / 10}% corridor punctuality lift
                  </span>
                </div>
              </div>

              {/* Action Toolbar & Filters */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-semibold">Filter:</span>
                  <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/5 text-xs">
                    <button
                      onClick={() => setActiveFilter('all')}
                      className={`px-2.5 py-1 rounded-md transition-colors ${activeFilter === 'all' ? 'bg-[#ff8c42] text-white font-bold' : 'text-slate-400 hover:text-white'}`}
                    >
                      All ({analysisResult.stops.length})
                    </button>
                    <button
                      onClick={() => setActiveFilter('conflicts')}
                      className={`px-2.5 py-1 rounded-md transition-colors ${activeFilter === 'conflicts' ? 'bg-[#ff8c42] text-white font-bold' : 'text-slate-400 hover:text-white'}`}
                    >
                      Clash Points ({analysisResult.stops.filter((s) => s.isConflictParticipant).length})
                    </button>
                    <button
                      onClick={() => setActiveFilter('saved')}
                      className={`px-2.5 py-1 rounded-md transition-colors ${activeFilter === 'saved' ? 'bg-[#ff8c42] text-white font-bold' : 'text-slate-400 hover:text-white'}`}
                    >
                      Time Recovered ({analysisResult.stops.filter((s) => s.delaySavedMin > 0).length})
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportCsv}
                    className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 flex items-center gap-1.5 transition-colors"
                  >
                    <Download size={14} />
                    <span>Export CSV</span>
                  </button>
                  <button
                    onClick={handleApplyToCorridor} disabled={!approved || !serviceDate || prefs.role==='viewer' || feed.isLiveBackend || !!analysisResult?.conflictsAfter.length}
                    className="text-xs px-4 py-1.5 rounded-lg font-bold text-white flex items-center gap-1.5 shadow-lg transition-transform hover:scale-105 active:scale-95"
                    style={{
                      background: 'linear-gradient(135deg, #ff8c42 0%, #f07a2e 100%)',
                    }}
                  >
                    <Shuffle size={14} />
                    <span>Apply to Timeline</span>
                  </button>
                </div>
              </div>

              {/* Comprehensive Optimization Results Table */}
              <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}>
                <table className="w-full text-left text-xs">
                  <thead className="bg-black/40 text-slate-400 font-semibold border-b border-white/5">
                    <tr>
                      <th className="px-3 py-2.5">Train</th>
                      <th className="px-3 py-2.5">Stn</th>
                      <th className="px-3 py-2.5">Platform</th>
                      <th className="px-3 py-2.5">Sched</th>
                      <th className="px-3 py-2.5">Predicted</th>
                      <th className="px-3 py-2.5">Proposed</th>
                      <th className="px-3 py-2.5">Delay (Bef → Aft)</th>
                      <th className="px-3 py-2.5">Saved</th>
                      <th className="px-3 py-2.5">Root Cause</th>
                      <th className="px-3 py-2.5">Action Taken</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredStops.map((s) => (
                      <tr key={s.rowId} className="hover:bg-white/5 transition-colors">
                        <td className="px-3 py-2.5">
                          <span className="font-bold text-white block">{s.trainId}</span>
                          <small className="text-[10px] text-slate-400">{s.trainType} (P{s.priority})</small>
                        </td>
                        <td className="px-3 py-2.5 font-mono font-bold text-slate-200">{s.stationId}</td>
                        <td className="px-3 py-2.5">
                          {s.platformBefore !== s.platformAfter ? (
                            <span className="font-mono flex items-center gap-1 font-bold text-emerald-400">
                              <span className="line-through text-slate-500">P{s.platformBefore}</span>
                              <span>→ P{s.platformAfter}</span>
                            </span>
                          ) : (
                            <span className="font-mono text-slate-400">P{s.platformBefore}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-400">{s.schedArrival}</td>
                        <td className="px-3 py-2.5 font-mono text-rose-300">{s.predictedArrival}</td>
                        <td className="px-3 py-2.5 font-mono font-bold text-emerald-400">{s.proposedArrival}</td>
                        <td className="px-3 py-2.5 font-mono">
                          {s.delayBeforeMin > 0 ? (
                            <span>
                              <span className="text-rose-400">+{s.delayBeforeMin}m</span>
                              <span className="text-slate-500"> → </span>
                              <span className={s.delayAfterMin > 0 ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                                {s.delayAfterMin > 0 ? `+${s.delayAfterMin}m` : '0m'}
                              </span>
                            </span>
                          ) : (
                            <span className="text-emerald-400">On-time</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono">
                          {s.delaySavedMin > 0 ? (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[11px]">
                              -{s.delaySavedMin}m
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-300 max-w-[170px] truncate" title={s.rootCause}>
                          {s.rootCause}
                        </td>
                        <td className="px-3 py-2.5 font-medium max-w-[200px] truncate" title={s.actionTaken}>
                          <span className={s.actionTaken.includes('Reassigned') ? 'text-emerald-400' : s.actionTaken.includes('Held') ? 'text-amber-300' : 'text-slate-300'}>
                            {s.actionTaken}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Explanatory Footer with Mathematical Guarantees */}
              <div className="p-3.5 rounded-xl bg-black/30 border border-white/5 flex items-start gap-2.5 text-xs text-slate-400">
                <Info size={16} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <p>
                  <strong className="text-slate-200">Rule-Based Solver Transparency:</strong> The engine only improves arrival times via permitted operational actions: (1) reassignment to free platforms, (2) dwell compression down to minimum dwell ({analysisResult.assumptions.minDwellExpressMin}m express, {analysisResult.assumptions.minDwellLocalMin}m local), and (3) priority precedence holds. It never makes a train exceed physical line speeds, and strictly enforces the {analysisResult.assumptions.headwayBufferMin}-minute safety headway buffer.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div></ModalFrame>
  );
}
