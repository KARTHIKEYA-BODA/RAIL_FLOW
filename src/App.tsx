import { useEffect, useMemo, useState, useRef } from "react";
import { notify } from './lib/notify';
import { useDashboardShell } from './context/DashboardShellContext';
import { useOperationsFeed } from './context/OperationsFeedContext';
import { useSelection } from './context/SelectionContext';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { AlertQueue } from './components/operations/AlertQueue';
import { PlatformBoard } from './components/operations/PlatformBoard';
import { TrackOccupancyPanel } from './components/operations/TrackOccupancyPanel';
import { ScheduleTable } from './components/operations/ScheduleTable';
import { TrainDetailDrawer } from './components/operations/TrainDetailDrawer';
import { CorridorOverview } from './components/operations/CorridorOverview';
import { OperationsPanel } from './components/operations/OperationsPanel';
import { ActivityPanel } from './components/operations/ActivityPanel';
import { ScheduleTimelinePanel } from './components/operations/ScheduleTimelinePanel';
import { OverrideModal } from './components/operations/OverrideModal';
import { CommandCenterView } from './components/operations/CommandCenterView';
import { SectionCard } from './components/layout/SectionCard';
import { LiveRegion } from './components/layout/LiveRegion';
import { computeScheduleKPIs } from './lib/scheduleUtils';



import { DecisionSupportModal } from './components/operations/DecisionSupportModal';
import { WhatIfSandbox } from './components/operations/WhatIfSandbox';
import { LiveCorridorMap } from './components/operations/LiveCorridorMap';
import { playAlertTone } from './hooks/useCommandCenter';
import type { Recommendation, ScheduleEntry } from './types/railway';

export type AppSection = 'overview' | 'map' | 'platforms' | 'schedule' | 'timeline' | 'conflicts' | 'activity' | 'sandbox';

interface AppProps {
  onReviewConflict?: (id?: string) => void;
  commandCenter?: {
    isOpen: boolean;
    pauseRefresh: boolean;
    alertSoundEnabled: boolean;
    onClose: () => void;
    onTogglePause: () => void;
    onToggleAlertSound: () => void;
  };
  recommendations?: Recommendation[];
  onApplyRecommendation?: (id: string) => Promise<boolean> | void;
  applying?: boolean;
  activeSection?: AppSection;
  onNavigateSection?: (section: AppSection) => void;
}

export default function App({
  commandCenter,
  onReviewConflict,
  recommendations: recommendationsProp,
  onApplyRecommendation,
  applying,
  activeSection = 'overview',
  onNavigateSection,
}: AppProps = {}) {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

  const {
    trains,
    schedule,
    baselineSchedule,
    previousSchedule,
    logs,
    stations,
    activeDelays,
    trainPositions,
    trackStatus,
    recommendations: feedRecommendations,
    websocketConnected,
    loading: feedLoading,
    initialLoadComplete,
    lastUpdated,
    isStale,
    refreshAll,
    conflictCount,
    conflictList,
    clearDelaysLocal,
    overridePlatformLocal,
    resetSystemLocal,
    undoLastAction,
    lastActionSnapshot,
    isLiveBackend,
  } = useOperationsFeed();

  const recommendations = recommendationsProp ?? feedRecommendations;

  const { selectedTrainId, selectedEntry, selectTrain, selectEntry, clearSelection } =
    useSelection();

  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [decisionConflictId, setDecisionConflictId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [overridePlatform, setOverridePlatform] = useState<number>(1);
  const [overrideMsg, setOverrideMsg] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [overrideEntry, setOverrideEntry] = useState<ScheduleEntry | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [nowClock, setNowClock] = useState(new Date());
  const [animTick, setAnimTick] = useState(0);
  const [showClearDelaysConfirm, setShowClearDelaysConfirm] = useState(false);

  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  const lastSync = lastUpdated.schedule ?? null;
  const loading = feedLoading || actionLoading;

  const { updateStatus, registerActions, unregisterActions } = useDashboardShell();

  const conflictTrainIds = useMemo(() => {
    const ids = new Set<string>();
    (conflictList ?? []).forEach((c) => (c.trains_involved || []).forEach((t) => ids.add(t)));
    return ids;
  }, [conflictList]);

  const handleTrainSelect = (trainId: string) => {
    const entry = schedule.find((s) => s.train_id === trainId);
    if (entry) selectEntry(entry);
    else selectTrain(trainId);
  };

  const getTrain = (id: string) => trains.find((t) => t.id === id);

  async function clearAllDelays() {
    if (activeDelays.length === 0) {
      notify.info('No active delays to clear');
      return;
    }
    setShowClearDelaysConfirm(true);
  }

  async function performClearDelays() {
    setActionLoading(true);
    try {
      const response = await fetch(`${API_BASE}/clear-delays`, { method: "DELETE" });
      if (response.ok) {
        await refreshAll(true);
        notify.success('All delays cleared');
      } else {
        if (isLiveBackend) throw new Error("The backend rejected this action.");
        await clearDelaysLocal();
        notify.success('All delays cleared');
      }
    } catch {
      if (isLiveBackend) notify.error('Delays could not be cleared');
      else { await clearDelaysLocal(); notify.success('All delays cleared'); }
    } finally {
      setActionLoading(false);
      setShowClearDelaysConfirm(false);
    }
  }

  async function resetSystem() {
    setActionLoading(true);
    try {
      const response = await fetch(`${API_BASE}/reset`, { method: "POST" });
      if (response.ok) {
        await refreshAll(true);
        notify.success('System reset', 'Baseline schedule restored and overrides cleared.');
      } else {
        await resetSystemLocal();
        notify.success('System reset', 'Baseline schedule restored and overrides cleared.');
      }
    } catch {
      await resetSystemLocal();
      notify.success('System reset', 'Baseline schedule restored and overrides cleared.');
    } finally {
      setActionLoading(false);
    }
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setNowClock(new Date());
      setAnimTick((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const kpis = useMemo(
    () => computeScheduleKPIs(schedule, trains),
    [schedule, trains]
  );

  const systemHealth = useMemo(() => {
    if (conflictCount > 0) return 'CONFLICTS';
    if (activeDelays.length > 0 || kpis.ontimePct < 85) return 'DELAYS';
    return 'OPTIMAL';
  }, [conflictCount, activeDelays.length, kpis.ontimePct]);

  const prevConflictCount = useRef(conflictCount);

  useEffect(() => {
    if (!initialLoadComplete) return;
    updateStatus({
      systemHealth,
      lastSync,
      websocketConnected,
      trainCount: kpis.total,
      onTimePct: kpis.ontimePct,
    });
  }, [
    systemHealth,
    lastSync,
    websocketConnected,
    kpis.total,
    kpis.ontimePct,
    initialLoadComplete,
    updateStatus,
  ]);

  useEffect(() => {
    if (conflictCount > prevConflictCount.current && conflictCount > 0) {
      setLiveAnnouncement(`${conflictCount} active conflicts detected`);
      if (commandCenter?.alertSoundEnabled) playAlertTone();
    }
    prevConflictCount.current = conflictCount;
  }, [conflictCount, commandCenter?.alertSoundEnabled]);

  useEffect(() => {
    registerActions({
      refreshAll: async () => {
        setActionLoading(true);
        await refreshAll(false);
        setAnimTick((prev) => prev + 1);
        setActionLoading(false);
      },
      resetSystem: async () => {
        await resetSystem();
      },
      openAuditLogs: () => {
        onNavigateSection?.('activity');
      },
      openWorkspaceTab: (tab) => {
        if (tab === 'schedule' || tab === 'timeline' || tab === 'activity') {
          onNavigateSection?.(tab);
        }
      },
    });
    return () => unregisterActions();
  }, [registerActions, unregisterActions, refreshAll]);

  const beforeEntries = useMemo(() => {
    if (baselineSchedule.length > 0) return baselineSchedule;
    if (previousSchedule.length > 0) return previousSchedule;
    return trains.map((t) => ({
      train_id: t.id,
      station_id: t.origin || '',
      assigned_platform: t.platform_pref || 1,
      actual_arrival: t.scheduled_arrival || new Date().toISOString(),
      actual_departure: t.scheduled_departure || t.scheduled_arrival || new Date().toISOString(),
      reason: 'initial schedule',
    }));
  }, [baselineSchedule, previousSchedule, trains]);

  const afterEntries = schedule.length > 0 ? schedule : beforeEntries;

  function openOverride(trainId: string, entry?: ScheduleEntry) {
    const target = entry ?? selectedEntry ?? schedule.find(e => e.train_id === trainId);
    if (!target) return;
    setOverrideEntry(target);
    setOverridePlatform(target.assigned_platform);
    setOverrideMsg("");
    setShowModal(true);
    clearSelection();
  }

  async function submitOverride() {
    if (!overrideEntry || actionLoading) return;
    setActionLoading(true);
    setOverrideMsg("");
    try {
      await overridePlatformLocal(overrideEntry.train_id, overrideEntry.station_id, overridePlatform);
      setShowModal(false);
      notify.success('Platform updated', overrideEntry.train_id + ' at ' + overrideEntry.station_id + ' moved to P' + overridePlatform);
    } catch (error) {
      setOverrideMsg(error instanceof Error ? error.message : 'The platform change could not be applied.');
    } finally {
      setActionLoading(false);
    }
  }

  const review = (id?: string) => { if (onReviewConflict) onReviewConflict(id); else { setDecisionConflictId(id ?? null); setShowDecisionModal(true); } };

  return (
    <>
      <LiveRegion message={liveAnnouncement} />

      {commandCenter?.isOpen && (
        <CommandCenterView
          now={nowClock}
          systemHealth={systemHealth}
          websocketConnected={websocketConnected}
          pauseRefresh={commandCenter.pauseRefresh}
          alertSoundEnabled={commandCenter.alertSoundEnabled}
          stations={stations}
          schedule={schedule}
          trains={trains}
          trainPositions={trainPositions}
          animTick={animTick}
          conflictCount={conflictCount}
          conflicts={conflictList ?? []}
          activeDelays={activeDelays}
          onTimePct={Number(kpis.ontimePct) || 0}
          recommendations={recommendations}
          logs={logs}
          onClose={commandCenter.onClose}
          onTogglePause={commandCenter.onTogglePause}
          onToggleAlertSound={commandCenter.onToggleAlertSound}
          onApplyRecommendation={onApplyRecommendation}
        />
      )}

      {/* Main Content Area Based on activeSection */}
      <div className="text-slate-100">
                {/* VIEW 0: DEDICATED LIVE CORRIDOR OCC RADAR */}
        {activeSection === 'map' && (
          <div className="space-y-4">
            <LiveCorridorMap
              onReviewConflict={review}
              onNavigate={(section) => onNavigateSection?.(section)}
            />
          </div>
        )}

        {/* VIEW 1: DEDICATED PLATFORMS VIEW */}
        {activeSection === 'platforms' && (
          <div className="space-y-4">
            <PlatformBoard
              stations={stations}
              schedule={schedule}
              trains={trains}
              now={nowClock}
              conflicts={conflictList ?? []}
              onSelectTrain={(_trainId, entry) => selectEntry(entry)}
              onReviewConflict={review}
              fullWidth={true}
            />
          </div>
        )}

        {/* VIEW 2: DEDICATED TIMETABLE / SCHEDULE VIEW */}
        {activeSection === 'schedule' && (
          <div className="space-y-4">
            <SectionCard title="Corridor timetable" subtitle="Search trains and inspect their scheduled stops.">
              <ScheduleTable
                schedule={schedule}
                trains={trains}
                loading={false}
                conflictTrainIds={conflictTrainIds}
                now={nowClock}
                onOverride={openOverride}
                onRowClick={selectEntry}
              />
            </SectionCard>
          </div>
        )}

        {/* VIEW 3: DEDICATED TIMELINE / GANTT VIEW */}
        {activeSection === 'timeline' && (
          <div className="space-y-4">

              <ScheduleTimelinePanel
                beforeEntries={beforeEntries}
                afterEntries={afterEntries}
                stations={stations}
                trains={trains}
                conflicts={conflictList ?? []}
                trainPositions={trainPositions}
                now={nowClock}
                animTick={animTick}
                onEntryClick={selectEntry}
              />
          </div>
        )}

        {/* VIEW 4: DEDICATED CONFLICT RESOLUTION VIEW */}
        {activeSection === 'conflicts' && (
          <div className="space-y-4">
            <SectionCard title="Conflict queue" subtitle="Review platform conflicts, compare changes and track active delays.">
              <AlertQueue
                conflicts={conflictList ?? []}
                activeDelays={activeDelays}
                recommendations={recommendations}
                onSelectTrain={handleTrainSelect}
                onOpenDecisionSupport={review}
                onApplyFix={(id) => onApplyRecommendation?.(id)}
                onUndo={() => void undoLastAction()}
                canUndo={Boolean(lastActionSnapshot)}
              />
            </SectionCard>
          </div>
        )}

        {/* VIEW 5: DEDICATED ACTIVITY AUDIT LOG VIEW */}
        {activeSection === 'activity' && (
          <div className="space-y-4">
            <SectionCard title="Activity log" subtitle="Dispatch changes and controller actions, newest first.">
              <ActivityPanel logs={logs} />
            </SectionCard>
          </div>
        )}

        {/* VIEW 5B: WHAT-IF SANDBOX & TRAINING SIMULATOR */}
        {activeSection === 'sandbox' && (
          <div className="space-y-4">
            <WhatIfSandbox />
          </div>
        )}

        {activeSection === 'overview' && <CorridorOverview now={nowClock} tick={animTick} onTrain={handleTrainSelect}
          onNavigate={section => onNavigateSection?.(section)} onReview={review}
          controls={<>
            <TrackOccupancyPanel trackStatus={trackStatus} isStale={isLiveBackend && isStale('trackStatus')}/>
            <OperationsPanel activeDelayCount={activeDelays.length} selectedTrainId={selectedTrainId}
              onManualOverride={() => { if (selectedTrainId) void openOverride(selectedTrainId); else onNavigateSection?.('schedule'); }}
              onClearDelays={clearAllDelays}/>
          </>}/>}
      </div>

      <TrainDetailDrawer
        entry={selectedEntry}
        train={selectedEntry ? getTrain(selectedEntry.train_id) ?? null : null}
        onClose={clearSelection}
        onOverride={(trainId) => {
          clearSelection();
          void openOverride(trainId);
        }}
      />

      <OverrideModal
        open={showModal}
        trainId={overrideEntry?.train_id ?? null}
        platform={overridePlatform}
        maxPlatform={stations.find(s => s.id === overrideEntry?.station_id)?.platforms}
        stationId={overrideEntry?.station_id}
        message={overrideMsg}
        delayImpact={null}
        loading={loading}
        onPlatformChange={setOverridePlatform}
        onClose={() => setShowModal(false)}
        onSubmit={() => void submitOverride()}
      />

      <ConfirmDialog
        open={showClearDelaysConfirm}
        title="Clear all active delays?"
        message={`This will clear ${activeDelays.length} active delay${activeDelays.length === 1 ? '' : 's'} from the system.`}
        confirmLabel="Clear delays"
        variant="warning"
        onConfirm={() => void performClearDelays()}
        onCancel={() => setShowClearDelaysConfirm(false)}
      />

      <DecisionSupportModal
        open={showDecisionModal}
        onClose={() => setShowDecisionModal(false)}
        conflictId={decisionConflictId || undefined}
        applying={applying}
        onApplyOption={id => onApplyRecommendation?.(id)}
      />
    </>
  );
}
