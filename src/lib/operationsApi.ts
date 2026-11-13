const getBase = () => import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export interface DisruptionPayload {
  disruption_type: 'late_train' | 'loco_failure' | 'signal_failure' | 'speed_restriction';
  train_id?: string;
  station_id?: string;
  block_id?: string;
  duration_minutes: number;
  speed_restriction_kmh?: number;
  additional_headway_sec?: number;
  description?: string;
}

export interface MaintenancePayload {
  section_id: string;
  duration_minutes: number;
  allowed_start_time: string;
  allowed_end_time: string;
  track_affected?: 'UP' | 'DOWN' | 'both';
}

export interface OverridePayload {
  train_id: string;
  station_id: string;
  new_platform: number;
  reason?: string;
}

export async function fetchSchedule(): Promise<any> {
  const res = await fetch(`${getBase()}/schedule`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function recomputeSchedule(): Promise<any> {
  const res = await fetch(`${getBase()}/schedule/recompute`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function applyOverride(payload: OverridePayload): Promise<any> {
  const res = await fetch(`${getBase()}/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function acceptRecommendation(id: string): Promise<any> {
  const res = await fetch(`${getBase()}/recommendations/${id}/accept`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function rejectRecommendation(id: string, reasonCode = 'CONTROLLER_PREFERENCE'): Promise<any> {
  const res = await fetch(`${getBase()}/recommendations/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recommendation_id: id, reason_code: reasonCode }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function injectDisruption(payload: DisruptionPayload): Promise<any> {
  const res = await fetch(`${getBase()}/disruptions/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.detail || `HTTP ${res.status}`); }
  return res.json();
}

export async function clearDisruptions(): Promise<any> {
  const res = await fetch(`${getBase()}/disruptions/clear`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function planMaintenance(payload: MaintenancePayload): Promise<any> {
  const res = await fetch(`${getBase()}/maintenance/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function commitMaintenance(id: string): Promise<any> {
  const res = await fetch(`${getBase()}/maintenance/${encodeURIComponent(id)}/commit`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function evaluateWhatIf(payload: { disruption?: DisruptionPayload; override?: OverridePayload }): Promise<any> {
  const res = await fetch(`${getBase()}/whatif/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.detail || `HTTP ${res.status}`); }
  return res.json();
}

export async function commitWhatIf(): Promise<any> {
  const res = await fetch(`${getBase()}/whatif/commit`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchBenchmark(): Promise<any> {
  const res = await fetch(`${getBase()}/benchmark/results`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchForecast(): Promise<any> {
  const res = await fetch(`${getBase()}/stretch/forecast`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchOverrideLearning(): Promise<any> {
  const res = await fetch(`${getBase()}/stretch/override-learning`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function resetSystem(): Promise<any> {
  const res = await fetch(`${getBase()}/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface IncidentCreatePayload {
  station: string;
  type: 'late_train' | 'loco_failure' | 'signal_failure' | 'speed_restriction' | 'platform_blocked' | 'safety_incident' | 'other';
  train_ids?: string[];
  platform?: number | null;
  block_id?: string | null;
  est_duration_min: number;
  note?: string;
  reported_by?: string;
}

export async function fetchStationArrivals(stationId = 'SC', windowMinutes = 120): Promise<any> {
  const res = await fetch(`${getBase()}/station/${encodeURIComponent(stationId)}/arrivals?window=${windowMinutes}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchIncidents(stationId?: string): Promise<any> {
  const url = stationId ? `${getBase()}/incidents?station=${encodeURIComponent(stationId)}` : `${getBase()}/incidents`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function createIncident(payload: IncidentCreatePayload): Promise<any> {
  const res = await fetch(`${getBase()}/incidents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function resolveIncident(incidentId: string, resolutionNote?: string): Promise<any> {
  const res = await fetch(`${getBase()}/incidents/${encodeURIComponent(incidentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'resolved', resolution_note: resolutionNote }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Backward-compatibility exports
export async function injectConflict(): Promise<Record<string, unknown>> {
  return injectDisruption({ disruption_type: 'signal_failure', block_id: 'BMO_MED', duration_minutes: 15 });
}
export async function injectDelay(body: { train_id: string; delay_type: string; delay_minutes: number; reason?: string }): Promise<Record<string, unknown>> {
  return injectDisruption({ disruption_type: 'late_train', train_id: body.train_id, duration_minutes: body.delay_minutes, description: body.reason });
}
export async function startMovementSimulation(): Promise<void> {}
export async function createTestMovements(): Promise<{ message?: string }> { return { message: "ok" }; }
export async function forceConflict(): Promise<{ message?: string }> { return { message: "ok" }; }
