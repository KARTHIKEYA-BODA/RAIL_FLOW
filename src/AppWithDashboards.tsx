import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  CircleHelp,
  Clock3,
  Columns3,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  LayoutDashboard,
  MapPin,
  Maximize2,
  Menu,
  Moon,
  PanelLeftClose,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Sun,
  TrainFront,
  Trophy,
  Volume2,
  VolumeX,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import App, { type AppSection } from './App';
import { ShiftHandoverModal } from './components/operations/ShiftHandoverModal';
import { DecisionSupportModal } from './components/operations/DecisionSupportModal';
import { ImportAnalyseModal } from './components/operations/ImportAnalyseModal';
import { FieldIncidentModal } from './components/operations/FieldIncidentModal';
import { JudgeCheatSheetModal } from './components/operations/JudgeCheatSheetModal';
import { DisruptionInjectorModal } from './components/operations/DisruptionInjectorModal';
import { MaintenancePlannerModal } from './components/operations/MaintenancePlannerModal';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { SkipLink } from './components/layout/SkipLink';
import { useOperationsFeed } from './context/OperationsFeedContext';
import { useSelection } from './context/SelectionContext';
import { usePreferences, useWords, speak, guidedAlert, type Language, type OperatorRole } from './context/WorkspacePreferences';
import { useCommandCenter, playAlertTone } from './hooks/useCommandCenter';
import { notify } from './lib/notify';
import { config } from './config';
import { formatIndianDate, formatTime } from './lib/dateTimeUtils';
import { countdown, stationName } from './lib/corridorStatus';
import './workspace.css';
import './clarity.css';
import './sorvo-rail.css';

const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'));
const SimulationDashboard = lazy(() => import('./components/SimulationDashboard'));
const BenchmarkDashboard = lazy(() => import('./components/operations/BenchmarkDashboard').then(m => ({ default: m.BenchmarkDashboard })));

type View = AppSection | 'analytics' | 'simulation' | 'benchmarks';

const pages = [
  { id: 'overview', title: 'Operations', icon: LayoutDashboard },
  { id: 'map', title: 'Live Map', icon: MapPin },
  { id: 'platforms', title: 'Platforms', icon: Columns3 },
  { id: 'timeline', title: 'Timeline', icon: Clock3 },
  { id: 'schedule', title: 'Schedule', icon: CalendarDays },
  { id: 'conflicts', title: 'Conflicts', icon: ShieldAlert },
  { id: 'sandbox', title: 'What-If Sandbox', icon: Play },
  { id: 'benchmarks', title: 'PS-09 Benchmark', icon: Trophy },
  { id: 'activity', title: 'Activity', icon: Activity },
  { id: 'simulation', title: 'Simulation', icon: Play },
  { id: 'analytics', title: 'Analytics', icon: BarChart3 },
] as const;

function currentView(): View {
  const hash = location.hash.slice(1).split('?')[0];
  return (pages.find((p) => p.id === hash)?.id as View) ?? 'overview';
}

const glossary: Record<string, string> = {
  Headway: 'The time gap between two trains using the same track or platform (minimum 5 minutes).',
  Berth: 'A platform slot reserved for a train.',
  Rake: 'A connected train set.',
  PF: 'Platform.',
  TSR: 'Temporary speed restriction (kinematic delay calculation).',
  Kavach: 'Train protection technology modeled with 5-minute safety headway buffers.',
  Interlock: 'Controls that prevent incompatible routes being set together.',
  Baseline: 'The original schedule used as the comparison point.',
  'Track circuit': 'A track section with electrical train occupancy detection.',
  OCC: 'Operations Control Centre.',
};

export default function AppWithDashboards() {
  const feed = useOperationsFeed();
  const prefs = usePreferences();
  const words = useWords();
  const selection = useSelection();
  const center = useCommandCenter();

  const [view, setView] = useState<View>(currentView);
  const [menu, setMenu] = useState(false);
  const [toolsOpen, setTools] = useState(false);
  const [handover, setHandover] = useState(false);
  const [reset, setReset] = useState(false);
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [fieldIncidentOpen, setFieldIncidentOpen] = useState(false);
  const [disruptionOpen, setDisruptionOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [judgeCheatSheetOpen, setJudgeCheatSheetOpen] = useState(false);
  const [sidebarRail, setSidebarRail] = useState(false);
  const gSequenceRef = useRef(false);
  const gTimerRef = useRef<number | null>(null);
  const [query, setQuery] = useState('');
  const [review, setReview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [now, setNow] = useState(new Date());

  const mobileRef = useRef<HTMLDialogElement>(null);
  const toolsRef = useRef<HTMLDialogElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const paletteRef = useRef<HTMLDialogElement>(null);
  const applyingLock = useRef(false);

  const incident = feed.conflictList?.[0];
  const title = pages.find((p) => p.id === view)?.title || 'Operations';
  const previousAlert = useRef('');

  useEffect(() => {
    const listener = () => setView(currentView());
    window.addEventListener('hashchange', listener);
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.removeEventListener('hashchange', listener);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    document.title = `${title} · TrainVision AI`;
    window.scrollTo(0, 0);
  }, [title]);

  useEffect(() => {
    for (const [open, ref] of [
      [menu, mobileRef],
      [toolsOpen, toolsRef],
      [help, helpRef],
      [palette, paletteRef],
    ] as const) {
      if (open) ref.current?.showModal?.();
      else ref.current?.close?.();
    }
  }, [menu, toolsOpen, help, palette]);

  useEffect(() => {
    const signature = feed.conflictList?.map((c) => c.id).join(',') || '';
    if (signature && signature !== previousAlert.current && previousAlert.current !== '' && prefs.audio) {
      playAlertTone();
      if (prefs.guided && incident) {
        speak(
          guidedAlert(
            prefs.language,
            incident.trains_involved || [],
            incident.platform,
            stationName(incident.station_id)
          ),
          prefs.language
        );
      }
    }
    previousAlert.current = signature;
  }, [feed.conflictList, prefs.audio, prefs.guided, prefs.language, incident]);

  function navigate(page: View) {
    setMenu(false);
    setTools(false);
    setPalette(false);
    location.hash = page;
    setView(page);
  }

  function openReview(id?: string) {
    setReview(id || incident?.id || 'current');
  }

  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      await feed.refreshAll(false);
      notify.info(feed.isLiveBackend ? 'Feed updated' : 'Corridor state verified');
    } finally {
      setBusy(false);
    }
  }

  async function apply(id: string) {
    if (applyingLock.current || prefs.role === 'viewer') return false;
    applyingLock.current = true;
    setApplying(true);
    try {
      if (feed.isLiveBackend) {
        const response = await fetch(
          config.API_BASE_URL + '/apply-recommendation?recommendation_id=' + encodeURIComponent(id),
          { method: 'POST' }
        );
        if (!response.ok) throw Error('The backend rejected this change.');
        await feed.refreshAll(true);
        feed.recordEvent('Recommendation applied', id);
      } else if (!(await feed.applyRecommendationLocal(id))) {
        throw Error('This recommendation is no longer available.');
      }
      return true;
    } catch (error) {
      notify.error(
        'Change could not be applied',
        error instanceof Error ? error.message : 'Refresh and review the incident.'
      );
      return false;
    } finally {
      applyingLock.current = false;
      setApplying(false);
    }
  }

  async function resetBaseline() {
    if (prefs.role === 'viewer') return;
    try {
      if (feed.isLiveBackend) {
        const r = await fetch(config.API_BASE_URL + '/reset', { method: 'POST' });
        if (!r.ok) throw Error();
        await feed.refreshAll(true);
      } else {
        await feed.resetSystemLocal();
      }
      setReset(false);
      notify.success('Baseline restored');
    } catch {
      notify.error('Reset failed');
    }
  }

  function openCenter() {
    setTools(false);
    navigate('overview');
    center.open();
    if (prefs.audio) playAlertTone();
  }

  useEffect(() => {
    function keys(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (
        (e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]') ||
        document.querySelector('dialog[open]')
      ) {
        return;
      }
      if (e.key === '[') {
        e.preventDefault();
        setSidebarRail((prev) => !prev);
        return;
      }
      if (e.key.toLowerCase() === 'g' && !gSequenceRef.current) {
        gSequenceRef.current = true;
        if (gTimerRef.current) window.clearTimeout(gTimerRef.current);
        gTimerRef.current = window.setTimeout(() => {
          gSequenceRef.current = false;
        }, 1500);
        return;
      }
      if (gSequenceRef.current) {
        gSequenceRef.current = false;
        const k = e.key.toLowerCase();
        if (k === 'o') { e.preventDefault(); navigate('overview'); return; }
        if (k === 'm') { e.preventDefault(); navigate('map'); return; }
        if (k === 'p') { e.preventDefault(); navigate('platforms'); return; }
        if (k === 't') { e.preventDefault(); navigate('timeline'); return; }
        if (k === 's') { e.preventDefault(); navigate('schedule'); return; }
        if (k === 'c') { e.preventDefault(); navigate('conflicts'); return; }
        if (k === 'a') { e.preventDefault(); navigate('analytics'); return; }
        if (k === 'b') { e.preventDefault(); navigate('benchmarks'); return; }
      }
      if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
      }
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        void refresh();
      }
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openCenter();
      }
    }
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });

  function navigation(mobile = false) {
    return (
      <>
        <div className="rail-brand">
          <span
            className="rail-logomark flex-shrink-0 cursor-pointer"
            style={{ background: 'linear-gradient(135deg, #ff8c42 0%, #f07a2e 100%)' }}
            title={sidebarRail ? "Expand sidebar ([)" : "TrainVision AI OCC"}
            onClick={() => sidebarRail && setSidebarRail(false)}
          >
            <TrainFront size={20} />
          </span>
          <div className="rail-brand-text min-w-0">
            <strong>TrainVision AI</strong>
            <small>Hyderabad corridor</small>
          </div>
          {!mobile && !sidebarRail && (
            <button
              className="rail-icon collapse-toggle ml-auto"
              style={{ width: '28px', minHeight: '28px', padding: '4px' }}
              title="Collapse sidebar ([)"
              onClick={() => setSidebarRail(true)}
            >
              <PanelLeftClose size={16} />
            </button>
          )}
          {mobile && (
            <button className="rail-icon" aria-label="Close navigation" onClick={() => setMenu(false)}>
              <X />
            </button>
          )}
        </div>

        <div className="rail-navscroll">
          <p className="sorvo-nav-group-title">Corridor Operations</p>
          <nav aria-label="Operations navigation">
            {pages.slice(0, 6).map((p) => (
              <button
                key={p.id}
                aria-current={view === p.id ? 'page' : undefined}
                onClick={() => navigate(p.id)}
                title={p.title}
              >
                <p.icon size={18} />
                <span>{p.title}</span>
                {p.id === 'conflicts' && feed.conflictCount > 0 && (
                  <b className="rail-count" aria-hidden="true">
                    {feed.conflictCount}
                  </b>
                )}
              </button>
            ))}
          </nav>

          <div className="sorvo-nav-divider" />

          <p className="sorvo-nav-group-title">Dispatch &amp; Labs</p>
          <nav aria-label="Dispatch navigation">
            {pages.slice(6).map((p) => (
              <button
                key={p.id}
                aria-current={view === p.id ? 'page' : undefined}
                onClick={() => navigate(p.id)}
                title={p.title}
              >
                <p.icon size={18} />
                <span>{p.title}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={openCenter}
              title="Command Center"
            >
              <Maximize2 size={18} />
              <span>Command center</span>
            </button>
          </nav>
        </div>

        <div className="sorvo-nav-divider" />

        <div className="rail-navbottom">
          <button onClick={() => { setMenu(false); setTools(true); }} title={words.tools}>
            <Settings2 size={18} />
            <span>{words.tools}</span>
          </button>
          <button onClick={() => setJudgeCheatSheetOpen(true)} title="Judge Q&A">
            <HelpCircle size={18} />
            <span>Judge Q&A</span>
          </button>
          <button onClick={() => setHelp(true)} title="Help & glossary">
            <CircleHelp size={18} />
            <span>Help &amp; glossary</span>
          </button>
          <div className="rail-division">
            <div className="sorvo-profile-avatar">
              <span>DC</span>
              <span className="sorvo-online-dot" />
            </div>
            <div>
              <strong>{prefs.operator}</strong>
              <small>
                {prefs.role[0].toUpperCase() + prefs.role.slice(1)} ·{' '}
                {feed.isLiveBackend ? 'Connected feed' : 'Active workspace'}
              </small>
            </div>
          </div>
        </div>
      </>
    );
  }

  const age = Math.max(0, Math.floor((now.getTime() - (feed.lastUpdated.positions?.getTime() || now.getTime())) / 1000));

  return (
    <div className="rail-app">
      <SkipLink />
      <aside className={`rail-sidebar ${sidebarRail ? 'collapsed' : ''}`}>{navigation()}</aside>
      <dialog ref={mobileRef} className="rail-mobile-nav" onCancel={() => setMenu(false)}>
        <div className="mobile-nav-inner">{menu && navigation(true)}</div>
      </dialog>

      <div className={`rail-work ${sidebarRail ? 'sidebar-collapsed' : ''}`}>
        <header className="rail-top sorvo-topbar">
          <div className="rail-breadcrumb sorvo-breadcrumb">
            <button className="rail-icon open-nav" aria-label="Open navigation" onClick={() => setMenu(true)}>
              <Menu />
            </button>
            <span>Hyderabad Corridor</span>
            <span className="sorvo-breadcrumb-slash">/</span>
            <strong className="sorvo-breadcrumb-current">{title}</strong>
          </div>

          <div className="rail-toolbar">
            <button
              className="sorvo-btn-primary"
              onClick={() => setDisruptionOpen(true)}
              title="Inject disruption: late priority train, locomotive failure, signal failure, TSR"
            >
              <Zap size={16} />
              <span>⚡ Disruption</span>
            </button>

            <button
              className="quiet-button"
              onClick={() => setMaintenanceOpen(true)}
              title="Plan hard maintenance block with candidate slot cost curve"
            >
              <Wrench size={16} />
              <span>🔧 Maintenance</span>
            </button>

            <button
              className="quiet-button"
              onClick={() => setImportOpen(true)}
              title="Import and analyse any timetable CSV sheet"
            >
              <FileSpreadsheet size={16} />
              <span>+ Import</span>
            </button>

            <button
              className="quiet-button"
              onClick={() => setFieldIncidentOpen(true)}
              title="Report field observation or calculate TSR-14 speed restriction impact"
            >
              <ShieldAlert size={16} />
              <span>TSR / Field Report</span>
            </button>

            <button
              className="quiet-button search-launch"
              onClick={() => {
                setQuery('');
                setPalette(true);
              }}
            >
              <Search size={17} />
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </button>

            <span className="rail-feed" title={feed.activeDataSource}>
              {feed.isLiveBackend
                ? feed.isStale('schedule')
                  ? 'Feed delayed'
                  : 'Connected feed'
                : feed.activeDataSource.length > 25
                ? feed.activeDataSource.slice(0, 22) + '...'
                : feed.activeDataSource}
            </span>

            <span className="rail-clock">
              {formatIndianDate(now)} <b>{formatTime(now)} IST</b>
            </span>

            <button
              className="quiet-button refresh-button"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
              <span>{busy ? 'Refreshing…' : 'Refresh'}</span>
            </button>

            <button
              className="rail-icon"
              aria-label={prefs.theme === 'day' ? 'Use Night theme' : 'Use Day theme'}
              onClick={() => prefs.setPreference('theme', prefs.theme === 'day' ? 'night' : 'day')}
            >
              {prefs.theme === 'day' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          </div>
        </header>

        {incident && (
          <div className="persistent-alert" role="region" aria-label="Active safety conflict">
            <ShieldAlert size={22} />
            <strong>
              {feed.conflictCount} safety {feed.conflictCount === 1 ? 'conflict' : 'conflicts'}
            </strong>
            <span>
              {stationName(incident.station_id)} · Platform {incident.platform} ·{' '}
              <b>{countdown(incident, feed.schedule, now)}</b>
            </span>
            <button onClick={() => openReview(incident.id)}>
              {words.review} <span aria-hidden="true">→</span>
            </button>
          </div>
        )}

        <main id="main-content" tabIndex={-1} className="rail-main">
          <Suspense fallback={<div className="workspace-panel panel-empty" role="status">Loading workspace…</div>}>
            {view === 'analytics' ? (
              <AnalyticsDashboard />
            ) : view === 'simulation' ? (
              <SimulationDashboard />
            ) : view === 'benchmarks' ? (
              <BenchmarkDashboard />
            ) : (
              <App
                activeSection={view}
                onNavigateSection={navigate}
                onApplyRecommendation={apply}
                applying={applying}
                onReviewConflict={openReview}
                commandCenter={{
                  isOpen: center.isOpen,
                  pauseRefresh: center.pauseRefresh,
                  alertSoundEnabled: prefs.audio,
                  onClose: center.close,
                  onTogglePause: () => center.setPause(!center.pauseRefresh),
                  onToggleAlertSound: () => prefs.setPreference('audio', !prefs.audio),
                }}
              />
            )}
          </Suspense>
        </main>

        <footer className="rail-footer">
          <span>
            <i className="fresh-dot" />
            Positions updated {age}s ago · {feed.schedule.length} scheduled stops across {feed.trains.length} monitored trains · Data: {feed.activeDataSource}
          </span>
          <div className="flex items-center gap-3">
            <button onClick={() => setJudgeCheatSheetOpen(true)}>
              <HelpCircle size={15} />
              Judge Q&amp;A
            </button>
            <button onClick={() => setHelp(true)}>
              <CircleHelp size={16} />
              Help <kbd>?</kbd>
            </button>
          </div>
        </footer>
      </div>

      {/* Tools Dialog */}
      <dialog ref={toolsRef} className="rail-dialog tools-dialog" onCancel={() => setTools(false)} aria-labelledby="tools-title">
        <div className="dialog-head">
          <h2 id="tools-title">Workspace tools</h2>
          <button aria-label="Close tools" onClick={() => setTools(false)}>
            <X />
          </button>
        </div>
        <div className="tools-grid">
          <button className="quiet-button" onClick={() => { setTools(false); setDisruptionOpen(true); }}>
            <Zap size={20} />
            Inject disruption
          </button>
          <button className="quiet-button" onClick={() => { setTools(false); setMaintenanceOpen(true); }}>
            <Wrench size={20} />
            Maintenance planner
          </button>
          <button className="quiet-button" onClick={() => { setTools(false); setImportOpen(true); }}>
            <FileSpreadsheet size={20} />
            Import &amp; Analyse
          </button>
          <button className="quiet-button" onClick={() => { setTools(false); setFieldIncidentOpen(true); }}>
            <ShieldAlert size={20} />
            TSR / Field incident
          </button>
          <button className="quiet-button" onClick={() => { setTools(false); setJudgeCheatSheetOpen(true); }}>
            <HelpCircle size={20} />
            Judge defense Q&amp;A
          </button>
          <button className="quiet-button" onClick={() => { setTools(false); setHandover(true); }}>
            <FileText size={20} />
            Shift handover
          </button>
          <button className="quiet-button" onClick={openCenter}>
            <Maximize2 size={20} />
            Command center wall
          </button>
        </div>

        <fieldset className="preferences">
          <legend>Make the workspace yours</legend>
          <label>
            Display language
            <select value={prefs.language} onChange={(e) => prefs.setPreference('language', e.target.value as Language)}>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="te">తెలుగు</option>
            </select>
          </label>
          <label>
            Operator name
            <input
              value={prefs.operator}
              onChange={(e) => prefs.setPreference('operator', e.target.value)}
              maxLength={60}
            />
          </label>
          <label>
            Demo role
            <select value={prefs.role} onChange={(e) => prefs.setPreference('role', e.target.value as OperatorRole)}>
              <option value="controller">Controller</option>
              <option value="supervisor">Supervisor</option>
              <option value="viewer">Viewer · read-only</option>
            </select>
          </label>
          <p className="muted">Role selection demonstrates access levels; connected deployments require server authentication.</p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={prefs.guided}
              onChange={(e) => prefs.setPreference('guided', e.target.checked)}
            />
            {words.guided}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={prefs.audio}
              onChange={(e) => prefs.setPreference('audio', e.target.checked)}
            />
            {prefs.audio ? <Volume2 size={18} /> : <VolumeX size={18} />}
            Sound &amp; guided alert announcements
          </label>
        </fieldset>

        <button className="quiet-button" disabled={prefs.role === 'viewer'} onClick={() => { setTools(false); setReset(true); }}>
          <RotateCcw size={18} />
          Reset baseline…
        </button>
      </dialog>

      {/* Palette Dialog */}
      <dialog ref={paletteRef} className="rail-dialog" onCancel={() => setPalette(false)} aria-label="Command palette">
        <div className="dialog-head">
          <h2>Quick access</h2>
          <button aria-label="Close search" onClick={() => setPalette(false)}>
            <X />
          </button>
        </div>
        <label className="search-field">
          <Search size={20} />
          <input
            autoFocus
            type="search"
            placeholder={words.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="command-results">
          {pages
            .filter((p) => (p.title + ' ' + p.id).toLowerCase().includes(query.toLowerCase()))
            .map((p) => (
              <button key={p.id} onClick={() => navigate(p.id)}>
                <p.icon size={20} />
                Go to {p.title}
                <span>↵</span>
              </button>
            ))}
          {feed.trains
            .filter((t) => query && t.id.toLowerCase().includes(query.toLowerCase()))
            .map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  navigate('overview');
                  selection.selectTrain(t.id, feed.schedule.find((e) => e.train_id === t.id));
                }}
              >
                <TrainFront size={20} />
                {t.id}
                <span>Open train</span>
              </button>
            ))}
          {query &&
            !pages.some((p) => (p.title + ' ' + p.id).toLowerCase().includes(query.toLowerCase())) &&
            !feed.trains.some((t) => t.id.toLowerCase().includes(query.toLowerCase())) && (
              <p className="panel-empty">No results. Try T104, Platforms or Alerts.</p>
            )}
        </div>
      </dialog>

      {/* Help Dialog */}
      <dialog ref={helpRef} className="rail-dialog" onCancel={() => setHelp(false)} aria-labelledby="help-title">
        <div className="dialog-head">
          <h2 id="help-title">Help &amp; glossary</h2>
          <button aria-label="Close help" onClick={() => setHelp(false)}>
            <X />
          </button>
        </div>
        {[
          ['Quick access', 'Ctrl + K'],
          ['Refresh feed', 'R'],
          ['Command center wall display', 'F'],
          ['Exit wall / dialog', 'Esc'],
          ['Help', '?'],
        ].map(([label, key]) => (
          <p className="shortcut-row" key={key}>
            {label}
            <kbd>{key}</kbd>
          </p>
        ))}
        <h3>Railway terms, in plain language</h3>
        {Object.entries(glossary).map(([term, meaning]) => (
          <details className="glossary-item" key={term}>
            <summary>{term}</summary>
            <p>{meaning}</p>
          </details>
        ))}
      </dialog>

      {feed.lastActionSnapshot && (
        <div className="rail-undo" role="status">
          <FileText size={20} />
          <span>Change applied · {feed.conflictCount} open conflicts</span>
          <button disabled={prefs.role === 'viewer'} onClick={() => void feed.undoLastAction()}>
            <RotateCcw size={16} />
            Undo{' '}
            <small>
              {Math.max(0, Math.ceil((30000 - now.getTime() + feed.lastActionSnapshot.timestamp) / 1000))}s
            </small>
          </button>
        </div>
      )}

      <ConfirmDialog
        open={reset}
        title="Restore the corridor baseline?"
        message="This replaces the current timetable, delays and manual platform changes. Your session history records the reset."
        confirmLabel="Reset baseline"
        variant="warning"
        onConfirm={() => void resetBaseline()}
        onCancel={() => setReset(false)}
      />

      <ShiftHandoverModal open={handover} onClose={() => setHandover(false)} />
      <DecisionSupportModal
        open={review !== null}
        conflictId={review || undefined}
        onClose={() => setReview(null)}
        applying={applying}
        onApplyOption={apply}
      />
      <ImportAnalyseModal open={importOpen} onClose={() => setImportOpen(false)} />
      <FieldIncidentModal open={fieldIncidentOpen} onClose={() => setFieldIncidentOpen(false)} />
      <JudgeCheatSheetModal open={judgeCheatSheetOpen} onClose={() => setJudgeCheatSheetOpen(false)} />
      <DisruptionInjectorModal open={disruptionOpen} onClose={() => setDisruptionOpen(false)} onInjected={() => void feed.refreshAll(true)} />
      <MaintenancePlannerModal open={maintenanceOpen} onClose={() => setMaintenanceOpen(false)} onScheduled={() => void feed.refreshAll(true)} />
    </div>
  );
}
