import { delaysFromSchedule, positionsFromSchedule, stationsForSchedule } from '../lib/feedDerivations';
import { usePreferences } from './WorkspacePreferences';
import { createDemo, detectIssues, scenarioRecommendations, type DemoKind } from '../lib/demoScenarios';
import { changeSchedule } from '../lib/localSchedule';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TrainPosition } from "../components/operations/NetworkMap";
import { getConflictCount, normalizeActiveDelays } from "../lib/apiNormalize";
import type {
  ActiveDelay,
  ConflictsResponse,
  LogEntry,
  Recommendation,
  ScheduleEntry,
  Station,
  Train,
} from "../types/railway";
import {
  createMockTrains,
  MOCK_STATIONS,
  MOCK_TRAINS,
  MOCK_ACTIVE_DELAYS,
  MOCK_CONFLICTS,
  MOCK_RECOMMENDATIONS,
  MOCK_LOGS,
  MOCK_TRACK_STATUS,
  createMockSchedule,
  createMockBaseline,
} from "../lib/mockRailwayData";

export type FeedKey =
  | "schedule"
  | "trains"
  | "stations"
  | "logs"
  | "delays"
  | "positions"
  | "conflicts"
  | "trackStatus"
  | "recommendations";

export interface TrackStatusResponse {
  track_occupancy?: Record<string, unknown>;
  active_movements?: number;
  conflicts_detected?: number;
}

export interface ScheduleResponse {
  schedule: ScheduleEntry[];
  delays_before_min?: number[];
  delays_after_min?: number[];
  reasons?: string[];
  conflicts?: ConflictsResponse["conflicts"];
}

const STALE_MS = 15000;
const FETCH_TIMEOUT_MS = 3500;

export interface ActionSnapshot {
  blockedPlatforms?: string[];
  activeDelays: ActiveDelay[];
  schedule: ScheduleEntry[];
  conflicts: ConflictsResponse;
  recommendations: Recommendation[];
  description: string;
  timestamp: number;
}

export type AutomationLevel = 'advisory' | 'confirm' | 'autonomous';

export interface AnnotationItem {
  id: string;
  targetId: string; // trainId, conflictId, or stationId
  author: string;
  note: string;
  timestamp: string;
}

export interface ClaimInfo {
  controllerName: string;
  timestamp: number;
}

export interface ShelveInfo {
  reason: string;
  expiresAt: number;
}

export interface OperationsFeedState {
  recordEvent: (action: string, details: string) => void;
  acknowledgedConflicts: string[];
  acknowledgeConflict: (id: string) => void;
  blockedPlatforms: string[];
  setPlatformService: (stationId: string, platform: number, closed: boolean) => void;
  loadDemoScenario: (kind: DemoKind) => void;
  trains: Train[];
  schedule: ScheduleEntry[];
  actionBaselineSchedule: ScheduleEntry[];
  baselineSchedule: ScheduleEntry[];
  previousSchedule: ScheduleEntry[];
  stations: Station[];
  logs: LogEntry[];
  activeDelays: ActiveDelay[];
  trainPositions: TrainPosition[];
  conflicts: ConflictsResponse;
  trackStatus: TrackStatusResponse | null;
  recommendations: Recommendation[];
  websocketConnected: boolean;
  loading: boolean;
  initialLoadComplete: boolean;
  lastUpdated: Partial<Record<FeedKey, Date>>;
  isStale: (key: FeedKey) => boolean;
  refreshAll: (silent?: boolean) => Promise<void>;
  refreshSchedule: (silent?: boolean) => Promise<void>;
  setPreviousScheduleFromCurrent: () => void;
  conflictCount: number;
  conflictList: ConflictsResponse["conflicts"];
  isLiveBackend: boolean;
  applyRecommendationLocal: (recId: string) => Promise<boolean>;
  overridePlatformLocal: (
    trainId: string,
    stationId: string,
    platform: number,
  ) => Promise<boolean>;
  clearDelaysLocal: () => Promise<boolean>;
  resetSystemLocal: () => Promise<void>;
  undoLastAction: () => Promise<boolean>;
  lastActionSnapshot: ActionSnapshot | null;
  automationLevel: AutomationLevel;
  setAutomationLevel: (level: AutomationLevel) => void;
  claimedConflicts: Record<string, ClaimInfo>;
  claimConflict: (conflictId: string, controllerName?: string) => void;
  releaseConflict: (conflictId: string) => void;
  annotations: AnnotationItem[];
  addAnnotation: (targetId: string, note: string, author?: string) => void;
  shelvedAlerts: Record<string, ShelveInfo>;
  shelveAlert: (alertId: string, reason: string, durationMinutes?: number) => void;
  unshelveAlert: (alertId: string) => void;
  shiftNotes: string[];
  addShiftNote: (note: string) => void;
  activeDataSource: string;
  importTimetable: (
    newSchedule: ScheduleEntry[],
    newTrains: Train[],
    sourceName?: string,
  ) => void;
}

const OperationsFeedContext = createContext<OperationsFeedState | null>(null);

function getApiBase() {
  return import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
}

async function safeFetchJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;
    return (await res.json()) as T;
  } catch {
    clearTimeout(id);
    return null;
  }
}

export function OperationsFeedProvider({
  children,
  pauseRefresh = false,
}: {
  children: ReactNode;
  pauseRefresh?: boolean;
}) {
  const { operator, role } = usePreferences();
  const [blockedPlatforms, setBlockedPlatforms] = useState<string[]>([]);
  const [acknowledgedConflicts, setAcknowledgedConflicts] = useState<string[]>([]);
  const [trains, setTrains] = useState<Train[]>(MOCK_TRAINS);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(() =>
    createMockSchedule(),
  );
  const [baselineSchedule, setBaselineSchedule] = useState<ScheduleEntry[]>(
    () => createMockBaseline(),
  );
  const [actionBaselineSchedule,setActionBaselineSchedule] = useState<ScheduleEntry[]>([]);
  const [previousSchedule, setPreviousSchedule] = useState<ScheduleEntry[]>([]);
  const [stations, setStations] = useState<Station[]>(MOCK_STATIONS);
  const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOGS);
  const [activeDelays, setActiveDelays] =
    useState<ActiveDelay[]>(MOCK_ACTIVE_DELAYS);
  const [trainPositions, setTrainPositions] = useState<TrainPosition[]>(() =>
    positionsFromSchedule(schedule),
  );
  const [conflicts, setConflicts] = useState<ConflictsResponse>(MOCK_CONFLICTS);
  const [trackStatus, setTrackStatus] = useState<TrackStatusResponse | null>(
    MOCK_TRACK_STATUS,
  );
  const [recommendations, setRecommendations] =
    useState<Recommendation[]>(MOCK_RECOMMENDATIONS);
  const [automationLevel, setAutomationLevel] = useState<AutomationLevel>('confirm');
  const [claimedConflicts, setClaimedConflicts] = useState<Record<string, ClaimInfo>>({});
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([
    {
      id: 'ann-1',
      targetId: 'T104',
      author: 'Desk 4 Controller (Secunderabad)',
      note: 'Signal Point 14-B relay sticky; S&T crew dispatched to SC North Cabin.',
      timestamp: new Date(Date.now() - 10 * 60000).toISOString(),
    },
  ]);
  const [shelvedAlerts, setShelvedAlerts] = useState<Record<string, ShelveInfo>>({});
  const [shiftNotes, setShiftNotes] = useState<string[]>([]);
  const [activeDataSource, setActiveDataSource] = useState<string>('Synthetic corridor (HYB · SC · KCG)');



  const recordEvent = useCallback((action: string, details: string) => {
    setLogs(prev => [{ action, details, actor: operator, timestamp: new Date().toISOString() }, ...prev]);
  }, [operator]);
  const acknowledgeConflict = useCallback((id: string) => {
    if (role === 'viewer') return;
    setAcknowledgedConflicts(prev => [...new Set([...prev,id])]);
    recordEvent('Conflict acknowledged', id);
  }, [recordEvent, role]);
  const claimConflict = useCallback((conflictId: string, controllerName = operator) => {
    if (role === "viewer") return;
    recordEvent("Conflict claimed", conflictId);
    setClaimedConflicts((prev) => ({
      ...prev,
      [conflictId]: { controllerName, timestamp: Date.now() },
    }));
  }, [operator, role, recordEvent]);

  const releaseConflict = useCallback((conflictId: string) => {
    if(role==="viewer") return;
    recordEvent("Conflict released", conflictId);
    setClaimedConflicts((prev) => {
      const next = { ...prev };
      delete next[conflictId];
      return next;
    });
  }, [recordEvent,role]);

  const addAnnotation = useCallback((targetId: string, note: string, author = 'OCC Controller (Desk 4)') => {
    setAnnotations((prev) => [
      {
        id: `ann-${Date.now()}`,
        targetId,
        author,
        note,
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  }, []);

  const shelveAlert = useCallback((alertId: string, reason: string, durationMinutes = 15) => {
    setShelvedAlerts((prev) => ({
      ...prev,
      [alertId]: { reason, expiresAt: Date.now() + durationMinutes * 60000 },
    }));
  }, []);

  const unshelveAlert = useCallback((alertId: string) => {
    setShelvedAlerts((prev) => {
      const next = { ...prev };
      delete next[alertId];
      return next;
    });
  }, []);

  const addShiftNote = useCallback((note: string) => {
    setShiftNotes((prev) => [note, ...prev]);
  }, []);
  const [websocketConnected, setWebsocketConnected] = useState(false);
  const [isLiveBackend, setIsLiveBackend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<
    Partial<Record<FeedKey, Date>>
  >({
    schedule: new Date(),
    trains: new Date(),
    stations: new Date(),
    positions: new Date(),
  });

  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  const wsRef = useRef<WebSocket | null>(null);
  const liveRef = useRef(false);
  const localDatasetRef = useRef(false);
  const generationRef = useRef(0);
  const refreshingRef = useRef(false);

  const markUpdated = useCallback((key: FeedKey) => {
    setLastUpdated((prev) => ({ ...prev, [key]: new Date() }));
  }, []);

  const isStale = useCallback(
    (key: FeedKey) => {
      const ts = lastUpdated[key];
      if (!ts) return true;
      return Date.now() - ts.getTime() > STALE_MS;
    },
    [lastUpdated],
  );

  const refreshAll = useCallback(async (silent = true) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if(!silent) setLoading(true);
    const generation = generationRef.current;
    try {
      if(localDatasetRef.current) {
        setTrainPositions(positionsFromSchedule(scheduleRef.current));markUpdated('positions');return;
      }
      const [next, fleet, stationData, issues, delays, positions, track, recs, logData, baseline] = await Promise.all([
        safeFetchJson<ScheduleResponse>(getApiBase()+'/schedule'),
        safeFetchJson<Train[]>(getApiBase()+'/trains'),
        safeFetchJson<Station[]>(getApiBase()+'/stations'),
        safeFetchJson<ConflictsResponse>(getApiBase()+'/conflicts'),
        safeFetchJson<Parameters<typeof normalizeActiveDelays>[0]>(getApiBase()+'/active-delays'),
        safeFetchJson<TrainPosition[]>(getApiBase()+'/train-positions'),
        safeFetchJson<TrackStatusResponse>(getApiBase()+'/track-status'),
        safeFetchJson<Recommendation[]>(getApiBase()+'/recommendations'),
        safeFetchJson<LogEntry[]>(getApiBase()+'/log'),
        safeFetchJson<ScheduleEntry[]>(getApiBase()+'/baseline'),
      ]);
      if(generation !== generationRef.current) return;
      if(next && Array.isArray(next.schedule) && Array.isArray(fleet) && Array.isArray(stationData) && issues) {
        const changed=JSON.stringify(next.schedule)!==JSON.stringify(scheduleRef.current);
        if(liveRef.current && changed)setPreviousSchedule(scheduleRef.current);
        if(!liveRef.current){setActionBaselineSchedule([]);setLastActionSnapshot(null);}
        scheduleRef.current=next.schedule;setSchedule(next.schedule);setTrains(fleet);
        setStations(stationData.map(st=>({...st,station_name:st.station_name||st.id})));
        setConflicts(issues);setIsLiveBackend(true);liveRef.current=true;
        setActiveDataSource('Connected backend');
        if(Array.isArray(baseline))setBaselineSchedule(baseline);
        if(delays)setActiveDelays(normalizeActiveDelays(delays));
        else setActiveDelays(delaysFromSchedule(next.schedule));
        setRecommendations(Array.isArray(recs)?recs:[]);
        if(Array.isArray(positions)){setTrainPositions(positions);markUpdated('positions');}
        if(track){setTrackStatus(track);markUpdated('trackStatus');}
        if(Array.isArray(logData))setLogs(prev=>[...prev.filter(log=>log.actor),...logData.slice(-50).reverse()].slice(0,200));
        markUpdated('schedule');markUpdated('trains');markUpdated('stations');markUpdated('conflicts');
      } else if(!liveRef.current) {
        setTrainPositions(positionsFromSchedule(scheduleRef.current));markUpdated('positions');
      }
    } finally { refreshingRef.current=false;if(!silent)setLoading(false); }
  },[markUpdated]);
  const refreshSchedule = refreshAll;

  const setPreviousScheduleFromCurrent = useCallback(() => {
    setPreviousSchedule([...scheduleRef.current]);
  }, []);

  const [lastActionSnapshot, setLastActionSnapshot] = useState<ActionSnapshot | null>(null);

  useEffect(() => {
    if (!lastActionSnapshot) return;
    const timeout = setTimeout(() => setLastActionSnapshot(null), Math.max(0, 30000 - (Date.now() - lastActionSnapshot.timestamp)));
    return () => clearTimeout(timeout);
  }, [lastActionSnapshot, operator]);

  const undoLastAction = useCallback(async () => {
    if (!lastActionSnapshot || role === "viewer" || isLiveBackend) return false;
    setBlockedPlatforms(lastActionSnapshot.blockedPlatforms ?? []);
    setActiveDelays(lastActionSnapshot.activeDelays);
    setSchedule(lastActionSnapshot.schedule);
    setConflicts(lastActionSnapshot.conflicts);
    setRecommendations(lastActionSnapshot.recommendations);
    setLogs((prev) => [
      {
        timestamp: new Date().toISOString(),
        actor: operator,
        action: "Action reverted",
        details: `Reverted: ${lastActionSnapshot.description}`,
      },
      ...prev,
    ]);
    setLastActionSnapshot(null);
    return true;
  }, [lastActionSnapshot, operator, role, isLiveBackend]);

  // Local actions for demo / simulation resilience
  const applyRecommendationLocal = useCallback(
    async (recId: string) => {
      if (role === "viewer") throw new Error("Viewer mode is read-only.");
      if (isLiveBackend) throw new Error("Use the backend dispatch action for this feed.");
      const rec = recommendations.find((r) => r.id === recId);
      if (!rec) return false;

      const nextSchedule = changeSchedule(scheduleRef.current, rec, stations);
      const currentIssues = detectIssues(scheduleRef.current, blockedPlatforms);
      const nextIssues = detectIssues(nextSchedule, blockedPlatforms);
      if (nextIssues.some(issue => !currentIssues.some(existing => existing.id === issue.id))) {
        throw new Error('This change creates another platform conflict.');
      }

      setActionBaselineSchedule(prev => prev.length ? prev : [...scheduleRef.current]);
      // Save undo snapshot before applying
      setLastActionSnapshot({
        blockedPlatforms: [...blockedPlatforms],
        activeDelays: [...activeDelays],
        schedule: [...scheduleRef.current],
        conflicts: { ...conflicts },
        recommendations: [...recommendations],
        description: rec.description,
        timestamp: Date.now(),
      });

      const hold = rec.action_type === 'delay_train' ? rec.delay_minutes ?? 0 : 0;
      scheduleRef.current=nextSchedule;
      setSchedule(nextSchedule);
      markUpdated("schedule");
      if (hold) setActiveDelays(prev => {
        const existing = prev.find(d => d.train_id === rec.train_id);
        return [...prev.filter(d => d.train_id !== rec.train_id), {
          train_id: rec.train_id, minutes: (existing?.minutes ?? 0) + hold,
          type: 'Dispatch hold', reason: rec.description,
        }];
      });
      const remaining = nextIssues;
      setRecommendations(scenarioRecommendations(nextSchedule, remaining, blockedPlatforms,stations));
      setConflicts(prev => ({ ...prev, conflicts: remaining, active_conflicts: remaining.length, total_count: remaining.length }));

      // Add log
      setLogs((prev) => [
        {
          timestamp: new Date().toISOString(),
          actor: operator,
          action: "Recommendation applied",
          details: rec.description,
        },
        ...prev,
      ]);

      return true;
    },
    [recommendations, conflicts, activeDelays, stations, isLiveBackend, blockedPlatforms, operator, role],
  );

  const overridePlatformLocal = useCallback(
    async (trainId: string, stationId: string, platform: number) => {
      if (role === "viewer") throw new Error("Viewer mode is read-only.");
      if (isLiveBackend) {
        const response = await safeFetchJson<{ message?: string }>(getApiBase() + '/override', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ train_id: trainId, station_id: stationId, new_platform: platform }),
        });
        if (!response) throw new Error('Platform change was rejected by the backend.');
        await refreshAll(true);
        return true;
      }
      const rec: Recommendation = {
        id: 'manual', action_type: 'change_platform', description: 'Manual override for ' + trainId + ' at ' + stationId + ' to P' + platform,
        train_id: trainId, station_id: stationId, new_platform: platform,
        cost_benefit: { conflicts_resolved: 0, delay_reduction: 0, cost_score: 0 },
        impact: { affected_trains: [trainId], total_delay_change: 0 },
      };
      const nextSchedule = changeSchedule(scheduleRef.current, rec, stations);
      const before = detectIssues(scheduleRef.current, blockedPlatforms);
      const after = detectIssues(nextSchedule, blockedPlatforms);
      if (after.some(issue => !before.some(existing => existing.id === issue.id))) throw new Error('The target platform has an overlapping booking or insufficient headway.');
      setActionBaselineSchedule(prev => prev.length ? prev : [...scheduleRef.current]);
      setLastActionSnapshot({
        schedule: [...scheduleRef.current], conflicts: { ...conflicts }, recommendations: [...recommendations],
        blockedPlatforms: [...blockedPlatforms],
        activeDelays: [...activeDelays], description: rec.description, timestamp: Date.now(),
      });
      scheduleRef.current=nextSchedule;
      setSchedule(nextSchedule);
      markUpdated("schedule");
      setConflicts({ conflicts: after, active_conflicts: after.length, total_count: after.length });
      setRecommendations(scenarioRecommendations(nextSchedule,after,blockedPlatforms,stations));

      setLogs((prev) => [
        {
          timestamp: new Date().toISOString(),
          actor: operator,
          action: "Manual override",
          details: `Train ${trainId} reassigned to Platform ${platform} at ${stationId}`,
        },
        ...prev,
      ]);

      return true;
    },
    [conflicts, recommendations, activeDelays, stations, isLiveBackend, refreshAll, blockedPlatforms, operator, role],
  );

  const clearDelaysLocal = useCallback(async () => {
    if(role === "viewer" || isLiveBackend) throw new Error("This session cannot change the timetable.");
    setLastActionSnapshot(null);
    setActiveDelays([]);
    const nextSchedule = scheduleRef.current.map(entry => ({
      ...entry,
      actual_arrival: entry.scheduled_arrival || entry.actual_arrival,
      actual_departure: entry.scheduled_departure || entry.actual_departure,
      reason: "Delays cleared by controller",
    }));
    const issues = detectIssues(nextSchedule, blockedPlatforms);
    setSchedule(nextSchedule);
    setConflicts({ conflicts: issues, total_count: issues.length, active_conflicts: issues.length });
    setRecommendations(scenarioRecommendations(nextSchedule,issues,blockedPlatforms,stations));
    setLogs((prev) => [
      {
        timestamp: new Date().toISOString(),
        action: "Delays Cleared",
        details: "All active corridor delays reset to normal running time.",
      },
      ...prev,
    ]);
    return true;
  }, [role,isLiveBackend,blockedPlatforms,stations]);

  const resetSystemLocal = useCallback(async () => {
    if(role === "viewer" || isLiveBackend) throw new Error("This session cannot reset the timetable.");
    generationRef.current++;
    localDatasetRef.current=true;
    setStations(MOCK_STATIONS);
    setActiveDataSource("Synthetic corridor (HYB · SC · KCG)");
    setActionBaselineSchedule([]);
    const start = new Date();
    setTrains(createMockTrains(start));
    setSchedule(createMockSchedule(start));
    setBaselineSchedule(createMockBaseline(start));
    setPreviousSchedule([]);
    setLastActionSnapshot(null);
    setBlockedPlatforms([]);
    setAcknowledgedConflicts([]);
    setClaimedConflicts({});
    setShelvedAlerts({});
    setActiveDelays(MOCK_ACTIVE_DELAYS);
    setConflicts(MOCK_CONFLICTS);
    setRecommendations(MOCK_RECOMMENDATIONS);
    setLogs(prev => [
      {
        timestamp: new Date().toISOString(),
        actor:operator,
        action: "System Reset",
        details:
          "Operations console reset to standard Hyderabad corridor baseline timetable.",
      },
      ...prev,
    ]);
  }, [role,isLiveBackend,operator]);

  useEffect(() => {
    const ws = new WebSocket(getApiBase().replace(/^http/,'ws')+'/ws');
    wsRef.current=ws;
    ws.onopen=()=>setWebsocketConnected(true);
    ws.onmessage=()=>{if(!localDatasetRef.current)void refreshAll(true);};
    ws.onclose=()=>setWebsocketConnected(false);
    ws.onerror=()=>setWebsocketConnected(false);
    return()=>{ws.onopen=null;ws.onmessage=null;ws.onclose=null;ws.onerror=null;ws.close();wsRef.current=null;};
  },[refreshAll]);

  // Initial load
  useEffect(() => {
    const load = async () => {
      await refreshAll(false);
      setInitialLoadComplete(true);
    };
    void load();
  }, [refreshAll]);

  // Fallback heartbeat polling ONLY when WebSocket is disconnected
  useEffect(() => {
    if (pauseRefresh || websocketConnected) return;
    const t = setInterval(() => {
      void refreshAll(true);
    }, 15000);
    return () => clearInterval(t);
  }, [pauseRefresh, websocketConnected, refreshAll]);

  const conflictCount = useMemo(() => getConflictCount(conflicts), [conflicts]);
  const conflictList = useMemo(() => {
    if (Array.isArray(conflicts.conflicts)) return conflicts.conflicts;
    if (getConflictCount(conflicts) === 0) return [];
    return (conflicts.conflict_log || []).filter(log => log.type !== "resolved").map((log, i) => ({
      id: `log-${i}`,
      type: log.type || "track_conflict",
      trains_involved: log.trains || [],
      root_cause: log.track ? `Track ${log.track}` : undefined,
      severity: "medium",
    }));
  }, [conflicts]);

  const loadDemoScenario = useCallback((kind: DemoKind) => {
    if (isLiveBackend || role === 'viewer') return;
    generationRef.current++;localDatasetRef.current=true;
    setActionBaselineSchedule([]);setStations(MOCK_STATIONS);setActiveDataSource('Synthetic corridor (HYB · SC · KCG)');
    const demo = createDemo(kind);
    scheduleRef.current=demo.schedule;
    setTrains(demo.trains); setSchedule(demo.schedule); setBaselineSchedule(demo.baseline);
    setPreviousSchedule([]); setActiveDelays(demo.delays); setBlockedPlatforms(demo.blocked);
    setConflicts({ conflicts:demo.issues, active_conflicts:demo.issues.length, total_count:demo.issues.length });
    setRecommendations(demo.recommendations); setClaimedConflicts({}); setAcknowledgedConflicts([]); setLastActionSnapshot(null);
    recordEvent(kind === 'normal' ? 'Normal running restored' : 'Disruption reported', kind === 'signal' ? 'Signal failure at Secunderabad approach' : kind === 'rain' ? 'Heavy rain reported in the corridor' : kind === 'platform' ? 'Secunderabad platform 1 closed' : 'Normal corridor timetable loaded');
    markUpdated('schedule');
  }, [isLiveBackend, role, recordEvent, markUpdated]);

  const importTimetable = useCallback(
    (newSchedule: ScheduleEntry[], newTrains: Train[], sourceName?: string) => {
      if (role === 'viewer' || isLiveBackend) throw new Error('Import is available in editable simulation sessions only.');
      if(newSchedule.some(e=>!Number.isFinite(Date.parse(e.actual_arrival)) || !Number.isFinite(Date.parse(e.actual_departure)) || Date.parse(e.actual_departure)<Date.parse(e.actual_arrival))) throw new Error('Timetable dates are invalid.');
      generationRef.current++;localDatasetRef.current=true;wsRef.current?.close();
      scheduleRef.current=newSchedule;
      const importedStations=stationsForSchedule(newSchedule);setStations(importedStations);
      setBlockedPlatforms([]);setActionBaselineSchedule([]);
      setTrainPositions(positionsFromSchedule(newSchedule));setTrackStatus(null);
      setSchedule(newSchedule);
      setBaselineSchedule(newSchedule.map(e=>({...e,actual_arrival:e.scheduled_arrival||e.actual_arrival,actual_departure:e.scheduled_departure||e.actual_departure})));
      setPreviousSchedule([]);
      setTrains(newTrains);
      const source = sourceName || 'Imported timetable';
      setActiveDataSource(source);

      const issues = detectIssues(newSchedule, []);
      setConflicts({ conflicts: issues, active_conflicts: issues.length, total_count: issues.length });
      setRecommendations(scenarioRecommendations(newSchedule, issues, [],importedStations));

      setActiveDelays(delaysFromSchedule(newSchedule));
      setClaimedConflicts({});
      setAcknowledgedConflicts([]);
      setLastActionSnapshot(null);
      recordEvent('Timetable imported', `Imported ${newSchedule.length} stops for ${newTrains.length} trains from ${source}`);
      markUpdated('schedule');
      markUpdated('trains');
    },
    [role, isLiveBackend, recordEvent, markUpdated],
  );

  const setPlatformService = useCallback((stationId: string, platform: number, closed: boolean) => {
    if (isLiveBackend || role === 'viewer') return;
    if(!Number.isInteger(platform)||platform<1||platform>(stations.find(s=>s.id===stationId)?.platforms||0)) throw new Error('Invalid platform.');
    setLastActionSnapshot(null);
    const key = stationId + '-' + platform;
    const next = closed ? [...new Set([...blockedPlatforms,key])] : blockedPlatforms.filter(p => p !== key);
    const issues = detectIssues(scheduleRef.current,next);
    setBlockedPlatforms(next); setConflicts({ conflicts:issues, active_conflicts:issues.length, total_count:issues.length });
    setRecommendations(scenarioRecommendations(scheduleRef.current,issues,next,stations));
    recordEvent(closed ? 'Platform closed' : 'Platform reopened', stationId + ' platform ' + platform);
  }, [blockedPlatforms, isLiveBackend, role, recordEvent,stations]);

  const value = useMemo<OperationsFeedState>(
    () => ({
      recordEvent, acknowledgedConflicts, acknowledgeConflict, blockedPlatforms, setPlatformService, loadDemoScenario,
      trains,
      schedule,
      actionBaselineSchedule,
      baselineSchedule,
      previousSchedule,
      stations,
      logs,
      activeDelays,
      trainPositions,
      conflicts,
      trackStatus,
      recommendations,
      websocketConnected,
      loading,
      initialLoadComplete,
      lastUpdated,
      isStale,
      refreshAll,
      refreshSchedule,
      setPreviousScheduleFromCurrent,
      conflictCount,
      conflictList,
      isLiveBackend,
      applyRecommendationLocal,
      overridePlatformLocal,
      clearDelaysLocal,
      resetSystemLocal,
      undoLastAction,
      lastActionSnapshot,
      automationLevel,
      setAutomationLevel,
      claimedConflicts,
      claimConflict,
      releaseConflict,
      annotations,
      addAnnotation,
      shelvedAlerts,
      shelveAlert,
      unshelveAlert,
      shiftNotes,
      addShiftNote,
      activeDataSource,
      importTimetable,
    }),
    [
      recordEvent, acknowledgedConflicts, acknowledgeConflict, blockedPlatforms, setPlatformService, loadDemoScenario,
      trains,
      schedule,
      actionBaselineSchedule,
      baselineSchedule,
      previousSchedule,
      stations,
      logs,
      activeDelays,
      trainPositions,
      conflicts,
      trackStatus,
      recommendations,
      websocketConnected,
      loading,
      initialLoadComplete,
      lastUpdated,
      isStale,
      refreshAll,
      refreshSchedule,
      setPreviousScheduleFromCurrent,
      conflictCount,
      conflictList,
      isLiveBackend,
      applyRecommendationLocal,
      overridePlatformLocal,
      clearDelaysLocal,
      resetSystemLocal,
      undoLastAction,
      lastActionSnapshot,
      automationLevel,
      setAutomationLevel,
      claimedConflicts,
      claimConflict,
      releaseConflict,
      annotations,
      addAnnotation,
      shelvedAlerts,
      shelveAlert,
      unshelveAlert,
      shiftNotes,
      addShiftNote,
      activeDataSource,
      importTimetable,
    ],
  );

  return (
    <OperationsFeedContext.Provider value={value}>
      {children}
    </OperationsFeedContext.Provider>
  );
}

export function useOperationsFeed(): OperationsFeedState {
  const ctx = useContext(OperationsFeedContext);
  if (!ctx) {
    return {
      recordEvent: () => {},
      acknowledgedConflicts: [],
      acknowledgeConflict: () => {},
      blockedPlatforms: [],
      setPlatformService: () => {},
      loadDemoScenario: () => {},
      trains: MOCK_TRAINS,
      schedule: [],
      actionBaselineSchedule: [],
      baselineSchedule: [],
      previousSchedule: [],
      stations: MOCK_STATIONS,
      logs: [],
      activeDelays: [],
      trainPositions: [],
      conflicts: { active_conflicts: 0, total_count: 0, conflicts: [] },
      trackStatus: null,
      recommendations: [],
      websocketConnected: false,
      loading: false,
      initialLoadComplete: true,
      lastUpdated: {},
      isStale: () => false,
      refreshAll: async () => {},
      refreshSchedule: async () => {},
      setPreviousScheduleFromCurrent: () => {},
      conflictCount: 0,
      conflictList: [],
      isLiveBackend: false,
      applyRecommendationLocal: async () => false,
      overridePlatformLocal: async () => false,
      clearDelaysLocal: async () => false,
      resetSystemLocal: async () => {},
      undoLastAction: async () => false,
      lastActionSnapshot: null,
      automationLevel: 'confirm',
      setAutomationLevel: () => {},
      claimedConflicts: {},
      claimConflict: () => {},
      releaseConflict: () => {},
      annotations: [],
      addAnnotation: () => {},
      shelvedAlerts: {},
      shelveAlert: () => {},
      unshelveAlert: () => {},
      shiftNotes: [],
      addShiftNote: () => {},
      activeDataSource: 'Synthetic corridor (HYB · SC · KCG)',
      importTimetable: () => {},
    };
  }
  return ctx;
}
