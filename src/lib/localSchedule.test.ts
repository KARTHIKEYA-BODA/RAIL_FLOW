import { describe, expect, it } from 'vitest';
import { changeSchedule, findPlatformConflicts } from './localSchedule';
import { createMockSchedule, MOCK_STATIONS, MOCK_RECOMMENDATIONS, createMockTrains } from './mockRailwayData';
import { computeKPIs } from './scheduleUtils';
import { getConflictCount } from './apiNormalize';

const start = new Date('2026-11-11T09:00:00+05:30');

describe('corridor dispatch regression', () => {
  it('has exactly the incident shown in the demo queue', () => {
    const issues = findPlatformConflicts(createMockSchedule(start));
    expect(issues).toHaveLength(1);
    expect(issues[0].trains_involved).toEqual(['T104', 'T107']);
  });
  it('applies the selected platform option to the selected station', () => {
    const before = createMockSchedule(start);
    const after = changeSchedule(before, MOCK_RECOMMENDATIONS[0], MOCK_STATIONS);
    expect(after.find(e => e.train_id === 'T104' && e.station_id === 'SC')?.assigned_platform).toBe(3);
    expect(after.find(e => e.train_id === 'T104' && e.station_id === 'HYB')).toEqual(before.find(e => e.train_id === 'T104' && e.station_id === 'HYB'));
    expect(findPlatformConflicts(after)).toHaveLength(0);
  });
  it('holds the alternative train without changing its platform', () => {
    const before = createMockSchedule(start);
    const after = changeSchedule(before, MOCK_RECOMMENDATIONS[1], MOCK_STATIONS);
    const target = after.find(e => e.train_id === 'T107' && e.station_id === 'SC')!;
    const original = before.find(e => e.train_id === 'T107' && e.station_id === 'SC')!;
    expect(target.assigned_platform).toBe(1);
    expect(Date.parse(target.actual_arrival) - Date.parse(original.actual_arrival)).toBe(120000);
    expect(findPlatformConflicts(after)).toHaveLength(0);
  });
  it('rejects a platform outside the selected station', () => {
    expect(() => changeSchedule(createMockSchedule(start), { ...MOCK_RECOMMENDATIONS[0], new_platform: 99 }, MOCK_STATIONS)).toThrow(/platform/);
  });
  it('uses each stop baseline for fleet punctuality', () => {
    const kpis = computeKPIs(createMockSchedule(start), createMockTrains(start));
    expect(kpis.total).toBe(15);
    expect(kpis.ontimePct).toBe(86.7);
    expect(kpis.avgDelay).toBe('1.2');
  });
  it('does not count resolved history as an active incident', () => {
    expect(getConflictCount({ conflicts: [], total_count: 0, conflict_log: [{ type:'resolved' }] })).toBe(0);
    expect(getConflictCount({ active_conflicts:0, conflict_log:[{ type:'platform_clash' }] })).toBe(0);
  });
});

