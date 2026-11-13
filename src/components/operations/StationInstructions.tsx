import { useCallback, useEffect, useState } from 'react';
import { config } from '../../config';
import { useStationToken } from './StationSession';

type Instruction = { id: string; station: string; train_id: string; message: string; created_at: string; plan_revision: number; acknowledged_at: string | null };
export function StationInstructions() {
  const token = useStationToken();
  const [items, setItems] = useState<Instruction[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${config.API_BASE_URL}/station-access/instructions`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not load simulation instructions.');
      setItems(await response.json()); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Instructions unavailable.'); }
  }, [token]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 10000); return () => clearInterval(timer); }, [refresh]);
  async function acknowledge(id: string) {
    setBusy(id);
    try {
      const response = await fetch(`${config.API_BASE_URL}/station-access/instructions/${encodeURIComponent(id)}/acknowledge`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not acknowledge this simulation record.');
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Acknowledgement failed.'); }
    finally { setBusy(''); }
  }
  if (!token) return null;
  return <section className="hud-card p-4" aria-label="Recorded simulation instructions">
    <p className="eyebrow">STATION INSTRUCTIONS · SIMULATION</p>
    <p className="text-xs text-white/60 mt-2">Recorded decisions may belong to an older plan. Review the current simulation; these are not real railway instructions.</p>
    {error && <p role="alert" className="text-xs text-red-300 mt-2">{error}</p>}
    {items.length === 0 ? <p className="text-xs text-white/50 mt-3">No recorded instructions for SC.</p> : items.map(item => <div key={item.id} className="mt-3 p-3 rounded-xl bg-white/[0.03] border border-white/10"><p className="text-sm">{item.message}</p><p className="text-xs text-white/50 mt-1">{item.plan_revision < 0 ? 'Recorded replay review' : `Plan revision ${item.plan_revision}`} · {item.created_at} · {item.acknowledged_at ? 'Acknowledged' : 'Awaiting acknowledgement'}</p>{!item.acknowledged_at && <button className="controller-secondary mt-2" disabled={!!busy} onClick={() => void acknowledge(item.id)}>{busy === item.id ? 'Saving…' : 'Acknowledge'}</button>}</div>)}
  </section>;
}
