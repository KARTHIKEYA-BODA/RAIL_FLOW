import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';
import { config } from '../../config';
import { StationToken } from './StationSession';

export function StationGate({ children }: { children: ReactNode }) {
  const [token, setToken] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => setToken(''), 3600_000);
    return () => window.clearTimeout(timer);
  }, [token]);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${config.API_BASE_URL}/station-access/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Enter a 4–12 digit PIN.');
      setToken(data.token); setPin('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Backend unavailable.'); }
    finally { setBusy(false); }
  }
  if (!token) return <div className="station-gate">
    <form className="station-gate-card" onSubmit={login}>
      <LockKeyhole size={25} aria-hidden="true" />
      <p className="controller-eyebrow">STATION MASTER · SC</p>
      <h1>Station Master access</h1>
      <p>This view is for the station master. Enter the station PIN to continue.</p>
      <label htmlFor="station-pin">Station PIN</label>
      <input id="station-pin" type="password" inputMode="numeric" autoComplete="off" minLength={4} maxLength={12} pattern="[0-9]*" value={pin} onChange={e => setPin(e.target.value)} required />
      {error && <p role="alert">{error}</p>}
      <button className="controller-primary" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
    </form>
  </div>;
  return <StationToken.Provider value={token}>
    <div className="station-session"><button className="controller-secondary" onClick={() => { void fetch(`${config.API_BASE_URL}/station-access/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); setToken(''); }}>Lock station view</button></div>
    {children}
  </StationToken.Provider>;
}
