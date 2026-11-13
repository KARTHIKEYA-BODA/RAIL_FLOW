import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  HardHat,
  Radio,
  RefreshCw,
  Route,
  Map as MapIcon,
  Building2,
  Plus,
} from 'lucide-react';
import type { ScheduleEntry, Station, Train } from '../../types/railway';
import { config } from '../../config';
import { MareyChart } from './MareyChart';
import { CorridorTrackMap } from './CorridorTrackMap';
import { DisruptionInjectorModal } from './DisruptionInjectorModal';
import { MaintenancePlannerModal } from './MaintenancePlannerModal';
import { StationMasterView } from './StationMasterView';
import { StationGate } from './StationGate';
import { ProvisionalIncidents } from './ProvisionalIncidents';
import { StationReportSheet } from './StationReportSheet';
import { notify } from '../../lib/notify';
import './controller.css';

type Decision = {
  id: string;
  train_id: string;
  station_id: string;
  one_line_reason: string;
  hold_minutes?: number;
  other_train_id?: string | null;
  status: string;
};

type Preview = {
  status: string;
  delta_weighted_delay_min?: number;
  assumption?: string;
  message?: string;
};

type Snapshot = {
  schedule: ScheduleEntry[];
  previous: ScheduleEntry[];
  recommendations: Decision[];
  kpis: {
    solve_time_ms?: number;
    solver_status?: string;
    weighted_delay_solver_min?: number;
  };
};

type BenchmarkRun = {
  seed: number;
  FCFS: { total_weighted_delay_min: number };
  PRIORITY: { total_weighted_delay_min: number };
  SOLVER: { total_weighted_delay_min: number; solver_status: string };
};

type ReplayAlternative = Preview & { alternative_schedule?: ScheduleEntry[] };
type RecordedReplay = { id: number; review_events?: Array<{ decision_index: number; event: string; created_at: string }>; model_current?: boolean; corridor_date: string; schedule: ScheduleEntry[]; trains: Train[]; limitations: string; decisions: Array<{train_id: string; station_id: string; hold_minutes: number; one_line_reason?: string; other_train_id?: string | null; review_status?: string; alternative?: ReplayAlternative | null}> };
type ReplayOption = { id: number; corridor_date: string; train_count: number };

type Benchmark = {
  status: string;
  timestamp?: string;
  seeds_evaluated?: number[];
  trains_per_instance?: number;
  scenarios?: Record<
    string,
    {
      name: string;
      averages: Record<string, { weighted_delay_min: number; solve_time_ms?: number }>;
      runs: BenchmarkRun[];
    }
  >;
};

export function ControllerWorkspace() {
  const [trains, setTrains] = useState<Train[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [page, setPage] = useState<'control' | 'station' | 'proof'>('control');
  const [disruption, setDisruption] = useState(false);
  const [maintenance, setMaintenance] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [blocks, setBlocks] = useState<Array<{ section_id: string; duration_minutes: number; start_time: string }>>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  const [stationFocus, setStationFocus] = useState<string>('ALL');
  const [replay, setReplay] = useState<RecordedReplay | null>(null);
  const [replayOptions, setReplayOptions] = useState<ReplayOption[]>([]);
  const [replayMessage, setReplayMessage] = useState('');
  const [replayAlternative, setReplayAlternative] = useState<ReplayAlternative | null>(null);
  const [alternativeIndex, setAlternativeIndex] = useState<number | null>(null);
  const [showAlternative, setShowAlternative] = useState(false);
  const [viewMode, setViewMode] = useState<'timetable' | 'map'>('timetable');

  // Live simulation clock
  const [liveClock, setLiveClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour12: false })
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveClock(new Date().toLocaleTimeString([], { hour12: false }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Global 'I' hotkey to open 10-second report drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!replay && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        setReportOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [replay]);

  const refresh = useCallback(async () => {
    try {
      const [scheduleRes, blockRes, trainRes, stationRes] = await Promise.all([
        fetch(`${config.API_BASE_URL}/schedule`),
        fetch(`${config.API_BASE_URL}/maintenance/active`),
        fetch(`${config.API_BASE_URL}/trains`),
        fetch(`${config.API_BASE_URL}/stations`),
      ]);
      if (![scheduleRes, blockRes, trainRes, stationRes].every((r) => r.ok)) {
        throw new Error('Backend unavailable');
      }
      setSnapshot(await scheduleRes.json());
      setBlocks(await blockRes.json());
      setTrains(await trainRes.json());
      setStations(await stationRes.json());
      setError('');
    } catch {
      setSnapshot(null);
      setBlocks([]);
      setError('Connect the RAILFLOW backend to calculate and review decisions.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (page !== 'proof' || benchmark) return;
    fetch(`${config.API_BASE_URL}/benchmark/results`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBenchmark(d))
      .catch(() => setBenchmark(null));
  }, [page, benchmark]);

  async function loadReplayList() {
    try {
      const response = await fetch(`${config.API_BASE_URL}/controller/replays`);
      if (!response.ok) throw new Error('Could not load recorded previews.');
      const items: ReplayOption[] = await response.json(); setReplayOptions(items);
      setReplayMessage(items.length ? '' : 'No recorded timetable previews. Create one in Station Master first.');
    } catch (err) { setReplayMessage(err instanceof Error ? err.message : 'Could not load recorded previews.'); }
  }
  async function selectReplay(id: string) {
    if (!id) { setReplay(null); setReplayAlternative(null); setAlternativeIndex(null); setShowAlternative(false); setReplayMessage(''); return; }
    try {
      const response = await fetch(`${config.API_BASE_URL}/controller/replays/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error('Could not load recorded preview.');
      setReplay(await response.json()); setReplayAlternative(null); setAlternativeIndex(null); setShowAlternative(false); setViewMode('timetable'); setStationFocus('ALL'); setPreview(null); setReplayMessage('');
    } catch (err) { setReplayMessage(err instanceof Error ? err.message : 'Could not load recorded preview.'); }
  }
  const replayIndex = replay?.decisions.findIndex(item => !item.review_status || item.review_status === 'PENDING' || item.review_status === 'PREVIEWED') ?? -1;
  const replayDecision = replay && replayIndex >= 0 ? replay.decisions[replayIndex] : null;
  const currentReplayAlternative = alternativeIndex === replayIndex ? replayAlternative : null;
  const displaySchedule = (showAlternative ? replayAlternative?.alternative_schedule : null) ?? replay?.schedule ?? snapshot?.schedule ?? [];
  const displayTrains = replay?.trains ?? trains;
  const decision = replay ? null : snapshot?.recommendations.find((r) => r.status === 'PENDING') ?? null;

  const actReplay = async (action: 'preview' | 'accept' | 'reject') => {
    if (!replay || replayIndex < 0) return;
    setBusy(true); setReplayMessage('');
    try {
      const response = await fetch(`${config.API_BASE_URL}/controller/replays/${replay.id}/decisions/${replayIndex}/${action}`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Replay review failed.');
      if (action === 'preview') { setReplayAlternative(data); setAlternativeIndex(replayIndex); setShowAlternative(false); }
      else {
        const updated = await fetch(`${config.API_BASE_URL}/controller/replays/${replay.id}`);
        if (!updated.ok) throw new Error('Review was saved but the replay could not be refreshed.');
        const updatedReplay: RecordedReplay = await updated.json();
        const savedAlternative = action === 'reject' ? updatedReplay.decisions[replayIndex]?.alternative ?? null : null;
        setReplay(updatedReplay); setReplayAlternative(savedAlternative); setAlternativeIndex(savedAlternative ? replayIndex : null); setShowAlternative(Boolean(savedAlternative?.alternative_schedule?.length));
        setReplayMessage(data.message);
      }
    } catch (err) { setReplayMessage(err instanceof Error ? err.message : 'Replay review failed.'); }
    finally { setBusy(false); }
  };

  const act = async (action: 'accept' | 'reject' | 'preview-rejection') => {
    if (!decision) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${config.API_BASE_URL}/recommendations/${encodeURIComponent(decision.id)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          ...(action === 'reject'
            ? {
                body: JSON.stringify({
                  recommendation_id: decision.id,
                  reason_code: 'CONTROLLER_PREFERENCE',
                }),
              }
            : {}),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'The action could not be completed.');
      if (action === 'preview-rejection') {
        setPreview(data);
      } else {
        setPreview(null);
        await refresh();
        notify.success(
          action === 'accept' ? 'Decision recorded' : 'Alternative plan applied',
          action === 'accept' ? 'Simulation instruction recorded for the relevant station; no message was sent externally.' : 'Alternative applied to the simulation; no message was sent externally.'
        );
      }
    } catch (err) {
      notify.error('Action failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="controller-app">
      {/* ══════════════ AUTHORITATIVE SINGLE TOP HEADER ══════════════ */}
      <header className="controller-header">
        <div
          className="controller-brand"
          onClick={() => setPage('control')}
          role="button"
          tabIndex={0}
        >
          <span className="controller-logo-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 3.5v17M18 3.5v17M6 8h12M6 16h12"
                stroke="#f3c46c"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M9.2 8v8M14.8 8v8"
                stroke="rgba(243,196,108,.38)"
                strokeWidth="1"
                strokeDasharray="1.6 2.4"
              />
            </svg>
          </span>
          <span className="leading-none">
            <span className="controller-brand-title">RAILFLOW</span>
            <span className="controller-brand-sub">Central Section · SC–WDR</span>
          </span>
        </div>

        <nav aria-label="Main navigation">
          <button
            aria-current={page === 'control' ? 'page' : undefined}
            onClick={() => setPage('control')}
          >
            <Radio size={14} /> Section Control
          </button>
          <button
            aria-current={page === 'station' ? 'page' : undefined}
            onClick={() => setPage('station')}
          >
            <Building2 size={14} /> Station Master (SC)
          </button>
          <button disabled={!!replay} onClick={() => setMaintenance(true)}>
            <HardHat size={14} /> Maintenance
          </button>
          <button
            aria-current={page === 'proof' ? 'page' : undefined}
            onClick={() => setPage('proof')}
          >
            <BarChart3 size={14} /> Proof
          </button>
        </nav>

        <div className="controller-header-tools">
          <span className="live-pill">
            <span className="live-dot" />
            {replay && page === 'control' ? 'Replay' : 'Simulated'}
          </span>
          <div className="clock-box hidden md:flex">
            <div className="clock-time font-mono">{liveClock}</div>
          </div>
          <button
            className="controller-primary"
            style={{ minHeight: '34px', padding: '0 12px', fontSize: '11px' }}
            disabled={!!replay}
            onClick={() => setReportOpen(true)}
            title="Press I to report a simulated incident"
          >
            <Plus size={13} strokeWidth={2.6} />
            <span>Report (I)</span>
          </button>
          <span className="controller-sim-tag">{snapshot ? 'Connected' : 'Offline'}</span>
        </div>
      </header>

      {/* ══════════════ MAIN WORKSPACE CONTENT ══════════════ */}
      <main id="main-content" className="controller-main">
        {page === 'station' ? (
          <StationGate><StationMasterView onNavigateToSectionView={() => setPage('control')} /></StationGate>
        ) : (
          <>
            <div className="controller-top">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="h-px w-6 bg-gradient-to-r from-[#f2b84b] to-transparent" />
                  <p className="controller-eyebrow">INTERMODAL SECTION CONTROL · 24/7</p>
                </div>
                <h1>
                  {page === 'control' ? (
                    <>
                      Make the next <span className="accent">decision.</span>
                    </>
                  ) : (
                    <>
                      Benchmark <span className="accent">evidence.</span>
                    </>
                  )}
                </h1>
                <p>
                  {page === 'control'
                    ? 'Review the CP-SAT proposed schedule and keep the controller in charge.'
                    : 'Compare replayed weighted delays on identical synthetic scenarios.'}
                </p>
                <p>Advisory only. Signalling and interlocking remain the safety authority.</p>
              </div>
              <div className="controller-actions">
                <button className="controller-secondary" onClick={() => void refresh()}>
                  <RefreshCw size={14} /> Refresh
                </button>
                <button
                  className="controller-primary"
                  disabled={!snapshot || !!replay}
                  onClick={() => setDisruption(true)}
                >
                  <AlertTriangle size={15} /> Report disruption
                </button>
              </div>
            </div>

            {page === 'control' && <div className="controller-replay-select"><button className="controller-secondary" disabled={busy} onClick={() => void loadReplayList()}>Choose recorded timetable</button>{replayOptions.length > 0 && <select aria-label="Controller timetable source" disabled={busy} className="controller-filter-select" value={replay?.id ?? ''} onChange={e => void selectReplay(e.target.value)}><option value="">Current simulated plan</option>{replayOptions.map(item => <option key={item.id} value={item.id}>Replay #{item.id} · {item.corridor_date} · {item.train_count} trains</option>)}</select>}{replay && <button className="controller-secondary" disabled={busy} onClick={() => void selectReplay('')}>Return to simulation</button>}{replayMessage && <span role="status">{replayMessage}</span>}{replay && <span>{showAlternative ? 'ALTERNATIVE PREVIEW · ' : 'RECORDED PLAN · '}{replay.limitations}</span>}</div>}
            {error && (
              <div className="controller-warning" role="status">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            {page === 'control' ? (
              <>
                <div className="controller-grid">
                  <section className="controller-panel controller-chart">
                    <div className="controller-panel-head">
                      <div>
                        <h2>
                          {viewMode === 'timetable'
                            ? 'Section Timetable (Stringlines)'
                            : 'Corridor Track Schematic (Live Movements)'}
                        </h2>
                        <p>
                          {viewMode === 'timetable'
                            ? 'Time–distance view · drag to pan · mouse wheel to zoom · previous plan shown'
                            : 'Physical track layout · double track UP/DOWN lines & passing loops'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5">
                          <button
                            type="button"
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                              viewMode === 'timetable'
                                ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold shadow-sm'
                                : 'text-white/60 hover:text-white'
                            }`}
                            onClick={() => setViewMode('timetable')}
                          >
                            <Route size={12} /> Timetable
                          </button>
                          <button
                            type="button"
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                              viewMode === 'map'
                                ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold shadow-sm'
                                : 'text-white/60 hover:text-white'
                            }`}
                            disabled={!!replay}
                            onClick={() => setViewMode('map')}
                          >
                            <MapIcon size={12} /> Track Map
                          </button>
                        </div>
                        <select
                          aria-label="Focus station"
                          value={stationFocus}
                          onChange={(e) => setStationFocus(e.target.value)}
                          className="controller-filter-select"
                        >
                          <option value="ALL">Entire Section (SC–WDR 70 km)</option>
                          {stations.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.station_name || s.id} ({s.id}) · {s.platforms}{' '}
                              {s.platforms === 1 ? 'Loop' : 'Loops/PF'}
                            </option>
                          ))}
                        </select>
                        <span className="controller-tag" title="Track types, station capacities and distances are model assumptions">TRACK ASSUMED</span>
                      </div>
                    </div>

                    {viewMode === 'timetable' ? (
                      <MareyChart
                        key={replay ? `replay-${replay.id}-${showAlternative}` : 'simulation'}
                        replay={!!replay}
                        now={replay && replay.schedule.length ? new Date(replay.schedule[0].actual_arrival) : undefined}
                        schedule={displaySchedule}
                        previousSchedule={replay ? [] : snapshot?.previous ?? []}
                        trains={displayTrains}
                        stations={stations}
                        conflicts={[]}
                        activeMaintenance={replay ? [] : blocks}
                        stationFocus={stationFocus}
                        onSelectStation={(id) => setStationFocus(id)}
                      />
                    ) : (
                      <CorridorTrackMap
                        schedule={snapshot?.schedule ?? []}
                        trains={trains}
                        stations={stations}
                        activeMaintenance={blocks}
                        pendingDecision={
                          decision
                            ? {
                                train_id: decision.train_id,
                                station_id: decision.station_id,
                                one_line_reason: decision.one_line_reason,
                              }
                            : null
                        }
                        stationFocus={stationFocus}
                        onSelectStation={(id) => setStationFocus(id)}
                      />
                    )}

                    {!replay && stationFocus !== 'ALL' &&
                      (() => {
                        const focusStation = stations.find((s) => s.id === stationFocus);
                        if (!focusStation) return null;
                        const stationMovements = (snapshot?.schedule ?? [])
                          .filter((e) => e.station_id === stationFocus)
                          .slice(0, 5)
                          .map((e) => {
                            const train = trains.find((t) => t.id === e.train_id);
                            const holdDecision = snapshot?.recommendations.find(
                              (r) =>
                                r.train_id === e.train_id &&
                                r.station_id === stationFocus &&
                                r.status === 'PENDING'
                            );
                            return { entry: e, train, holdDecision };
                          });
                        return (
                          <div className="controller-station-card">
                            <div className="controller-station-head">
                              <div>
                                <h3>
                                  {focusStation.station_name || focusStation.id} ({focusStation.id}) ·
                                  Station Master Reality
                                </h3>
                                <p>
                                  {focusStation.platforms}{' '}
                                  {focusStation.platforms === 1 ? 'Loop' : 'Loops/Berths'} ·{' '}
                                  {['MED', 'MOB', 'ME'].includes(focusStation.id)
                                    ? 'Single-Track Crossing Loop Station'
                                    : 'Corridor Terminal / Junction'}
                                </p>
                              </div>
                              <button
                                className="controller-secondary"
                                style={{ minHeight: '28px', padding: '0 10px', fontSize: '11px' }}
                                onClick={() => setDisruption(true)}
                              >
                                <AlertTriangle size={13} /> Report local delay at {focusStation.id}
                              </button>
                            </div>
                            <div className="controller-table-wrap" style={{ margin: '8px 0 0' }}>
                              <table className="controller-station-table">
                                <thead>
                                  <tr>
                                    <th>Train</th>
                                    <th>Type</th>
                                    <th>Platform / Loop</th>
                                    <th>Arrival</th>
                                    <th>Departure</th>
                                    <th>Operational Status / Reason</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stationMovements.length === 0 ? (
                                    <tr>
                                      <td
                                        colSpan={6}
                                        style={{
                                          textAlign: 'center',
                                          color: 'rgba(246, 243, 236, 0.4)',
                                          padding: '16px',
                                        }}
                                      >
                                        No immediate movements scheduled at {focusStation.id}.
                                      </td>
                                    </tr>
                                  ) : (
                                    stationMovements.map(({ entry, train, holdDecision }) => {
                                      const trainType = train?.type || 'Express';
                                      const badgeClass = trainType.toLowerCase().includes('suburban')
                                        ? 'controller-badge-suburban'
                                        : trainType.toLowerCase().includes('freight')
                                        ? 'controller-badge-freight'
                                        : trainType.toLowerCase().includes('passenger')
                                        ? 'controller-badge-passenger'
                                        : 'controller-badge-express';

                                      return (
                                        <tr key={`${entry.train_id}-${entry.station_id}`}>
                                          <td>
                                            <strong>{entry.train_id}</strong>
                                            {train?.origin && train?.destination && (
                                              <span
                                                style={{
                                                  display: 'block',
                                                  fontSize: '11px',
                                                  color: 'rgba(246, 243, 236, 0.45)',
                                                }}
                                              >
                                                {train.origin} → {train.destination}
                                              </span>
                                            )}
                                          </td>
                                          <td>
                                            <span className={`controller-badge-pill ${badgeClass}`}>
                                              {trainType}
                                            </span>
                                          </td>
                                          <td>
                                            <strong>Loop {entry.assigned_platform}</strong>
                                          </td>
                                          <td>
                                            {entry.actual_arrival
                                              ? new Date(entry.actual_arrival).toLocaleTimeString(
                                                  [],
                                                  { hour: '2-digit', minute: '2-digit', hour12: false }
                                                )
                                              : '—'}
                                          </td>
                                          <td>
                                            {entry.actual_departure
                                              ? new Date(entry.actual_departure).toLocaleTimeString(
                                                  [],
                                                  { hour: '2-digit', minute: '2-digit', hour12: false }
                                                )
                                              : '—'}
                                          </td>
                                          <td>
                                            {holdDecision ? (
                                              <span style={{ color: '#f2b84b', fontWeight: 600 }}>
                                                ⏳ {holdDecision.one_line_reason}
                                              </span>
                                            ) : (
                                              <span style={{ color: '#55e0a3' }}>
                                                ✓ {entry.reason || 'Clear route / on time'}
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}
                  </section>

                  {/* ══════════════ ACTIONABLE DECISION CARD ══════════════ */}
                  <aside className="controller-panel controller-decision">
                    <p className="controller-eyebrow">CONTROLLER DECISION</p>
                    {replay && replayDecision ? <>
                      <span className="controller-tag">REPLAY REVIEW · {stations.find(st => st.id === replayDecision.station_id)?.station_name || replayDecision.station_id}</span>
                      <h2>Hold {replay.trains.find(t => t.id === replayDecision.train_id)?.name || replayDecision.train_id} at {stations.find(st => st.id === replayDecision.station_id)?.station_name || replayDecision.station_id} for {replayDecision.hold_minutes.toFixed(1)} min.</h2>
                      <p>Recorded timetable simulation with assumed infrastructure. This review never changes the active plan.</p>{replayDecision.one_line_reason && <details><summary>Why this hold?</summary><p>{replayDecision.one_line_reason}</p></details>}
                      {!replay.model_current && <p>Model changed or recording predates model tracking. Create a new timetable preview to review this hold.</p>}
                      <button className="controller-secondary controller-wide" disabled={busy || !replay.model_current} onClick={() => void actReplay('preview')}>Preview without this hold</button>
                      {currentReplayAlternative && <div className="controller-preview" role="status"><strong>Alternative · {currentReplayAlternative.status}</strong><p>{currentReplayAlternative.delta_weighted_delay_min == null ? 'No feasible alternative found.' : `${currentReplayAlternative.delta_weighted_delay_min >= 0 ? '+' : ''}${currentReplayAlternative.delta_weighted_delay_min.toFixed(1)} weighted delay-minutes versus recorded plan.`}</p><small>{currentReplayAlternative.assumption} Feasible results may be time-limited.</small>{currentReplayAlternative.alternative_schedule && currentReplayAlternative.alternative_schedule.length > 0 && <button className="controller-secondary controller-wide" onClick={() => setShowAlternative(value => !value)}>{showAlternative ? 'Show recorded plan' : 'Show alternative on chart'}</button>}</div>}
                      <div className="controller-decision-actions"><button className="controller-primary" disabled={busy || !replay.model_current} onClick={() => void actReplay('accept')}>Accept</button><button className="controller-secondary" disabled={busy || !replay.model_current || currentReplayAlternative?.delta_weighted_delay_min == null} onClick={() => void actReplay('reject')}>Record rejection</button></div>
                      <p>Accept records a simulated station instruction; rejection records the comparison. Neither controls trains.</p>
                    </> : decision ? (
                      <>
                        <span className="controller-tag">HOLD · {stations.find(station => station.id === decision.station_id)?.station_name || decision.station_id}</span>
                        <h2>Hold {trains.find(t => t.id === decision.train_id)?.name || decision.train_id} at {stations.find(station => station.id === decision.station_id)?.station_name || decision.station_id}{decision.hold_minutes != null ? ` for ${decision.hold_minutes.toFixed(1)} min` : ''}.</h2>
                        <details><summary>Decision details</summary><p>{decision.one_line_reason}</p></details>
                        <p>
                          This proposed hold is part of the simulated schedule. Preview an
                          alternative before choosing.
                        </p>
                        <button
                          className="controller-secondary controller-wide"
                          disabled={busy}
                          onClick={() => void act('preview-rejection')}
                        >
                          Preview without this hold
                        </button>
                        {!preview && <small>Preview the alternative to enable rejection.</small>}
                        {preview && (
                          <div className="controller-preview" role="status">
                            <strong>Alternative preview · {preview.status}</strong>
                            <p>
                              {preview.delta_weighted_delay_min == null
                                ? preview.message
                                : `${preview.delta_weighted_delay_min >= 0 ? '+' : ''}${preview.delta_weighted_delay_min.toFixed(1)} weighted delay-minutes compared with current plan.`}
                            </p>
                            <small>{preview.assumption} Feasible results may be time-limited.</small>
                          </div>
                        )}
                        <div className="controller-decision-actions">
                          <button
                            className="controller-primary"
                            disabled={busy}
                            onClick={() => void act('accept')}
                          >
                            Accept
                          </button>
                          <button
                            className="controller-secondary"
                            disabled={busy || preview?.delta_weighted_delay_min == null}
                            onClick={() => void act('reject')}
                          >
                            Reject &amp; re-plan
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <h2>{replay ? 'Recorded replay · review' : snapshot ? 'No pending decision' : 'Waiting for the backend'}</h2>
                        <p>
                          {replay ? `${replay.decisions.length} recorded modelled hold(s). No pending holds remain. The active simulation is separate.` : snapshot
                            ? 'Report a disruption to calculate a new plan.'
                            : 'Start the backend to load the simulated timetable.'}
                        </p>
                      </>
                    )}
                    {replay && replay.decisions.some(item => item.review_status === 'REJECTED' && item.alternative?.alternative_schedule?.length) && <details><summary>Saved alternatives</summary>{replay.decisions.map((item, index) => item.review_status === 'REJECTED' && item.alternative?.alternative_schedule?.length ? <button className="controller-secondary controller-wide" key={index} onClick={() => { setReplayAlternative(item.alternative ?? null); setAlternativeIndex(index); setShowAlternative(true); }}>Show alternative for {item.train_id}</button> : null)}{showAlternative && <button className="controller-secondary controller-wide" onClick={() => setShowAlternative(false)}>Show recorded plan</button>}</details>}
                    {replay && replay.review_events && replay.review_events.length > 0 && <details><summary>Recorded review history</summary>{replay.review_events.map((event, index) => <p key={`${event.created_at}-${index}`}>Hold {event.decision_index + 1} · {event.event.toLowerCase()} · {event.created_at}</p>)}</details>}
                    {!replay && <ProvisionalIncidents onConfirmed={() => void refresh()} />}
                  </aside>
                </div>

                {/* ══════════════ KPI METRICS ══════════════ */}
                {!replay && <section className="controller-kpis" aria-label="Plan metrics">
                  <div>
                    <span>Weighted delay</span>
                    <strong>
                      {snapshot?.kpis.weighted_delay_solver_min != null
                        ? `${snapshot.kpis.weighted_delay_solver_min.toFixed(1)} min`
                        : '—'}
                    </strong>
                  </div>
                  <div>
                    <span>Solver status</span>
                    <strong>{snapshot?.kpis.solver_status || '—'}</strong>
                  </div>
                  <div>
                    <span>Solver time</span>
                    <strong>
                      {snapshot?.kpis.solve_time_ms != null
                        ? `${(snapshot.kpis.solve_time_ms / 1000).toFixed(2)} s`
                        : '—'}
                    </strong>
                  </div>
                </section>}
              </>
            ) : (
              <section className="controller-panel controller-proof">
                <h2>Simulation benchmark</h2>
                {benchmark?.status === 'current' && benchmark.scenarios ? (
                  <>
                    <p>
                      {benchmark.trains_per_instance} trains · seeds{' '}
                      {benchmark.seeds_evaluated?.join(', ')} · generated {benchmark.timestamp}.
                      Values show average and range across seeds. Weighted delay is the sum of each train’s destination delay multiplied by its class weight: Express 3, Suburban 2, Passenger 1.5, Freight 1. Lower is better.
                    </p>
                    <div className="controller-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Scenario</th>
                            <th>FCFS</th>
                            <th>Priority</th>
                            <th>Solver</th>
                            <th>Solver status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(benchmark.scenarios).map(([key, scenario]) => (
                            <tr key={key}>
                              <th scope="row">{scenario.name}</th>
                              {['FCFS', 'PRIORITY', 'SOLVER'].map((policy) => (
                                <td key={policy}>
                                  {scenario.averages[policy].weighted_delay_min.toFixed(1)} min · range {Math.min(...scenario.runs.map(run => run[policy as 'FCFS' | 'PRIORITY' | 'SOLVER'].total_weighted_delay_min)).toFixed(1)}–{Math.max(...scenario.runs.map(run => run[policy as 'FCFS' | 'PRIORITY' | 'SOLVER'].total_weighted_delay_min)).toFixed(1)}
                                </td>
                              ))}
                              <td>
                                {[
                                  ...new Set(
                                    scenario.runs.map((run) => run.SOLVER.solver_status)
                                  ),
                                ].join(', ')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <details>
                      <summary style={{ cursor: 'pointer', color: '#f2b84b', margin: '14px 0' }}>
                        Show each seed breakdown
                      </summary>
                      <div className="controller-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Scenario</th>
                              <th>Seed</th>
                              <th>FCFS</th>
                              <th>Priority</th>
                              <th>Solver</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(benchmark.scenarios).flatMap(([key, scenario]) =>
                              scenario.runs.map((run) => (
                                <tr key={`${key}-${run.seed}`}>
                                  <th scope="row">{scenario.name}</th>
                                  <td>{run.seed}</td>
                                  <td>{run.FCFS.total_weighted_delay_min.toFixed(1)} min</td>
                                  <td>{run.PRIORITY.total_weighted_delay_min.toFixed(1)} min</td>
                                  <td>{run.SOLVER.total_weighted_delay_min.toFixed(1)} min</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    <p style={{ fontSize: '11.5px', color: 'rgba(246, 243, 236, 0.45)' }}>
                      These are replay results from a synthetic timetable, not operational
                      performance. FEASIBLE indicates a time-limited solution; the simulator and
                      solver use simplifying assumptions.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Results are unavailable or were generated with an older model. Run the
                      benchmark to produce a report for the current code.
                    </p>
                    <code>python backend/benchmark.py</code>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>

      <footer className="controller-footer">
        Advisory only. Signalling and interlocking remain the safety authority. · RAILFLOW simulation prototype
      </footer>

      <DisruptionInjectorModal
        trains={trains}
        open={disruption}
        onClose={() => setDisruption(false)}
        onInjected={() => {
          setPreview(null);
          void refresh();
        }}
      />
      <MaintenancePlannerModal
        open={maintenance}
        onClose={() => setMaintenance(false)}
        onScheduled={() => void refresh()}
      />
      <StationReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onReportSubmitted={() => {
          void refresh();
          notify.success('Provisional report received', 'Review the incident before confirming the simulated plan.');
        }}
        stationId={stationFocus === 'ALL' ? 'SC' : stationFocus}
        trainOptions={trains.map(train => ({ id: train.id, name: train.name || train.id }))}
      />
    </div>
  );
}
