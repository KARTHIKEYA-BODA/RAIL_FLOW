import type { ScheduleEntry, Train, TrainStatus } from '../types/railway';

export const COLOR_BY_TYPE: Record<string, string> = {
  Express: '#3b82f6',
  Local: '#10b981',
  Intercity: '#f59e0b',
  Passenger: '#06b6d4',
  Freight: '#8b5cf6',
};

export function getTrainById(trains: Train[], id: string) {
  return trains.find((t) => t.id === id);
}

export function calculateDelayMinutes(actualStr?: string, scheduledStr?: string): number {
  if (!actualStr || !scheduledStr) return 0;
  const actual = new Date(actualStr);
  const scheduled = new Date(scheduledStr);
  if (isNaN(actual.getTime()) || isNaN(scheduled.getTime())) return 0;

  const rawDiffMinutes = (actual.getTime() - scheduled.getTime()) / 60000;
  // If dates are across different days/years (e.g. prototype year 2025 vs current system year 2026),
  // compute time-of-day offset to prevent 500,000+ minute overflow bug:
  if (Math.abs(rawDiffMinutes) > 720) {
    const actMin = actual.getHours() * 60 + actual.getMinutes() + actual.getSeconds() / 60;
    const schMin = scheduled.getHours() * 60 + scheduled.getMinutes() + scheduled.getSeconds() / 60;
    let todDiff = actMin - schMin;
    if (todDiff < -720) todDiff += 1440;
    if (todDiff > 720) todDiff -= 1440;
    return Math.max(0, Math.min(180, Number(todDiff.toFixed(1))));
  }
  return Math.max(0, Math.min(180, Number(rawDiffMinutes.toFixed(1))));
}

export function isDelayedEntry(entry: ScheduleEntry, trains: Train[]) {
  const t = getTrainById(trains, entry.train_id);
  if (!t?.scheduled_arrival) return false;
  return calculateDelayMinutes(entry.actual_arrival, entry.scheduled_arrival || t.scheduled_arrival) > 2;
}

export function isOverriddenEntry(entry: ScheduleEntry) {
  const reason = entry.reason?.toLowerCase() ?? '';
  return reason.includes('fixed to p') || reason.includes('override');
}

export function getTrainStatus(
  entry: ScheduleEntry,
  trains: Train[],
  conflictTrainIds?: Set<string>
): TrainStatus {
  if (conflictTrainIds?.has(entry.train_id)) return 'conflict';
  if (isOverriddenEntry(entry)) return 'overridden';
  if (isDelayedEntry(entry, trains)) return 'delayed';
  return 'on-time';
}

export function colorForEntry(entry: ScheduleEntry, trains: Train[]) {
  const t = getTrainById(trains, entry.train_id);
  const base = t?.type ? COLOR_BY_TYPE[t.type] || '#64748b' : '#64748b';
  if (isDelayedEntry(entry, trains)) return '#ef4444';
  return base;
}

export function computeKPIs(schedule: ScheduleEntry[], trains: Train[]) {
  if (!schedule.length) return { total: 0, ontimePct: 0, avgDelay: '0' };
  const uniqueIds = [...new Set(schedule.map((s) => s.train_id))];
  let ontime = 0;
  let sumDelay = 0;

  uniqueIds.forEach((trainId) => {
    const entries = schedule.filter((s) => s.train_id === trainId);
    const worst = entries.reduce((max, s) => {
      const train = getTrainById(trains, s.train_id);
      if (!train?.scheduled_arrival) return max;
      const delay = calculateDelayMinutes(s.actual_arrival, s.scheduled_arrival || train.scheduled_arrival);
      return Math.max(max, delay);
    }, 0);
    sumDelay += worst;
    if (worst <= 2) ontime += 1;
  });

  return {
    total: uniqueIds.length,
    ontimePct: Number(((ontime / uniqueIds.length) * 100).toFixed(1)),
    avgDelay: (sumDelay / uniqueIds.length).toFixed(1),
  };
}

export const computeScheduleKPIs = computeKPIs;

export function computeDelayArray(entries: ScheduleEntry[], trains: Train[]): number[] {
  if (!entries.length) return [];
  return entries.map((e) => {
    const t = getTrainById(trains, e.train_id);
    const scheduledRef = e.scheduled_arrival || t?.scheduled_arrival || t?.scheduled_departure;
    if (!scheduledRef) return 0;
    return calculateDelayMinutes(e.actual_arrival, scheduledRef);
  });
}
