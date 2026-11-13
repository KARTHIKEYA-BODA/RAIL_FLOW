export interface Train {
  id: string;
  name?: string;
  type?: string;
  priority?: number;
  scheduled_arrival?: string;
  scheduled_departure?: string;
  origin?: string;
  destination?: string;
  platform_pref?: number;
}

export interface ScheduleEntry {
  scheduled_arrival?: string;
  scheduled_departure?: string;
  train_id: string;
  station_id: string;
  assigned_platform: number;
  actual_arrival: string;
  actual_departure: string;
  reason?: string;
}

export interface Station {
  id: string;
  platforms: number;
  station_code?: string;
  station_name?: string;
  latitude?: number;
  longitude?: number;
  is_junction?: boolean;
  passing_loops?: number;
  km?: number;
  total_capacity?: number;
}

export interface LogEntry {
  actor?: string;
  timestamp: string;
  action: string;
  details: string;
}

export type TrainStatus = 'on-time' | 'delayed' | 'overridden' | 'conflict';

export interface ActiveDelay {
  train_id: string;
  type: string;
  minutes: number;
  reason?: string;
}

export interface ConflictItem {
  id?: string;
  type?: string;
  station_id?: string;
  platform?: number;
  trains_involved?: string[];
  root_cause?: string;
  severity?: string;
  description?: string;
}

export interface ConflictsResponse {
  active_conflicts?: number;
  total_count?: number;
  conflicts?: ConflictItem[];
  conflict_log?: Array<{ type?: string; track?: string; trains?: string[]; timestamp?: string }>;
  impact?: {
    by_severity?: Record<string, number>;
    by_type?: Record<string, number>;
  };
}

export interface Recommendation {
  id: string;
  action_type: string;
  description: string;
  train_id: string;
  station_id?: string;
  new_platform?: number;
  delay_minutes?: number;
  cost_benefit: {
    delay_reduction: number;
    conflicts_resolved: number;
    cost_score: number;
  };
  impact: {
    affected_trains: string[];
    total_delay_change: number;
  };
}

export interface Incident {
  id: string;
  station: string;
  type: 'late_train' | 'loco_failure' | 'signal_failure' | 'speed_restriction' | 'platform_blocked' | 'safety_incident' | 'other';
  train_ids: string[];
  platform?: number | null;
  started_at: string;
  est_duration_min: number;
  note?: string | null;
  status: 'reported' | 'open' | 'resolved';
  restored?: boolean;
  impact_preview?: { status: string; weighted_delay_min: number | null; model_effect: boolean } | null;
  reported_by?: string;
  is_pending_sync?: boolean;
}

export interface StationArrivalRecommendation {
  id: string;
  action_type: string;
  title: string;
  reason?: string;
  savings_text: string;
  can_station_master_accept: boolean;
  button_label: string;
}

export interface StationArrival {
  train_id: string;
  train_name: string;
  category: 'Express' | 'Suburban' | 'Freight' | 'Passenger' | string;
  is_synthetic: boolean;
  scheduled_arrival: string;
  expected_arrival: string;
  scheduled_departure: string;
  expected_departure: string;
  delay_minutes: number;
  assigned_platform: number;
  cause_source: 'reported' | 'inferred' | 'unknown' | null;
  cause_text: string;
  recommendation?: StationArrivalRecommendation | null;
}

export interface StationArrivalsResponse {
  station_id: string;
  station_name: string;
  platforms_count: number;
  window_minutes: number;
  arrivals: StationArrival[];
  active_incidents: Incident[];
  blocked_platforms: number[];
  safety_alert?: string | null;
  timestamp: string;
}
