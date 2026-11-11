import type { ConflictItem, Recommendation, ScheduleEntry, Station } from '../types/railway';

export function findPlatformConflicts(schedule: ScheduleEntry[], bufferMinutes = 5): ConflictItem[] {
  const conflicts: ConflictItem[] = [];
  const sorted = [...schedule].sort((a,b) => Date.parse(a.actual_arrival) - Date.parse(b.actual_arrival));
  for (let i = 0; i < sorted.length; i++) {
    const first = sorted[i];
    for (const second of sorted.slice(i + 1)) {
      if (first.train_id === second.train_id || first.station_id !== second.station_id || first.assigned_platform !== second.assigned_platform) continue;
      const gap = (Date.parse(second.actual_arrival) - Date.parse(first.actual_departure)) / 60000;
      if (gap < bufferMinutes) conflicts.push({
        id: [first.station_id, first.assigned_platform, first.train_id, second.train_id].join('-'),
        type: gap < 0 ? 'platform_overlap' : 'platform_headway',
        station_id: first.station_id, platform: first.assigned_platform,
        trains_involved: [first.train_id, second.train_id], severity: gap < 0 ? 'high' : 'medium',
        description: first.train_id + ' and ' + second.train_id + ' need review at ' + first.station_id,
        root_cause: gap < 0 ? 'The platform bookings overlap by ' + Math.ceil(-gap) + ' minutes.' : 'The ' + Math.round(gap) + '-minute gap is below the ' + bufferMinutes + '-minute simulation buffer.',
      });
    }
  }
  return conflicts;
}

export function changeSchedule(schedule: ScheduleEntry[], recommendation: Recommendation, stations: Station[]): ScheduleEntry[] {
  const target = schedule.find(e => e.train_id === recommendation.train_id && (!recommendation.station_id || e.station_id === recommendation.station_id));
  if (!target) throw new Error('The selected stop is no longer available.');
  const platformChange = ['platform_reassignment','change_platform','move_train'].includes(recommendation.action_type);
  const hold = recommendation.action_type === 'delay_train' ? recommendation.delay_minutes ?? 0 : 0;
  if (!platformChange && !hold) throw new Error('This action needs the backend optimizer.');
  if (platformChange && (!Number.isInteger(recommendation.new_platform) || recommendation.new_platform! < 1 || recommendation.new_platform! > (stations.find(s => s.id === target.station_id)?.platforms ?? 0))) throw new Error('Choose an available platform at this station.');
  if (hold < 0 || !Number.isFinite(hold)) throw new Error('The hold duration is invalid.');
  return schedule.map(entry => {
    if (entry.train_id !== target.train_id) return entry;
    if (platformChange) return entry === target ? { ...entry, assigned_platform: recommendation.new_platform!, reason: recommendation.description } : entry;
    if (Date.parse(entry.actual_arrival) < Date.parse(target.actual_arrival)) return entry;
    const shift = (time: string) => new Date(Date.parse(time) + hold * 60000).toISOString();
    return { ...entry, actual_arrival: shift(entry.actual_arrival), actual_departure: shift(entry.actual_departure), reason: recommendation.description };
  });
}

