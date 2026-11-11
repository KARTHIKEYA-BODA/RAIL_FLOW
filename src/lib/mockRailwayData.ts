import { findPlatformConflicts } from './localSchedule';
import type {
  ActiveDelay,
  ConflictsResponse,
  LogEntry,
  Recommendation,
  ScheduleEntry,
  Station,
  Train,
} from '../types/railway';
import type { TrainPosition } from '../components/operations/NetworkMap';
import type { TrackStatusResponse } from '../context/OperationsFeedContext';

export const MOCK_STATIONS: Station[] = [
  {
    id: 'HYB',
    platforms: 4,
    station_code: 'HYB',
    station_name: 'Hyderabad Deccan',
    latitude: 17.385,
    longitude: 78.4867,
    is_junction: true,
  },
  {
    id: 'SC',
    platforms: 6,
    station_code: 'SC',
    station_name: 'Secunderabad Junction',
    latitude: 17.4399,
    longitude: 78.5017,
    is_junction: true,
  },
  {
    id: 'KCG',
    platforms: 3,
    station_code: 'KCG',
    station_name: 'Kacheguda',
    latitude: 17.3753,
    longitude: 78.4983,
    is_junction: true,
  },
];

export function createMockTrains(baseTime: Date = new Date()): Train[] {
  const formatOffset = (minuteOffset: number) => {
    const d = new Date(baseTime.getTime() + minuteOffset * 60000);
    return d.toISOString();
  };

  return [
    {
      id: 'T101',
      type: 'Express',
      priority: 8,
      origin: 'HYB',
      destination: 'SC',
      scheduled_arrival: formatOffset(-20),
      scheduled_departure: formatOffset(-5),
      platform_pref: 1,
    },
    {
      id: 'T102',
      type: 'Local',
      priority: 5,
      origin: 'SC',
      destination: 'KCG',
      scheduled_arrival: formatOffset(-10),
      scheduled_departure: formatOffset(5),
      platform_pref: 1,
    },
    {
      id: 'T103',
      type: 'Passenger',
      priority: 6,
      origin: 'KCG',
      destination: 'HYB',
      scheduled_arrival: formatOffset(-15),
      scheduled_departure: formatOffset(-2),
      platform_pref: 1,
    },
    {
      id: 'T104',
      type: 'Express',
      priority: 9,
      origin: 'HYB',
      destination: 'KCG',
      // Scheduled arrival at SC is 0 offset (actual is +12m offset -> +12m delay)
      scheduled_arrival: formatOffset(0),
      scheduled_departure: formatOffset(20),
      platform_pref: 1,
    },
    {
      id: 'T105',
      type: 'Freight',
      priority: 2,
      origin: 'SC',
      destination: 'HYB',
      scheduled_arrival: formatOffset(-5),
      scheduled_departure: formatOffset(6),
      platform_pref: 2,
    },
    {
      id: 'T106',
      type: 'Passenger',
      priority: 4,
      origin: 'HYB',
      destination: 'SC',
      scheduled_arrival: formatOffset(5),
      scheduled_departure: formatOffset(20),
      platform_pref: 1,
    },
    {
      id: 'T107',
      type: 'Express',
      priority: 7,
      origin: 'HYB',
      destination: 'SC',
      // Scheduled arrival at SC is +29m offset (actual is +35m offset -> +6m delay)
      scheduled_arrival: formatOffset(29),
      scheduled_departure: formatOffset(44),
      platform_pref: 2,
    },
    {
      id: 'T108',
      type: 'Local',
      priority: 3,
      origin: 'SC',
      destination: 'HYB',
      scheduled_arrival: formatOffset(15),
      scheduled_departure: formatOffset(28),
      platform_pref: 1,
    },
    {
      id: 'T109',
      type: 'Intercity',
      priority: 6,
      origin: 'KCG',
      destination: 'SC',
      scheduled_arrival: formatOffset(25),
      scheduled_departure: formatOffset(40),
      platform_pref: 1,
    },
    {
      id: 'T110',
      type: 'Express',
      priority: 8,
      origin: 'KCG',
      destination: 'HYB',
      scheduled_arrival: formatOffset(14),
      scheduled_departure: formatOffset(26),
      platform_pref: 1,
    },
    {
      id: 'T111',
      type: 'Passenger',
      priority: 5,
      origin: 'HYB',
      destination: 'SC',
      scheduled_arrival: formatOffset(20),
      scheduled_departure: formatOffset(35),
      platform_pref: 2,
    },
    {
      id: 'T112',
      type: 'Freight',
      priority: 1,
      origin: 'SC',
      destination: 'KCG',
      scheduled_arrival: formatOffset(28),
      scheduled_departure: formatOffset(55),
      platform_pref: 3,
    },
    {
      id: 'T113',
      type: 'Express',
      priority: 9,
      origin: 'HYB',
      destination: 'SC',
      scheduled_arrival: formatOffset(30),
      scheduled_departure: formatOffset(45),
      platform_pref: 1,
    },
    {
      id: 'T114',
      type: 'Local',
      priority: 4,
      origin: 'KCG',
      destination: 'SC',
      scheduled_arrival: formatOffset(35),
      scheduled_departure: formatOffset(50),
      platform_pref: 2,
    },
    {
      id: 'T115',
      type: 'Intercity',
      priority: 7,
      origin: 'SC',
      destination: 'HYB',
      scheduled_arrival: formatOffset(40),
      scheduled_departure: formatOffset(55),
      platform_pref: 1,
    },
  ];
}

export const MOCK_TRAINS: Train[] = createMockTrains();

// Helper to format ISO strings offset from a base time
export function createMockSchedule(baseTime: Date = new Date()): ScheduleEntry[] {
  const formatOffset = (minuteOffset: number) => {
    const d = new Date(baseTime.getTime() + minuteOffset * 60000);
    return d.toISOString();
  };

  return [
    {
      train_id: 'T101',
      station_id: 'HYB',
      assigned_platform: 1,
      actual_arrival: formatOffset(-20),
      actual_departure: formatOffset(-5),
      reason: 'On-schedule dispatch',
    },
    {
      train_id: 'T101',
      station_id: 'SC',
      assigned_platform: 2,
      actual_arrival: formatOffset(10),
      actual_departure: formatOffset(25),
      reason: 'Optimal slot allocation',
    },
    {
      train_id: 'T102',
      station_id: 'SC',
      assigned_platform: 1,
      actual_arrival: formatOffset(-10),
      actual_departure: formatOffset(5),
      reason: 'Regular commuter service',
    },
    {
      train_id: 'T102',
      station_id: 'KCG',
      assigned_platform: 1,
      actual_arrival: formatOffset(20),
      actual_departure: formatOffset(35),
      reason: 'Standard transit',
    },
    {
      train_id: 'T103',
      station_id: 'KCG',
      assigned_platform: 2,
      actual_arrival: formatOffset(-15),
      actual_departure: formatOffset(-2),
      reason: 'Dispatched on time',
    },
    {
      train_id: 'T103',
      station_id: 'HYB',
      assigned_platform: 2,
      actual_arrival: formatOffset(18),
      actual_departure: formatOffset(30),
      reason: 'Platform clear',
    },
    {
      train_id: 'T104',
      station_id: 'HYB',
      assigned_platform: 2,
      actual_arrival: formatOffset(-25),
      actual_departure: formatOffset(-10),
      reason: 'Departed HYB',
    },
    {
      train_id: 'T104',
      station_id: 'SC',
      assigned_platform: 1,
      actual_arrival: formatOffset(12),
      actual_departure: formatOffset(32),
      reason: 'Delayed (+12m) by signal inspection at SC outer',
    },
    {
      train_id: 'T104',
      station_id: 'KCG',
      assigned_platform: 2,
      actual_arrival: formatOffset(45),
      actual_departure: formatOffset(60),
      reason: 'Propagation delay applied',
    },
    {
      train_id: 'T105',
      station_id: 'SC',
      assigned_platform: 3,
      actual_arrival: formatOffset(-5),
      actual_departure: formatOffset(6),
      reason: 'Freight loop holding',
    },
    {
      train_id: 'T106',
      station_id: 'HYB',
      assigned_platform: 1,
      actual_arrival: formatOffset(5),
      actual_departure: formatOffset(20),
      reason: 'Boarding underway',
    },
    {
      train_id: 'T107',
      station_id: 'HYB',
      assigned_platform: 3,
      actual_arrival: formatOffset(8),
      actual_departure: formatOffset(22),
      reason: 'Scheduled departure',
    },
    {
      train_id: 'T107',
      station_id: 'SC',
      assigned_platform: 1,
      actual_arrival: formatOffset(35),
      actual_departure: formatOffset(50),
      reason: 'Insufficient headway after T104',
    },
    {
      train_id: 'T108',
      station_id: 'SC',
      assigned_platform: 4,
      actual_arrival: formatOffset(15),
      actual_departure: formatOffset(28),
      reason: 'Local commuter slot',
    },
    {
      train_id: 'T109',
      station_id: 'KCG',
      assigned_platform: 2,
      actual_arrival: formatOffset(25),
      actual_departure: formatOffset(40),
      reason: 'Intercity rake ready',
    },
    {
      train_id: 'T110',
      station_id: 'KCG',
      assigned_platform: 3,
      actual_arrival: formatOffset(14),
      actual_departure: formatOffset(26),
      reason: 'Express turn-around',
    },
    {
      train_id: 'T113',
      station_id: 'HYB',
      assigned_platform: 4,
      actual_arrival: formatOffset(30),
      actual_departure: formatOffset(45),
      reason: 'Vande Bharat priority rake',
    },
    { train_id: 'T111', station_id: 'HYB', assigned_platform: 1, actual_arrival: formatOffset(27), actual_departure: formatOffset(37), reason: 'Passenger service' },
    { train_id: 'T112', station_id: 'SC', assigned_platform: 5, actual_arrival: formatOffset(28), actual_departure: formatOffset(55), reason: 'Freight service' },
    { train_id: 'T114', station_id: 'KCG', assigned_platform: 3, actual_arrival: formatOffset(35), actual_departure: formatOffset(50), reason: 'Local service' },
    { train_id: 'T115', station_id: 'SC', assigned_platform: 6, actual_arrival: formatOffset(40), actual_departure: formatOffset(55), reason: 'Intercity service' },
  ].map(entry => {
    const delay = entry.train_id === 'T104' && entry.station_id !== 'HYB' ? 12 : entry.train_id === 'T107' && entry.station_id === 'SC' ? 6 : 0;
    return { ...entry,
      scheduled_arrival: new Date(Date.parse(entry.actual_arrival) - delay * 60000).toISOString(),
      scheduled_departure: new Date(Date.parse(entry.actual_departure) - delay * 60000).toISOString(),
    };
  });
}

export function createMockBaseline(baseTime: Date = new Date()): ScheduleEntry[] {
  return createMockSchedule(baseTime).map((entry) => ({
    ...entry,
    actual_arrival: entry.scheduled_arrival || entry.actual_arrival,
    actual_departure: entry.scheduled_departure || entry.actual_departure,
    reason: 'Published master timetable',
  }));
}

export const MOCK_ACTIVE_DELAYS: ActiveDelay[] = [
  {
    train_id: 'T104',
    type: 'Signal',
    minutes: 12,
    reason: 'Signal point 14-B interlock delay at Secunderabad North Cabin',
  },
  {
    train_id: 'T107',
    type: 'Congestion',
    minutes: 6,
    reason: 'Platform headway buffer adjustment',
  },
];

export const MOCK_CONFLICTS: ConflictsResponse = {
  active_conflicts: 1,
  total_count: 1,
  conflicts: [
    {
      id: 'conf-104-107',
      type: 'platform_clash',
      station_id: 'SC',
      platform: 1,
      trains_involved: ['T104', 'T107'],
      root_cause: 'T107 is scheduled to arrive three minutes after T104 leaves Secunderabad platform 1. The corridor simulation requires a five-minute gap.',
      severity: 'critical',
      description: 'Platform occupancy conflict between T104 and T107 at SC Platform 1',
    },
  ],
  conflict_log: [
    {
      type: 'platform_clash',
      track: 'SC-P1',
      trains: ['T104', 'T107'],
      timestamp: new Date(Date.now() - 120000).toISOString(),
    },
  ],
  impact: {
    by_severity: { critical: 1, high: 0, medium: 0, low: 0 },
    by_type: { platform_clash: 1 },
  },
};

export const MOCK_RECOMMENDATIONS: Recommendation[] = [
  {
    id: 'rec-reassign-p3',
    action_type: 'platform_reassignment',
    description: 'Reassign T104 (Express) to Platform 3 at Secunderabad (SC)',
    train_id: 'T104',
    station_id: 'SC',
    new_platform: 3,
    delay_minutes: 0,
    cost_benefit: {
      delay_reduction: 14,
      conflicts_resolved: 1,
      cost_score: 92,
    },
    impact: {
      affected_trains: ['T104', 'T107'],
      total_delay_change: -14,
    },
  },
  {
    id: 'rec-hold-t107',
    action_type: 'delay_train',
    description: 'Hold T107 for two minutes before Secunderabad platform 1',
    train_id: 'T107',
    station_id: 'SC',
    delay_minutes: 2,
    cost_benefit: { delay_reduction: 0, conflicts_resolved: 1, cost_score: 78 },
    impact: { affected_trains: ['T107'], total_delay_change: 2 },
  },
];

export const MOCK_LOGS: LogEntry[] = [
  {
    timestamp: new Date(Date.now() - 30000).toISOString(),
    action: 'Recommendation ready',
    details: 'Platform reassignment available for T104 at Secunderabad P3.',
  },
  {
    timestamp: new Date(Date.now() - 90000).toISOString(),
    action: 'Conflict Detected',
    details: 'Platform clash predicted at Secunderabad (SC) P1 between T104 and T107.',
  },
  {
    timestamp: new Date(Date.now() - 150000).toISOString(),
    action: 'Delay reported',
    details: 'T104 reported +12 min signal interlock delay at Secunderabad outer cabin.',
  },
  {
    timestamp: new Date(Date.now() - 240000).toISOString(),
    action: 'Station Dispatch',
    details: 'T101 departed Hyderabad Deccan (HYB) Platform 1 on green signal.',
  },
  {
    timestamp: new Date(Date.now() - 360000).toISOString(),
    action: 'System Sync',
    details: 'Hyderabad corridor simulation loaded.',
  },
];

export const MOCK_TRACK_STATUS: TrackStatusResponse = {
  track_occupancy: {
    'HYB-SC-1': { trains: ['T101'], status: 'occupied' },
    'HYB-SC-2': { trains: [], status: 'clear' },
    'SC-KCG-1': { trains: ['T104'], status: 'occupied' },
    'HYB-KCG-1': { trains: [], status: 'clear' },
    'HYB-KCG-2': { trains: ['T103'], status: 'occupied' },
  },
  active_movements: 4,
  conflicts_detected: 1,
};

// Simulated dynamic train positions with smooth interpolation
let simulatedTick = 0;
export function getSimulatedTrainPositions(): TrainPosition[] {
  simulatedTick = (simulatedTick + 1) % 100;
  const p1 = (0.2 + simulatedTick * 0.015) % 1.0;
  const p2 = (0.55 + simulatedTick * 0.012) % 1.0;
  const p3 = (0.1 + simulatedTick * 0.008) % 1.0;
  const p4 = (0.75 + simulatedTick * 0.01) % 1.0;

  return [
    {
      train_id: 'T101',
      from_station: 'HYB',
      to_station: 'SC',
      current_position: 'HYB→SC',
      progress: Math.min(1.0, Math.max(0.0, p1)),
      status: 'moving',
      delay_minutes: 0,
    },
    {
      train_id: 'T104',
      from_station: 'SC',
      to_station: 'KCG',
      current_position: 'SC→KCG',
      progress: Math.min(1.0, Math.max(0.0, p2)),
      status: 'moving',
      delay_minutes: 12,
    },
    {
      train_id: 'T107',
      from_station: 'HYB',
      to_station: 'SC',
      current_position: 'HYB',
      progress: 0.0,
      status: 'waiting',
      delay_minutes: 6,
    },
    {
      train_id: 'T103',
      from_station: 'KCG',
      to_station: 'HYB',
      current_position: 'KCG→HYB',
      progress: Math.min(1.0, Math.max(0.0, p3)),
      status: 'moving',
      delay_minutes: 0,
    },
    {
      train_id: 'T110',
      from_station: 'KCG',
      to_station: 'SC',
      current_position: 'KCG→SC',
      progress: Math.min(1.0, Math.max(0.0, p4)),
      status: 'moving',
      delay_minutes: 0,
    },
  ];
}

export function getMockAnalyticsSummary() {
  return {
    summary: {
      total_trains: 15,
      on_time_trains: 13,
      delayed_trains: 2,
      on_time_percentage: 86.7,
      average_delay_minutes: 1.2,
      total_delay_minutes: 18,
    },
    delays_by_station: {
      HYB: 6,
      SC: 12,
      KCG: 0,
    },
    delays_by_train_type: {
      Express: 12,
      Local: 0,
      Passenger: 6,
      Freight: 0,
      Intercity: 0,
    },
    platform_utilization: {
      'HYB-P1': 75,
      'HYB-P2': 50,
      'HYB-P3': 60,
      'HYB-P4': 30,
      'SC-P1': 90,
      'SC-P2': 65,
      'SC-P3': 45,
      'SC-P4': 55,
      'SC-P5': 40,
      'SC-P6': 25,
      'KCG-P1': 70,
      'KCG-P2': 50,
      'KCG-P3': 30,
    },
    conflicts_analysis: {
      total_conflicts: 1,
      by_type: {
        platform_clash: 1,
        headway_violation: 0,
      },
      by_severity: {
        critical: 1,
        medium: 0,
        low: 0,
      },
    },
    active_overrides: 0,
    active_delays: 2,
    optimizer_mode: 'ILP Solver',
    last_updated: new Date().toISOString(),
  };
}

export function getMockAnalyticsTrends() {
  const points = [];
  const now = Date.now();
  // 8 points at 15-minute intervals leading up to now
  const stationDelays = [
    { HYB: 2, SC: 16, KCG: 1 },
    { HYB: 4, SC: 15, KCG: 0 },
    { HYB: 6, SC: 14, KCG: 2 },
    { HYB: 8, SC: 14, KCG: 1 },
    { HYB: 7, SC: 13, KCG: 0 },
    { HYB: 6, SC: 12, KCG: 0 },
    { HYB: 5, SC: 8, KCG: 0 },
    { HYB: 3, SC: 4, KCG: 0 },
  ];

  for (let i = 0; i < 8; i++) {
    const pointTime = new Date(now - (7 - i) * 15 * 60000).toISOString();
    const st = stationDelays[i] || { HYB: 4, SC: 8, KCG: 0 };
    const totalD = st.HYB + st.SC + st.KCG;
    const avgD = Number((totalD / 15).toFixed(1));
    const onTime = Math.min(100, Math.max(75, 87 + (i >= 6 ? 6 : i * -1.5)));

    points.push({
      timestamp: pointTime,
      on_time_percentage: Math.round(onTime),
      average_delay_minutes: avgD,
      conflict_count: i < 6 ? 1 : 0,
      delays_by_station: st,
    });
  }
  return points;
}

export function getMockSimulationScenario(scenarioType: string, trainId?: string, delayMinutes = 15, source = createMockSchedule()) {
  const affected = new Set<string>();
  const amount = Math.max(0, delayMinutes);
  const predicted = source.map(entry => {
    if (scenarioType !== 'weather' && entry.train_id !== trainId) return entry;
    affected.add(entry.train_id);
    return {
      ...entry,
      actual_arrival: new Date(Date.parse(entry.actual_arrival) + amount * 60000).toISOString(),
      actual_departure: new Date(Date.parse(entry.actual_departure) + amount * 60000).toISOString(),
      reason: 'Simulated ' + scenarioType + ' (+' + amount + ' min)',
    };
  });
  const before = findPlatformConflicts(source);
  const after = findPlatformConflicts(predicted);
  return {
    scenario_id: 'sim_' + scenarioType + '_' + Date.now(), timestamp: new Date().toISOString(),
    request: { scenario_type: scenarioType, train_id: trainId, delay_minutes: amount },
    predicted_schedule: predicted,
    kpi_delta: { total_delay_change: affected.size * amount, conflicts_change: after.length - before.length, safety_score_change: 0, affected_trains: affected.size },
    conflicts_before: before.map(c => ({ ...c, station: c.station_id, trains: c.trains_involved })),
    conflicts_after: after.map(c => ({ ...c, station: c.station_id, trains: c.trains_involved })),
    recommendations: [],
  };
}

export function getDomainChatResponse(query: string, context?: { trains?: Train[]; schedule?: ScheduleEntry[]; conflicts?: ConflictsResponse; activeDelays?: ActiveDelay[]; logs?: LogEntry[] }): string {
  const q = query.toLowerCase();
  const conflicts = context?.conflicts?.conflicts ?? [];
  const delays = context?.activeDelays ?? [];
  const schedule = context?.schedule ?? [];
  if (q.includes('conflict')) {
    if (!conflicts.length) return 'The current feed reports no open conflicts. Use Activity to review recent dispatch changes.';
    return conflicts.map(c => (c.station_id || 'Corridor') + (c.platform ? ' · Platform ' + c.platform : '') + '\n' + (c.trains_involved?.join(' and ') || '') + '\n' + (c.root_cause || c.description || 'Open the conflict queue for details.')).join('\n\n') + '\n\nOpen Conflicts to review available recommendations before applying a change.';
  }
  if (q.includes('delay')) return delays.length ? delays.map(d => d.train_id + ' · +' + d.minutes + ' min\n' + (d.reason || d.type)).join('\n\n') : 'The current feed has no active delays.';
  if (q.includes('override') || q.includes('last') || q.includes('action')) {
    const action = context?.logs?.find(log => /override|applied|reverted/i.test(log.action));
    return action ? action.action + '\n' + action.details : 'There are no recorded dispatch changes in this session yet.';
  }
  const id = q.match(/t\d{3,}/i)?.[0].toUpperCase();
  if (id) {
    const stops = schedule.filter(e => e.train_id === id);
    return stops.length ? stops.map(e => id + ' · ' + e.station_id + ' · Platform ' + e.assigned_platform + '\n' + (e.reason || 'Scheduled stop')).join('\n\n') : 'This train has no stops in the current timetable.';
  }
  return 'The session has ' + (context?.trains?.length ?? 0) + ' monitored trains, ' + conflicts.length + ' open conflicts and ' + delays.length + ' active delays.\n\nAsk about active conflicts, current delays, the last override, or a train ID such as T104.';
}
