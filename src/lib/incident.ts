import type { ConflictItem, Recommendation } from '../types/railway';

export function matchRecommendations(conflict: ConflictItem, recommendations: Recommendation[]) {
  return recommendations.filter(rec =>
    (!conflict.station_id || !rec.station_id || rec.station_id === conflict.station_id) &&
    (conflict.trains_involved?.includes(rec.train_id) || rec.impact?.affected_trains?.some(id => conflict.trains_involved?.includes(id)))
  );
}

