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
  getSimulatedTrainPositions,
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

const POLL_MS = 5000;
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
  const [previousSchedule, setPreviousSchedule] = useState<ScheduleEntry[]>([]);
  const [stations, setStations] = useState<Station[]>(MOCK_STATIONS);
  const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOGS);
  const [activeDelays, setActiveDelays] =
    useState<ActiveDelay[]>(MOCK_ACTIVE_DELAYS);
  const [trainPositions, setTrainPositions] = useState<TrainPosition[]>(() =>
    getSimulatedTrainPositions(),
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
    recordEvent("Conflict released", conflictId);
    setClaimedConflicts((prev) => {
      const next = { ...prev };
      delete next[conflictId];
      return next;
    });
  }, [recordEvent]);

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

  const fetchTrains = useCallback(async () => {
    const data = await safeFetchJson<Train[]>(`${getApiBase()}/trains`);
    if (data && Array.isArray(data) && data.length > 0) {
      setTrains(data);
      setIsLiveBackend(true);
      markUpdated("trains");
    }
  }, [markUpdated]);

  const fetchStations = useCallback(async () => {
    const data = await safeFetchJson<Station[]>(`${getApiBase()}/stations`);
    if (data && Array.isArray(data) && data.length > 0) {
      const mapped: Station[] = data.map((s) => ({
        id: s.id,
        platforms: s.platforms,
        station_code: s.id,
        station_name: s.station_name || s.id,
        latitude: s.latitude,
        longitude: s.longitude,
        is_junction: s.is_junction ?? false,
      }));
      setStations(mapped);
      setIsLiveBackend(true);
      markUpdated("stations");
    }
  }, [markUpdated]);

  const fetchSchedule = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await safeFetchJson<ScheduleResponse>(
          `${getApiBase()}/schedule`,
        );
        if (data && Array.isArray(data.schedule) && data.schedule.length > 0) {
          const current = scheduleRef.current;
          const nextSchedule = data.schedule;
          if (
            current.length > 0 &&
            JSON.stringify(current) !== JSON.stringify(nextSchedule)
          ) {
            setPreviousSchedule([...current]);
          }
          setSchedule([...nextSchedule]);
          setIsLiveBackend(true);
          markUpdated("schedule");

          if (baselineSchedule.length === 0) {
            const baselineData = await safeFetchJson<ScheduleEntry[]>(
              `${getApiBase()}/baseline`,
            );
            if (baselineData && Array.isArray(baselineData)) {
              setBaselineSchedule([...baselineData]);
            }
          }
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [baselineSchedule.length, markUpdated],
  );

  const fetchLogs = useCallback(async () => {
    const data = await safeFetchJson<LogEntry[]>(`${getApiBase()}/log`);
    if (data && Array.isArray(data)) {
      setLogs([...data.slice(-50).reverse()]);
      setIsLiveBackend(true);
      markUpdated("logs");
    }
  }, [markUpdated]);

  const fetchDelays = useCallback(async () => {
    const data = await safeFetchJson<unknown>(`${getApiBase()}/active-delays`);
    if (data) {
      setActiveDelays(normalizeActiveDelays(data as any));
      setIsLiveBackend(true);
      markUpdated("delays");
    }
  }, [markUpdated]);

  const fetchPositions = useCallback(async () => {
    const data = await safeFetchJson<TrainPosition[]>(
      `${getApiBase()}/train-positions`,
    );
    if (data && Array.isArray(data) && data.length > 0) {
      setTrainPositions(data);
      setIsLiveBackend(true);
      markUpdated("positions");
    } else {
      // Advance simulated train movement tick
      setTrainPositions(getSimulatedTrainPositions());
      markUpdated("positions");
    }
  }, [markUpdated]);

  const fetchConflicts = useCallback(async () => {
    const data = await safeFetchJson<ConflictsResponse>(
      `${getApiBase()}/conflicts`,
    );
    if (data) {
      setConflicts(data);
      setIsLiveBackend(true);
      markUpdated("conflicts");
    }
  }, [markUpdated]);

  const fetchTrackStatus = useCallback(async () => {
    const data = await safeFetchJson<TrackStatusResponse>(
      `${getApiBase()}/track-status`,
    );
    if (data) {
      setTrackStatus(data);
      setIsLiveBackend(true);
      markUpdated("trackStatus");
    }
  }, [markUpdated]);

  const fetchRecommendations = useCallback(async () => {
    const data = await safeFetchJson<Recommendation[]>(
      `${getApiBase()}/recommendations`,
    );
    if (data && Array.isArray(data)) {
      setRecommendations(data);
      setIsLiveBackend(true);
      markUpdated("recommendations");
    }
  }, [markUpdated]);

  const refreshAll = useCallback(
    async (silent = true) => {
      setPreviousSchedule([...scheduleRef.current]);
      await Promise.all([
        fetchSchedule(silent),
        fetchTrains(),
        fetchStations(),
        fetchLogs(),
        fetchDelays(),
        fetchPositions(),
        fetchConflicts(),
        fetchTrackStatus(),
        fetchRecommendations(),
      ]);
    },
    [
      fetchSchedule,
      fetchTrains,
      fetchStations,
      fetchLogs,
      fetchDelays,
      fetchPositions,
      fetchConflicts,
      fetchTrackStatus,
      fetchRecommendations,
    ],
  );

  const refreshSchedule = useCallback(
    async (silent = true) => {
      await fetchSchedule(silent);
    },
    [fetchSchedule],
  );

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
    if (!lastActionSnapshot) return false;
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
  }, [lastActionSnapshot, operator]);

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
      setSchedule(nextSchedule);
      if (hold) setActiveDelays(prev => {
        const existing = prev.find(d => d.train_id === rec.train_id);
        return [...prev.filter(d => d.train_id !== rec.train_id), {
          train_id: rec.train_id, minutes: (existing?.minutes ?? 0) + hold,
          type: 'Dispatch hold', reason: rec.description,
        }];
      });
      const remaining = nextIssues;
      setRecommendations(scenarioRecommendations(nextSchedule, remaining, blockedPlatforms));
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
      setLastActionSnapshot({
        schedule: [...scheduleRef.current], conflicts: { ...conflicts }, recommendations: [...recommendations],
        blockedPlatforms: [...blockedPlatforms],
        activeDelays: [...activeDelays], description: rec.description, timestamp: Date.now(),
      });
      setSchedule(nextSchedule);
      setConflicts({ conflicts: after, active_conflicts: after.length, total_count: after.length });
      setRecommendations(prev => prev.filter(r => after.some(c => c.station_id === r.station_id && c.trains_involved?.includes(r.train_id))));

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
    setRecommendations([]);
    setLogs((prev) => [
      {
        timestamp: new Date().toISOString(),
        action: "Delays Cleared",
        details: "All active corridor delays reset to normal running time.",
      },
      ...prev,
    ]);
    return true;
  }, []);

  const resetSystemLocal = useCallback(async () => {
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
    setLogs([
      {
        timestamp: new Date().toISOString(),
        action: "System Reset",
        details:
          "Operations console reset to standard Hyderabad corridor baseline timetable.",
      },
      ...MOCK_LOGS,
    ]);
  }, []);

  // Real-time WebSocket connection attempt
  useEffect(() => {
    let unmounted = false;
    const connect = () => {
      if (unmounted) return;
      try {
        const wsUrl = `${getApiBase().replace(/^http/, "ws")}/ws`;
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          setWebsocketConnected(true);
          setIsLiveBackend(true);
          wsRef.current = ws;
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "train_positions") {
              setTrainPositions(data.data);
              markUpdated("positions");
            } else if (data.type === "schedule_update") {
              void fetchSchedule(true);
              void fetchConflicts();
              void fetchLogs();
            }
          } catch {
            /* ignore */
          }
        };
        ws.onclose = () => {
          setWebsocketConnected(false);
          wsRef.current = null;
        };
        ws.onerror = () => {
          setWebsocketConnected(false);
        };
      } catch {
        setWebsocketConnected(false);
      }
    };

    connect();
    return () => {
      unmounted = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [fetchConflicts, fetchLogs, fetchSchedule, markUpdated]);

  // Initial load
  useEffect(() => {
    const load = async () => {
      await refreshAll(false);
      setInitialLoadComplete(true);
    };
    void load();
  }, [refreshAll]);

  // Periodic polling & simulated position movement
  useEffect(() => {
    if (pauseRefresh) return;
    const t = setInterval(() => {
      void refreshAll(true);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pauseRefresh, refreshAll]);

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
    const demo = createDemo(kind);
    setTrains(demo.trains); setSchedule(demo.schedule); setBaselineSchedule(demo.baseline);
    setPreviousSchedule([]); setActiveDelays(demo.delays); setBlockedPlatforms(demo.blocked);
    setConflicts({ conflicts:demo.issues, active_conflicts:demo.issues.length, total_count:demo.issues.length });
    setRecommendations(demo.recommendations); setClaimedConflicts({}); setAcknowledgedConflicts([]); setLastActionSnapshot(null);
    recordEvent(kind === 'normal' ? 'Normal running restored' : 'Disruption reported', kind === 'signal' ? 'Signal failure at Secunderabad approach' : kind === 'rain' ? 'Heavy rain reported in the corridor' : kind === 'platform' ? 'Secunderabad platform 1 closed' : 'Normal corridor timetable loaded');
    markUpdated('schedule');
  }, [isLiveBackend, role, recordEvent, markUpdated]);

  const importTimetable = useCallback(
    (newSchedule: ScheduleEntry[], newTrains: Train[], sourceName?: string) => {
      if (role === 'viewer') return;
      setSchedule(newSchedule);
      setBaselineSchedule(newSchedule);
      setPreviousSchedule([]);
      setTrains(newTrains);
      const source = sourceName || 'Imported timetable';
      setActiveDataSource(source);

      const issues = detectIssues(newSchedule, blockedPlatforms);
      setConflicts({ conflicts: issues, active_conflicts: issues.length, total_count: issues.length });
      setRecommendations(scenarioRecommendations(newSchedule, issues, blockedPlatforms));

      const delays: ActiveDelay[] = [];
      newSchedule.forEach((entry) => {
        const sch = Date.parse(entry.scheduled_departure || entry.scheduled_arrival || '');
        const act = Date.parse(entry.actual_departure || entry.actual_arrival || '');
        if (!isNaN(sch) && !isNaN(act) && act > sch + 60000) {
          const delayMin = Math.round((act - sch) / 60000);
          delays.push({
            train_id: entry.train_id,
            type: 'operational',
            minutes: delayMin,
            reason: entry.reason || 'Imported delay',
          });
        }
      });
      setActiveDelays(delays);
      setClaimedConflicts({});
      setAcknowledgedConflicts([]);
      setLastActionSnapshot(null);
      recordEvent('Timetable imported', `Imported ${newSchedule.length} stops for ${newTrains.length} trains from ${source}`);
      markUpdated('schedule');
      markUpdated('trains');
    },
    [role, blockedPlatforms, recordEvent, markUpdated],
  );

  const setPlatformService = useCallback((stationId: string, platform: number, closed: boolean) => {
    if (isLiveBackend || role === 'viewer') return;
    const key = stationId + '-' + platform;
    const next = closed ? [...new Set([...blockedPlatforms,key])] : blockedPlatforms.filter(p => p !== key);
    const issues = detectIssues(scheduleRef.current,next);
    setBlockedPlatforms(next); setConflicts({ conflicts:issues, active_conflicts:issues.length, total_count:issues.length });
    setRecommendations(scenarioRecommendations(scheduleRef.current,issues,next));
    recordEvent(closed ? 'Platform closed' : 'Platform reopened', stationId + ' platform ' + platform);
  }, [blockedPlatforms, isLiveBackend, role, recordEvent]);

  const value = useMemo<OperationsFeedState>(
    () => ({
      recordEvent, acknowledgedConflicts, acknowledgeConflict, blockedPlatforms, setPlatformService, loadDemoScenario,
      trains,
      schedule,
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
