import type { ActiveDelay, ConflictsResponse } from '../types/railway';

export function normalizeActiveDelays(
  data: Record<string, { delay_type?: string; delay_minutes?: number; reason?: string }>
): ActiveDelay[] {
  return Object.entries(data).map(([train_id, entry]) => ({
    train_id,
    type: entry.delay_type || 'delay',
    minutes: entry.delay_minutes ?? 0,
    reason: entry.reason,
  }));
}

export function getConflictCount(data: ConflictsResponse): number {
  if (Array.isArray(data.conflicts)) return data.conflicts.length;
  if (typeof data.active_conflicts === 'number') return data.active_conflicts;
  if (typeof data.total_count === 'number') return data.total_count;
  return data.conflict_log?.filter(event => event.type !== 'resolved').length ?? 0;
}
