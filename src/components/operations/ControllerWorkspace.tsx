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
import { StationReportSheet } from './StationReportSheet';
import { notify } from '../../lib/notify';
import './controller.css';

type Decision = {
  id: string;
  train_id: string;
  station_id: string;
  one_line_reason: string;
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
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setReportOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  const decision = snapshot?.recommendations.find((r) => r.status === 'PENDING') ?? null;

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
          'Simulation updated.'
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
          <button onClick={() => setMaintenance(true)}>
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
            Sim Live
          </span>
          <div className="clock-box hidden md:flex">
            <div className="clock-time font-mono">{liveClock}</div>
          </div>
          <button
            className="controller-primary"
            style={{ minHeight: '34px', padding: '0 12px', fontSize: '11px' }}
            onClick={() => setReportOpen(true)}
            title="Press I to report ground truth incident"
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
          <StationMasterView onNavigateToSectionView={() => setPage('control')} />
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
              </div>
              <div className="controller-actions">
                <button className="controller-secondary" onClick={() => void refresh()}>
                  <RefreshCw size={14} /> Refresh
                </button>
                <button
                  className="controller-primary"
                  disabled={!snapshot}
                  onClick={() => setDisruption(true)}
                >
                  <AlertTriangle size={15} /> Report disruption
                </button>
              </div>
            </div>

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
                        <span className="controller-tag">SIMULATED</span>
                      </div>
                    </div>

                    {viewMode === 'timetable' ? (
                      <MareyChart
                        schedule={snapshot?.schedule ?? []}
                        previousSchedule={snapshot?.previous ?? []}
                        trains={trains}
                        stations={stations}
                        conflicts={[]}
                        activeMaintenance={blocks}
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

                    {stationFocus !== 'ALL' &&
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
                    {decision ? (
                      <>
                        <span className="controller-tag">HOLD · {decision.station_id}</span>
                        <h2>{decision.one_line_reason}</h2>
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
                        <h2>{snapshot ? 'No pending decision' : 'Waiting for the backend'}</h2>
                        <p>
                          {snapshot
                            ? 'Report a disruption to calculate a new plan.'
                            : 'Start the backend to load the simulated timetable.'}
                        </p>
                      </>
                    )}
                  </aside>
                </div>

                {/* ══════════════ KPI METRICS ══════════════ */}
                <section className="controller-kpis" aria-label="Plan metrics">
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
                </section>
              </>
            ) : (
              <section className="controller-panel controller-proof">
                <h2>Simulation benchmark</h2>
                {benchmark?.status === 'current' && benchmark.scenarios ? (
                  <>
                    <p>
                      {benchmark.trains_per_instance} trains · seeds{' '}
                      {benchmark.seeds_evaluated?.join(', ')} · generated {benchmark.timestamp}.
                      Values are scenario averages; lower weighted delay is better.
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
                                  {scenario.averages[policy].weighted_delay_min.toFixed(1)} min
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
        RAILFLOW Decision Support Prototype · Intermodal Control &amp; CP-SAT Section Optimizer
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
          notify.success('Incident Logged', 'CP-SAT re-plan computed in < 5s.');
        }}
        stationId={stationFocus === 'ALL' ? 'SC' : stationFocus}
      />
    </div>
  );
}
