import { createMockSchedule, createMockTrains, MOCK_STATIONS } from './mockRailwayData';
import { changeSchedule, findPlatformConflicts } from './localSchedule';
import type { ActiveDelay, ConflictItem, Recommendation, ScheduleEntry } from '../types/railway';

export type DemoKind = 'normal' | 'signal' | 'rain' | 'platform';
export function scenarioRecommendations(schedule: ScheduleEntry[], conflicts: ConflictItem[], blocked: string[] = []): Recommendation[] {
  const options: Recommendation[] = [];
  for (const conflict of conflicts) {
    const trainId = conflict.trains_involved?.[0];
    const entry = schedule.find(e => e.train_id === trainId && e.station_id === conflict.station_id && (!conflict.platform || e.assigned_platform === conflict.platform));
    if (!entry) continue;
    const platformCount = MOCK_STATIONS.find(s => s.id === entry.station_id)?.platforms ?? 0;
    for (let p = 1; p <= platformCount; p++) {
      if (p === entry.assigned_platform || blocked.includes(entry.station_id + '-' + p)) continue;
      const candidate: Recommendation = { id:'move-' + entry.train_id + '-' + entry.station_id + '-' + p, action_type:'change_platform', train_id:entry.train_id, station_id:entry.station_id, new_platform:p, description:'Move ' + entry.train_id + ' to platform ' + p + ' at ' + entry.station_id, cost_benefit:{ conflicts_resolved:1, delay_reduction:0, cost_score:100 }, impact:{ affected_trains:conflict.trains_involved || [], total_delay_change:0 } };
      const proposed = changeSchedule(schedule,candidate,MOCK_STATIONS);
      if (!findPlatformConflicts(proposed).some(c => c.station_id === entry.station_id && c.trains_involved?.includes(entry.train_id))) { options.push(candidate); break; }
    }
    if (conflict.type === 'platform_closed') continue;
    const following = schedule.find(e => e.station_id === entry.station_id && e.train_id === conflict.trains_involved?.[1]);
    if (!following) continue;
    const delay = Math.max(1, Math.ceil((Date.parse(entry.actual_departure) + 5 * 60000 - Date.parse(following.actual_arrival)) / 60000));
    options.push({ id:'hold-' + following.train_id + '-' + following.station_id, action_type:'delay_train', train_id:following.train_id, station_id:following.station_id, delay_minutes:delay, description:'Hold ' + following.train_id + ' for ' + delay + ' min before platform ' + following.assigned_platform, cost_benefit:{ conflicts_resolved:1, delay_reduction:0, cost_score:Math.max(0,100-delay*2) }, impact:{ affected_trains:[following.train_id], total_delay_change:delay } });
  }
  return options;
}
export function detectIssues(schedule: ScheduleEntry[], blocked: string[] = []): ConflictItem[] {
  return [...findPlatformConflicts(schedule), ...schedule.filter(e => blocked.includes(e.station_id + '-' + e.assigned_platform) && Date.parse(e.actual_departure) >= Date.now()).map(e => ({
    id:'closed-' + e.station_id + '-' + e.train_id, type:'platform_closed', station_id:e.station_id, platform:e.assigned_platform,
    trains_involved:[e.train_id], severity:'critical', description:e.train_id + ' assigned to a closed platform',
    root_cause:'Platform ' + e.assigned_platform + ' is out of service. Choose an available platform.',
  }))];
}
export function createDemo(kind: DemoKind) {
  const start = new Date();
  const normal = createMockSchedule(start).map(e => {
    const departure = e.train_id === 'T104' && e.station_id === 'SC' ? new Date(start.getTime() + 25*60000).toISOString() : e.actual_departure;
    return { ...e, actual_departure:departure, scheduled_arrival:e.actual_arrival, scheduled_departure:departure, reason:'Published timetable' };
  });
  const delays: ActiveDelay[] = [];
  const schedule = normal.map(e => {
    const minutes = kind === 'signal' && e.train_id === 'T104' && e.station_id !== 'HYB' ? 8 : kind === 'rain' && ['T104','T107','T110'].includes(e.train_id) && Date.parse(e.actual_arrival) > start.getTime() ? 10 : 0;
    if (!minutes) return e;
    if (!delays.some(d => d.train_id === e.train_id)) delays.push({ train_id:e.train_id, type:kind === 'signal' ? 'Signal failure' : 'Heavy rain', minutes, reason:kind === 'signal' ? 'Signal failure reported at Secunderabad approach' : 'Weather delay reported in the corridor' });
    return { ...e, actual_arrival:new Date(Date.parse(e.actual_arrival)+minutes*60000).toISOString(), actual_departure:new Date(Date.parse(e.actual_departure)+minutes*60000).toISOString(), reason:delays.find(d=>d.train_id===e.train_id)!.reason };
  });
  const blocked = kind === 'platform' ? ['SC-1'] : [];
  const issues = detectIssues(schedule,blocked);
  return { schedule, baseline:normal, delays, blocked, issues, recommendations:scenarioRecommendations(schedule,issues,blocked), trains:createMockTrains(start) };
}

