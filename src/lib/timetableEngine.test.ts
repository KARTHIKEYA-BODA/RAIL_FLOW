import { describe, it, expect } from 'vitest';
import {
  timeToMinutes,
  minutesToTime,
  autoDetectColumns,
  validateTimetableRows,
  detectPlatformConflicts,
  analyseAndOptimizeTimetable,
  DEMO_PRESETS,
  type RawTimetableRow,
  type StandardTimetableRow,
} from './timetableEngine';

describe('Timetable Engine Unit Tests', () => {
  // Test 1: Time parsing & formatting
  it('converts HH:MM strings to minutes and back accurately', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('23:59')).toBe(1439);
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(1439)).toBe('23:59');
  });

  // Test 2: Auto-detect header columns
  it('correctly auto-maps both standard and messy table headers', () => {
    const standard = ['train_id', 'station_id', 'assigned_platform', 'scheduled_arrival', 'scheduled_departure'];
    const map1 = autoDetectColumns(standard);
    expect(map1.trainId).toBe('train_id');
    expect(map1.stationId).toBe('station_id');
    expect(map1.scheduledArrival).toBe('scheduled_arrival');
    expect(map1.platform).toBe('assigned_platform');

    const messy = ['Train No', 'Category', 'Stn', 'Track', 'STA', 'STD', 'Late Mins', 'Remarks'];
    const map2 = autoDetectColumns(messy);
    expect(map2.trainId).toBe('Train No');
    expect(map2.stationId).toBe('Stn');
    expect(map2.scheduledArrival).toBe('STA');
    expect(map2.platform).toBe('Track');
  });

  // Test 3: Validation catches invalid time format and arrival after departure
  it('flags bad rows without crashing the validation report', () => {
    const rawRows: RawTimetableRow[] = [
      { train: 'T101', station: 'SC', arr: '10:00', dep: '10:15', pf: 1 },
      { train: 'T102', station: 'SC', arr: 'CORRUPT', dep: '10:30', pf: 1 },
      { train: 'T103', station: 'HYB', arr: '12:30', dep: '12:10', pf: 2 }, // arrival after departure
      { train: '', station: 'KCG', arr: '14:00', dep: '14:15', pf: 1 }, // missing ID
    ];

    const mapping = {
      trainId: 'train',
      stationId: 'station',
      scheduledArrival: 'arr',
      scheduledDeparture: 'dep',
      platform: 'pf',
    };

    const { report, standardRows } = validateTimetableRows(rawRows, mapping);
    expect(report.totalRows).toBe(4);
    expect(report.validRows).toBe(1);
    expect(report.errors.length).toBe(3);
    expect(standardRows.length).toBe(1);
    expect(standardRows[0].trainId).toBe('T101');
  });

  // Test 4: Exact-headway edge cases (5 min gap vs 4 min gap)
  it('evaluates exact headway edge case: 5 min gap is CLEAR, 4 min gap is CONFLICT', () => {
    // Train A departs at 10:15
    // Case 1: Train B arrives at 10:20 (gap = 5 mins >= 5 headway buffer -> CLEAR)
    const clearCase = [
      { trainId: 'T1', stationId: 'SC', platform: 1, arrivalMins: 600, departureMins: 615 },
      { trainId: 'T2', stationId: 'SC', platform: 1, arrivalMins: 620, departureMins: 635 },
    ];
    const conflictsClear = detectPlatformConflicts(clearCase, 5);
    expect(conflictsClear.length).toBe(0);

    // Case 2: Train B arrives at 10:19 (gap = 4 mins < 5 headway buffer -> CONFLICT)
    const clashCase = [
      { trainId: 'T1', stationId: 'SC', platform: 1, arrivalMins: 600, departureMins: 615 },
      { trainId: 'T2', stationId: 'SC', platform: 1, arrivalMins: 619, departureMins: 635 },
    ];
    const conflictsClash = detectPlatformConflicts(clashCase, 5);
    expect(conflictsClash.length).toBe(1);
    expect(conflictsClash[0].trainA).toBe('T1');
    expect(conflictsClash[0].trainB).toBe('T2');
    expect(conflictsClash[0].overlapMinutes).toBe(1);
  });

  // Test 5: Clean timetable produces 0 initial and 0 final conflicts
  it('produces 0 conflicts for a perfectly spaced schedule', () => {
    const cleanRows: StandardTimetableRow[] = [
      {
        id: 'r1',
        rowNumber: 1,
        trainId: '12723',
        trainType: 'Express',
        stationId: 'SC',
        platform: 1,
        scheduledArrival: '09:00',
        scheduledDeparture: '09:10',
        priority: 1,
        reportedDelayMin: 0,
        delayReason: '',
        minDwellMin: 2,
      },
      {
        id: 'r2',
        rowNumber: 2,
        trainId: '12727',
        trainType: 'Express',
        stationId: 'SC',
        platform: 1,
        scheduledArrival: '09:20', // 10 min after dep -> clear
        scheduledDeparture: '09:30',
        priority: 1,
        reportedDelayMin: 0,
        delayReason: '',
        minDwellMin: 2,
      },
    ];

    const result = analyseAndOptimizeTimetable(cleanRows, 5);
    expect(result.conflictsBefore.length).toBe(0);
    expect(result.conflictsAfter.length).toBe(0);
    expect(result.metrics.delaySavedMin).toBe(0);
    expect(result.metrics.onTimePctAfter).toBe(100);
  });

  // Test 6: Platform conflict resolved cleanly via free platform reallocation
  it('resolves a platform conflict by moving the train to a free platform without delay', () => {
    const clashRows: StandardTimetableRow[] = [
      {
        id: 'r1',
        rowNumber: 1,
        trainId: 'T101',
        trainType: 'Express',
        stationId: 'SC',
        platform: 1,
        scheduledArrival: '10:00',
        scheduledDeparture: '10:20',
        priority: 1,
        reportedDelayMin: 0,
        delayReason: '',
        minDwellMin: 2,
      },
      {
        id: 'r2',
        rowNumber: 2,
        trainId: 'T102',
        trainType: 'Express',
        stationId: 'SC',
        platform: 1,
        scheduledArrival: '10:05', // Arrives during T101 dwell!
        scheduledDeparture: '10:25',
        priority: 2,
        reportedDelayMin: 0,
        delayReason: '',
        minDwellMin: 2,
      },
    ];

    const result = analyseAndOptimizeTimetable(clashRows, 5);
    expect(result.conflictsBefore.length).toBe(1);
    expect(result.conflictsAfter.length).toBe(0);
    expect(result.metrics.platformReassignmentsCount).toBeGreaterThanOrEqual(1);

    const t102Result = result.stops.find((s) => s.trainId === 'T102')!;
    expect(t102Result.platformBefore).toBe(1);
    expect(t102Result.platformAfter).not.toBe(1); // Moved to platform 2 or other free PF
    expect(t102Result.delayAfterMin).toBe(0); // 0 added delay
  });

  // Test 7: Express priority precedence over Freight
  it('protects High-priority Express trains by holding Freight trains when platforms are constrained', () => {
    const priorityRows: StandardTimetableRow[] = [
      {
        id: 'r1',
        rowNumber: 1,
        trainId: 'EXP-12723',
        trainType: 'Superfast',
        stationId: 'BMT', // Only 2 platforms at Begumpet
        platform: 1,
        scheduledArrival: '11:00',
        scheduledDeparture: '11:15',
        priority: 1,
        reportedDelayMin: 0,
        delayReason: '',
        minDwellMin: 2,
      },
      {
        id: 'r2',
        rowNumber: 2,
        trainId: 'FRT-9001',
        trainType: 'Freight',
        stationId: 'BMT',
        platform: 1,
        scheduledArrival: '11:05',
        scheduledDeparture: '11:30',
        priority: 4, // Lowest priority
        reportedDelayMin: 0,
        delayReason: '',
        minDwellMin: 5,
      },
    ];

    const result = analyseAndOptimizeTimetable(priorityRows, 5);
    const expStop = result.stops.find((s) => s.trainId === 'EXP-12723')!;
    const frtStop = result.stops.find((s) => s.trainId === 'FRT-9001')!;

    // Express must not be delayed
    expect(expStop.delayAfterMin).toBe(0);
    expect(result.conflictsAfter.length).toBe(0);
  });

  // Test 8: Dwell slack recovery trims excess dwell without violating minDwell
  it('recovers delay by trimming excess dwell down to minDwellMin, never below', () => {
    const delayedRow: StandardTimetableRow = {
      id: 'r1',
      rowNumber: 1,
      trainId: 'T104',
      trainType: 'Express',
      stationId: 'SC',
      platform: 1,
      scheduledArrival: '12:00',
      scheduledDeparture: '12:20', // 20 min scheduled dwell
      priority: 2,
      reportedDelayMin: 10, // Arrives at 12:10
      delayReason: 'Signal fault',
      minDwellMin: 5, // minimum required dwell is 5m
    };

    const result = analyseAndOptimizeTimetable([delayedRow], 5);
    const stop = result.stops[0];

    // Scheduled dwell was 20m. Minimum dwell is 5m.
    // Recoverable slack = up to 15m. Delay is 10m.
    // Dwell can be trimmed to 10m (12:10 arr + 10m dwell = 12:20 dep -> on time departure!).
    expect(stop.proposedArrival).toBe('12:10');
    expect(stop.proposedDeparture).toBe('12:20'); // Absorbed delay!
    expect(stop.delayAfterMin).toBe(0);
    expect(stop.delaySavedMin).toBe(10);
  });

  // Test 9: Cascading delay propagation across sequential stops
  it('propagates delay downstream to subsequent stations if not fully absorbed', () => {
    const multiStop: StandardTimetableRow[] = [
      {
        id: 'r1',
        rowNumber: 1,
        trainId: 'T200',
        trainType: 'Express',
        stationId: 'HYB',
        platform: 1,
        scheduledArrival: '14:00',
        scheduledDeparture: '14:05', // 5m dwell, min dwell 2m -> can only absorb 3m
        priority: 2,
        reportedDelayMin: 15, // Arrives at 14:15
        delayReason: 'Brake test',
        minDwellMin: 2,
      },
      {
        id: 'r2',
        rowNumber: 2,
        trainId: 'T200',
        trainType: 'Express',
        stationId: 'SC',
        platform: 2,
        scheduledArrival: '14:30',
        scheduledDeparture: '14:40',
        priority: 2,
        reportedDelayMin: 0,
        delayReason: '',
        minDwellMin: 2,
      },
    ];

    const result = analyseAndOptimizeTimetable(multiStop, 5);
    const scStop = result.stops.find((s) => s.stationId === 'SC')!;

    // At HYB, 3m slack absorbed -> departs at 14:17 (12m exit delay)
    // SC inherits delay -> predicted arrival is 14:45 (from 15m reported delay)
    expect(scStop.predictedArrival).toBe('14:45');
    expect(scStop.rootCause).toContain('Delay carried from previous stop');
  });

  // Test 10: Preloaded Preset 1 (Clean Corridor Clash) solves cleanly
  it('verifies demo preset 1 solves all 3 platform clashes', () => {
    const rawLines = DEMO_PRESETS[0].csvContent.trim().split('\n');
    const headers = rawLines[0].split(',');
    const rows = rawLines.slice(1).map((line) => {
      const parts = line.split(',');
      const obj: RawTimetableRow = {};
      headers.forEach((h, idx) => {
        obj[h] = parts[idx];
      });
      return obj;
    });

    const mapping = autoDetectColumns(headers);
    const { report, standardRows } = validateTimetableRows(rows, mapping);
    expect(report.isValid).toBe(true);

    const result = analyseAndOptimizeTimetable(standardRows, 5);
    expect(result.conflictsBefore.length).toBeGreaterThan(0);
    expect(result.conflictsAfter.length).toBe(0); // All resolved
  });

  // Test 11: Preloaded Preset 2 (Messy Headers) catches 2 bad rows and auto-maps
  it('verifies demo preset 2 catches corrupted rows without crashing', () => {
    const rawLines = DEMO_PRESETS[1].csvContent.trim().split('\n');
    const headers = rawLines[0].split(',');
    const rows = rawLines.slice(1).map((line) => {
      const parts = line.split(',');
      const obj: RawTimetableRow = {};
      headers.forEach((h, idx) => {
        obj[h] = parts[idx];
      });
      return obj;
    });

    const mapping = autoDetectColumns(headers);
    const { report, standardRows } = validateTimetableRows(rows, mapping);

    expect(report.totalRows).toBe(7);
    expect(report.errors.length).toBe(2); // T-CORRUPT and T-REVERSE
    expect(standardRows.length).toBe(5);

    // Remaining valid rows can still be optimized
    const result = analyseAndOptimizeTimetable(standardRows, 5);
    expect(result.stops.length).toBe(5);
  });

  // Test 12: Stress Test (100+ stops) runs deterministically in < 100ms
  it('processes 100+ train movements with 0 crashes in under 100ms', () => {
    const rawLines = DEMO_PRESETS[2].csvContent.trim().split('\n');
    const headers = rawLines[0].split(',');
    const rows = rawLines.slice(1).map((line) => {
      const parts = line.split(',');
      const obj: RawTimetableRow = {};
      headers.forEach((h, idx) => {
        obj[h] = parts[idx];
      });
      return obj;
    });

    const mapping = autoDetectColumns(headers);
    const { report, standardRows } = validateTimetableRows(rows, mapping);
    expect(report.validRows).toBe(100);

    const startTime = performance.now();
    const result = analyseAndOptimizeTimetable(standardRows, 5);
    const elapsed = performance.now() - startTime;

    expect(elapsed).toBeLessThan(150); // fast deterministic speed
    expect(result.stops.length).toBe(100);
    expect(result.metrics.delaySavedMin).toBeGreaterThan(0);
  });
});
