import type { ActiveDelay, ConflictItem, ScheduleEntry, Station, Train } from '../types/railway';
import { calculateDelayMinutes } from './scheduleUtils';

export function stationName(id?: string, stations?: Station[]) {
  return stations?.find(station => station.id === id)?.station_name || ({ HYB:'Hyderabad Deccan', SC:'Secunderabad', KCG:'Kacheguda' } as Record<string,string>)[id || ''] || id || 'Corridor';
}
export function fleetSummary(trains: Train[], schedule: ScheduleEntry[], activeDelays: ActiveDelay[]) {
  const delayedIds = new Set(activeDelays.filter(d => d.minutes > 2).map(d => d.train_id));
  const total = trains.length || new Set(schedule.map(e => e.train_id)).size;
  const onTime = Math.max(0, total - delayedIds.size);
  return { total, onTime, onTimePct: total ? Number((100 * onTime / total).toFixed(1)) : 0, delayed: delayedIds.size, delayMinutes: activeDelays.reduce((sum,d) => sum + d.minutes, 0), stops: schedule.length };
}
export function conflictTime(conflict: ConflictItem, schedule: ScheduleEntry[]) {
  const entries = schedule.filter(e => e.station_id === conflict.station_id && conflict.trains_involved?.includes(e.train_id) && (!conflict.platform || e.assigned_platform === conflict.platform));
  const times = entries.map(e => Date.parse(e.actual_arrival)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}
export function countdown(conflict: ConflictItem, schedule: ScheduleEntry[], now: Date) {
  const time = conflictTime(conflict, schedule);
  if (!time) return 'Review required';
  const minutes = Math.ceil((time - now.getTime()) / 60000);
  return minutes > 0 ? 'Clash in ' + minutes + ' min' : 'Action due now';
}
export function stopDelay(entry: ScheduleEntry, trains: Train[]) {
  return calculateDelayMinutes(entry.actual_arrival, entry.scheduled_arrival || trains.find(t => t.id === entry.train_id)?.scheduled_arrival);
}
export function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  return '"' + (/^[=+@-]/.test(text) ? "'" + text : text).replaceAll('"','""') + '"';
}
export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\ufeff' + content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

