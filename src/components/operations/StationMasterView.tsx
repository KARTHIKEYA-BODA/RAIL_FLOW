import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShieldAlert,
  Check,
  Plus,
  RotateCcw,
  Send,
} from 'lucide-react';
import {
  fetchStationArrivals,
  resolveIncident,
  applyOverride,
  acceptRecommendation,
  rejectRecommendation,
} from '../../lib/operationsApi';
import type { Incident, StationArrivalsResponse } from '../../types/railway';
import { StationReportSheet } from './StationReportSheet';
import { notify } from '../../lib/notify';

interface StationMasterViewProps {
  stationId?: string;
  onNavigateToSectionView?: () => void;
}

export function StationMasterView({
  stationId = 'SC',
}: StationMasterViewProps) {
  const [data, setData] = useState<StationArrivalsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [delayedOnly, setDelayedOnly] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'arrivals' | 'platforms'>('arrivals');
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false);

  // 10-Second Undo state
  const [undoIncident, setUndoIncident] = useState<Incident | null>(null);
  const [undoSecondsRemaining, setUndoSecondsRemaining] = useState<number>(0);

  // Fetch station arrivals
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res: StationArrivalsResponse = await fetchStationArrivals(stationId, 120);
      setData(res);
      // Select first delayed train if nothing selected
      if (!selectedTrainId && res.arrivals.length > 0) {
        const firstDelayed = res.arrivals.find((a) => a.delay_minutes > 0);
        setSelectedTrainId(firstDelayed ? firstDelayed.train_id : res.arrivals[0].train_id);
      }
    } catch (err: any) {
      notify.error('Station Data Error', err.message || 'Could not load station timetable.');
    } finally {
      setLoading(false);
    }
  }, [stationId, selectedTrainId]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(true), 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Keyboard shortcut: Press "I" to open 10-second report sheet
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setIsReportOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 10-Second Undo Countdown
  useEffect(() => {
    if (undoSecondsRemaining <= 0) {
      setUndoIncident(null);
      return;
    }
    const timer = setInterval(() => {
      setUndoSecondsRemaining((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [undoSecondsRemaining]);

  // Handle report submitted callback
  const handleReportSubmitted = (incident: Incident) => {
    setUndoIncident(incident);
    setUndoSecondsRemaining(10);
    loadData(true);
  };

  // Undo button action
  const handleUndo = async () => {
    if (!undoIncident) return;
    const targetId = undoIncident.id;
    setUndoIncident(null);
    setUndoSecondsRemaining(0);
    try {
      await resolveIncident(targetId, 'Undone by Station Master within 10s window');
      notify.info('Incident Cancelled', `Report ${targetId} was successfully undone.`);
      loadData(true);
    } catch {
      notify.error('Undo Failed', 'Could not revert incident on server.');
    }
  };

  // Resolve incident directly from Today's Incidents list
  const handleResolveIncident = async (incId: string) => {
    try {
      await resolveIncident(incId, 'Cleared by Station Master');
      notify.success('Incident Resolved', `Incident ${incId} cleared. Schedule recomputed.`);
      loadData(true);
    } catch (err: any) {
      notify.error('Resolution Error', err.message);
    }
  };

  // Accept solver platform change
  const handleAcceptFix = async (rec: any) => {
    try {
      if (rec.id.startsWith('REC-SM-')) {
        // Local synthetic recommendation fallback: apply platform override directly
        const targetPlatform = ((selectedArrival?.assigned_platform || 1) % 6) + 1;
        await applyOverride({
          train_id: selectedArrival!.train_id,
          station_id: stationId,
          new_platform: targetPlatform,
          reason: 'Station Master accepted platform change fix',
        });
      } else {
        await acceptRecommendation(rec.id);
      }
      notify.success('Fix Accepted', `${rec.title} committed. CP-SAT schedule recomputed.`);
      loadData(true);
    } catch (err: any) {
      notify.error('Action Failed', err.message);
    }
  };

  // Reject solver recommendation
  const handleRejectFix = async (rec: any) => {
    try {
      if (!rec.id.startsWith('REC-SM-')) {
        await rejectRecommendation(rec.id, 'STATION_MASTER_PREFERENCE');
      }
      notify.info('Fix Rejected', 'Alternative plan calculated by CP-SAT solver.');
      loadData(true);
    } catch (err: any) {
      notify.error('Action Failed', err.message);
    }
  };

  // Send to controller (for section-level holds)
  const handleSendToController = (rec: any) => {
    notify.info('Forwarded to Section Controller', `Dispatched request: "${rec.title}" to Central OCC.`);
  };

  // Filtered arrivals list
  const filteredArrivals = useMemo(() => {
    if (!data?.arrivals) return [];
    if (delayedOnly) {
      return data.arrivals.filter((a) => a.delay_minutes > 0.5);
    }
    return data.arrivals;
  }, [data?.arrivals, delayedOnly]);

  // Currently selected arrival for Detail Card
  const selectedArrival = useMemo(() => {
    if (!data?.arrivals) return null;
    return (
      data.arrivals.find((a) => a.train_id === selectedTrainId) ||
      data.arrivals[0] ||
      null
    );
  }, [data?.arrivals, selectedTrainId]);

  // Platform occupancy status mapping
  const platformsStatus = useMemo(() => {
    const totalPlatforms = data?.platforms_count || 6;
    const blocked = new Set(data?.blocked_platforms || []);
    const result = [];

    for (let p = 1; p <= totalPlatforms; p++) {
      const isBlocked = blocked.has(p);
      const occupyingTrain = (data?.arrivals || []).find((a) => a.assigned_platform === p);
      result.push({
        platformNumber: p,
        isBlocked,
        occupyingTrain,
        status: isBlocked ? 'BLOCKED' : occupyingTrain ? 'OCCUPIED' : 'CLEAR',
      });
    }
    return result;
  }, [data]);

  return (
    <div className="text-[#E2E8F0] font-sans antialiased pb-16 selection:bg-[#f2b84b]/30">
      {/* ================= HERO SECTION (RailFlow Aesthetic) ================= */}
      <section className="px-6 pt-5 pb-5 max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="h-px w-7 bg-gradient-to-r from-[#f2b84b] to-transparent" />
              <span className="eyebrow">
                INTERMODAL STATION CONTROL · 24/7
              </span>
            </div>
            <h1 className="hero-title text-white">
              Every departure, right on time.
            </h1>
            <p className="text-xs sm:text-sm text-white/50 mt-2 max-w-2xl leading-relaxed">
              A living model of Secunderabad Junction. Six platforms feed one protected exit —
              prioritised, signalled and sequenced in real time.
            </p>
          </div>

          {/* Category Legend Pills & Quick Report Button */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="priority-chip">
              <i className="pdot" style={{ background: '#f2b84b', color: '#f2b84b' }} />
              EXPRESS · P1
            </span>
            <span className="priority-chip">
              <i className="pdot" style={{ background: '#93b8ff', color: '#93b8ff' }} />
              COMMUTER · P2
            </span>
            <span className="priority-chip">
              <i className="pdot" style={{ background: '#ff6a5c', color: '#ff6a5c' }} />
              FREIGHT (SYNTHETIC) · P3
            </span>
            <button
              onClick={() => setIsReportOpen(true)}
              className="btn btn-primary"
              title="Report ground truth incident"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Report (I)</span>
            </button>
          </div>
        </div>

        {/* Safety Incident Alert Banner */}
        {data?.safety_alert && (
          <div className="mt-4 p-3.5 rounded-xl bg-red-950/80 border border-red-500/80 text-white flex items-center gap-3 backdrop-blur-md animate-in fade-in duration-300">
            <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0 animate-bounce" />
            <div className="text-xs font-semibold">
              <strong className="text-red-300">CRITICAL SAFETY ALERT:</strong> {data.safety_alert}
            </div>
          </div>
        )}
      </section>

      {/* ================= MAIN CONSOLE WORKSPACE ================= */}
      <main className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-6 mt-2">
        {/* LEFT COLUMN: Arrivals Table & Platform Occupancy (7 Cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Card Container */}
          <div className="hud-card p-5">
            {/* Header with Tabs & Delayed Filter */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('arrivals')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'arrivals'
                      ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold shadow-sm'
                      : 'bg-white/5 text-white/70 hover:text-white border border-white/10'
                  }`}
                >
                  Arriving in the next 2 h
                </button>
                <button
                  onClick={() => setActiveTab('platforms')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'platforms'
                      ? 'bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold shadow-sm'
                      : 'bg-white/5 text-white/70 hover:text-white border border-white/10'
                  }`}
                >
                  Platform Occupancy (P1–P6)
                </button>
              </div>

              {/* Delayed Only Toggle */}
              {activeTab === 'arrivals' && (
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-white/60 hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    checked={delayedOnly}
                    onChange={(e) => setDelayedOnly(e.target.checked)}
                    className="rounded bg-black/40 border-white/20 text-[#f2b84b] focus:ring-[#f2b84b]"
                  />
                  <span>Delayed only</span>
                </label>
              )}
            </div>

            {/* TAB 1: Arrivals Table */}
            {activeTab === 'arrivals' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-mono uppercase tracking-wider text-white/50">
                      <th className="py-2.5 px-3">Train</th>
                      <th className="py-2.5 px-3">Sched</th>
                      <th className="py-2.5 px-3">Expected</th>
                      <th className="py-2.5 px-3">Delay</th>
                      <th className="py-2.5 px-3">Cause</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {loading && filteredArrivals.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-white/40">
                          Loading Secunderabad timetable...
                        </td>
                      </tr>
                    ) : filteredArrivals.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-[#8E95A5]">
                          No trains matching the filter.
                        </td>
                      </tr>
                    ) : (
                      filteredArrivals.map((t) => {
                        const isSelected = selectedTrainId === t.train_id;
                        const isDelayed = t.delay_minutes > 0.5;

                        return (
                          <tr
                            key={`arr-${t.train_id}`}
                            onClick={() => setSelectedTrainId(t.train_id)}
                            className={`cursor-pointer transition-colors group ${
                              isSelected
                                ? 'bg-[#f2b84b]/10 border-l-2 border-l-[#f2b84b]'
                                : 'hover:bg-white/[0.04]'
                            }`}
                          >
                            {/* Train ID + Name */}
                            <td className="py-3 px-3">
                              <div className="font-mono font-bold text-white group-hover:text-[#f2b84b] transition-colors flex items-center gap-1.5">
                                <span>{t.train_id}</span>
                                {t.is_synthetic && (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950/60 text-amber-400 border border-amber-800/40">
                                    Synthetic
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-white/50 truncate max-w-[150px]">
                                {t.train_name} · PF {t.assigned_platform}
                              </div>
                            </td>

                            {/* Scheduled Arrival */}
                            <td className="py-3 px-3 font-mono text-white/60">
                              {t.scheduled_arrival}
                            </td>

                            {/* Expected Arrival */}
                            <td className="py-3 px-3 font-mono font-semibold text-white">
                              {t.expected_arrival}
                            </td>

                            {/* Delay */}
                            <td className="py-3 px-3">
                              {isDelayed ? (
                                <span className="font-mono font-bold text-[#f2b84b]">
                                  +{t.delay_minutes.toFixed(0)} min
                                </span>
                              ) : (
                                <span className="font-mono text-[#55e0a3]">
                                  on time
                                </span>
                              )}
                            </td>

                            {/* Cause Chip */}
                            <td className="py-3 px-3">
                              {t.cause_source === 'reported' ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-purple-950/60 text-purple-300 border border-purple-800/50">
                                  Reported
                                </span>
                              ) : t.cause_source === 'inferred' ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-[#f2b84b]/20 text-[#f2b84b] border border-[#f2b84b]/40">
                                  Inferred
                                </span>
                              ) : isDelayed ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-white/5 text-white/60 border border-white/10">
                                  Unknown
                                </span>
                              ) : (
                                <span className="text-[10px] text-white/30 font-mono">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 2: Platform Occupancy (P1 - P6) */}
            {activeTab === 'platforms' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
                {platformsStatus.map((pf) => (
                  <div
                    key={`pf-status-${pf.platformNumber}`}
                    className={`p-3.5 rounded-xl border transition-all ${
                      pf.isBlocked
                        ? 'bg-red-950/40 border-red-500/40 text-white'
                        : pf.occupyingTrain
                        ? 'bg-white/[0.04] border-white/10 text-white'
                        : 'bg-white/[0.02] border-white/5 text-white/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-bold text-xs text-white">
                        PLATFORM {pf.platformNumber}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                          pf.isBlocked
                            ? 'bg-red-900/40 text-red-300 border-red-800/60'
                            : pf.occupyingTrain
                            ? 'bg-[#f2b84b]/15 text-[#f2b84b] border-[#f2b84b]/40'
                            : 'bg-emerald-950/40 text-emerald-300 border-emerald-800/40'
                        }`}
                      >
                        {pf.status}
                      </span>
                    </div>

                    {pf.occupyingTrain ? (
                      <div className="text-xs">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <span>{pf.occupyingTrain.train_id}</span>
                          <span className="text-white/50 font-normal font-mono">
                            ({pf.occupyingTrain.category})
                          </span>
                        </div>
                        <div className="text-[11px] text-white/50 mt-0.5">
                          Arr {pf.occupyingTrain.expected_arrival} · Dep {pf.occupyingTrain.expected_departure}
                        </div>
                      </div>
                    ) : pf.isBlocked ? (
                      <div className="text-xs text-red-200">
                        Out of service due to active report. Hard constraint applied.
                      </div>
                    ) : (
                      <div className="text-xs text-white/40">
                        Berth clear for incoming rake.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ================= TODAY'S INCIDENTS STRIP ================= */}
          <div className="hud-card p-4">
            <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                  Today's Incidents ({data?.active_incidents?.length || 0})
                </span>
                <span className="text-[10px] text-white/40">· Ground truth feed</span>
              </div>
              <button
                onClick={() => setIsReportOpen(true)}
                className="text-[11px] text-[#f2b84b] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
              >
                <span>+ Report incident</span>
              </button>
            </div>

            <div className="space-y-2">
              {!data?.active_incidents || data.active_incidents.length === 0 ? (
                <div className="py-3 text-center text-xs text-white/40">
                  No open incidents reported at {data?.station_name || stationId}.
                </div>
              ) : (
                data.active_incidents.map((inc) => (
                  <div
                    key={`inc-${inc.id}`}
                    className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono text-white/50 text-[11px] flex-shrink-0">
                        {inc.started_at}
                      </span>
                      <span className="font-bold text-white capitalize flex-shrink-0">
                        {inc.type.replace('_', ' ')}
                      </span>
                      <span className="text-white/20">·</span>
                      <span className="text-white/60 truncate text-[11px]">
                        {inc.note || `Est ${inc.est_duration_min} min`}
                      </span>
                    </div>

                    <button
                      onClick={() => handleResolveIncident(inc.id)}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] text-white/80 hover:text-white font-medium border border-white/15 flex-shrink-0 transition-colors"
                    >
                      Resolve
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Detail Card (Why late & Fix) (5 Cols) */}
        <div className="lg:col-span-5">
          <div className="hud-card p-5 sticky top-20">
            {selectedArrival ? (
              <div className="space-y-5">
                {/* Selected Train Header */}
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-white font-mono">
                        {selectedArrival.train_id} {selectedArrival.category}
                      </h2>
                      {selectedArrival.delay_minutes > 0.5 ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-[#f2b84b]/20 text-[#f2b84b] border border-[#f2b84b]/40">
                          +{selectedArrival.delay_minutes.toFixed(0)} min
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                          On time
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/50 mt-0.5">
                      Platform {selectedArrival.assigned_platform} · Sched {selectedArrival.scheduled_arrival} → Exp {selectedArrival.expected_arrival}
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] font-mono text-white/50 block">SOLVER STATUS</span>
                    <span className="text-xs font-bold text-[#55e0a3] font-mono">FEASIBLE (0 Cfl)</span>
                  </div>
                </div>

                {/* WHY LATE Block */}
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-white/50 mb-2 font-bold flex items-center justify-between">
                    <span>WHY LATE</span>
                    {selectedArrival.cause_source && (
                      <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-white/5 text-white/70 border border-white/10">
                        Layer: {selectedArrival.cause_source.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs leading-relaxed text-white/80">
                    {selectedArrival.cause_text}
                  </div>
                </div>

                {/* FIX Recommendation Block */}
                {selectedArrival.recommendation ? (
                  <div className="p-4 rounded-xl bg-white/[0.04] border border-[#f2b84b]/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold tracking-wider text-[#f2b84b] uppercase">
                        FIX · OPTIMAL LEVER
                      </span>
                      <span className="text-xs font-bold text-white font-mono">
                        {selectedArrival.recommendation.savings_text}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-white">
                      {selectedArrival.recommendation.title}
                    </div>

                    {selectedArrival.recommendation.reason && (
                      <div className="text-xs text-white/50">
                        {selectedArrival.recommendation.reason}
                      </div>
                    )}

                    {/* Action Levers */}
                    <div className="pt-2 flex items-center gap-2">
                      {selectedArrival.recommendation.can_station_master_accept ? (
                        <>
                          <button
                            onClick={() => handleAcceptFix(selectedArrival.recommendation)}
                            className="flex-1 py-2 rounded-xl bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] font-bold text-xs shadow-md shadow-[#f2b84b]/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            <span>Accept</span>
                          </button>
                          <button
                            onClick={() => handleRejectFix(selectedArrival.recommendation)}
                            className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-xs border border-white/15 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <span>Reject</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleSendToController(selectedArrival.recommendation)}
                          className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-xs border border-white/15 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5 text-[#f2b84b]" />
                          <span>Send to controller</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 text-center text-xs text-white/50">
                    No conflict on nominal schedule slot. Train proceeds as scheduled.
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-white/50">
                Select a train from the arrivals list to view cause attribution and recommended fix.
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ================= 10-SECOND UNDO FLOATING BANNER ================= */}
      {undoIncident && undoSecondsRemaining > 0 && (
        <div className="fixed bottom-6 right-6 z-40 max-w-md w-full bg-[#16181d]/95 backdrop-blur-md border border-[#f2b84b] rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom duration-300">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#f2b84b] animate-ping" />
              <span className="text-xs font-bold text-white">
                Incident Logged ({undoIncident.id})
              </span>
            </div>
            <button
              onClick={handleUndo}
              className="px-3 py-1 rounded-lg bg-gradient-to-b from-[#f2c56d] to-[#dfa83f] text-[#1c1710] text-xs font-bold hover:brightness-105 transition-colors flex items-center gap-1 shadow-md shadow-[#f2b84b]/20 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Undo ({undoSecondsRemaining}s)</span>
            </button>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-[#242835] h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-[#F5B041] h-full transition-all duration-1000 ease-linear"
              style={{ width: `${(undoSecondsRemaining / 10) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* ================= 10-SECOND REPORT SHEET ================= */}
      <StationReportSheet
        open={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        stationId={stationId}
        stationName={data?.station_name || 'Secunderabad Jn'}
        defaultTrainId={selectedArrival?.train_id}
        availableTrains={data?.arrivals || []}
        platformsCount={data?.platforms_count || 6}
        onReportSubmitted={handleReportSubmitted}
      />
    </div>
  );
}
