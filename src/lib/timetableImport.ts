import type { RawTimetableRow, TimetableAnalysisResult } from './timetableEngine';
import type { ScheduleEntry, Train } from '../types/railway';

/** CSV records with quoted commas, escaped quotes and embedded newlines. */
export function parseTimetableCsv(text: string) {
  const records: string[][] = []; let record: string[] = [], value = '', quoted = false;
  const csv = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { value += '"'; i++; }
      else if (!value || quoted) quoted = !quoted;
      else throw new Error('Unexpected quote in CSV field.');
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      record.push(value.trim()); value = '';
      if (c !== ',') { if (record.some(Boolean)) records.push(record); record = []; if (c === '\r' && csv[i + 1] === '\n') i++; }
    } else value += c;
  }
  if (quoted) throw new Error('Unclosed quoted field in CSV.');
  record.push(value.trim()); if (record.some(Boolean)) records.push(record);
  const headers = records.shift() || [];
  if (headers.length < 3 || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('Use at least three distinct, non-empty column headers.');
  if (!records.length) throw new Error('Add at least one timetable row.');
  if (records.length > 2000) throw new Error('Import up to 2,000 stops per file.');
  const rows: RawTimetableRow[] = records.map((cells, i) => {
    if (cells.length !== headers.length) throw new Error('Row ' + (i + 2) + ' has ' + cells.length + ' columns; expected ' + headers.length + '.');
    return Object.fromEntries(headers.map((h, n) => [h, cells[n]]));
  });
  return { headers, rows };
}
export function indianServiceDate(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
export function serviceTimestamp(date: string, minutes: number) {
  const base = Date.parse(date + 'T00:00:00+05:30');
  if (!Number.isFinite(base) || !Number.isFinite(minutes)) throw new Error('Invalid service date or timetable time.');
  return new Date(base + minutes * 60000).toISOString();
}
export function analysisToCorridor(result: TimetableAnalysisResult, date: string) {
  const schedule: ScheduleEntry[] = result.stops.map(s => ({
    train_id:s.trainId, station_id:s.stationId, assigned_platform:s.platformAfter,
    scheduled_arrival:serviceTimestamp(date,s.scheduledArrivalMin),
    scheduled_departure:serviceTimestamp(date,s.scheduledDepartureMin),
    actual_arrival:serviceTimestamp(date,s.proposedArrivalMin),
    actual_departure:serviceTimestamp(date,s.proposedDepartureMin),reason:s.actionTaken,
  }));
  const trains: Train[] = [...new Set(schedule.map(e=>e.train_id))].map(id=>{
    const trip = schedule.filter(e=>e.train_id===id).sort((a,b)=>Date.parse(a.actual_arrival)-Date.parse(b.actual_arrival));
    const stop = result.stops.find(s=>s.trainId===id)!;
    return { id,type:stop.trainType,priority:stop.priority,origin:trip[0].station_id,destination:trip.at(-1)!.station_id,
      platform_pref:trip[0].assigned_platform,scheduled_arrival:trip[0].scheduled_arrival,scheduled_departure:trip[0].scheduled_departure };
  });
  return {schedule,trains};
}
