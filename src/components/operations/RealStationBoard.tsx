import { useState } from 'react';
import { config } from '../../config';
import { useStationToken } from './StationSession';
import { StationSelector } from './StationSelector';

type Entry = { train: { number: string; name: string }; stop: { arrival: string | null; departure: string | null }; live: { type: string; expectedArrivalTime?: string; expectedDepartureTime?: string; delayMinutes?: number } };
type Board = { station?: string; fetched_at: number; cached: boolean; stale: boolean; replay?: boolean; recorded?: boolean; provider_timestamp?: string; data: { trains: Entry[] } };
type Stop = { station: { code: string; name: string }; arrival?: string; departure?: string; arrivalDay?: number; departureDay?: number; isHalt?: boolean };
type Catalog = { train: { number: string; name?: string }; modelled_stations: string[]; warnings: string[]; fetched_at?: number; recorded?: boolean; solver_ready: boolean };
type Lookup = { catalog?: Catalog; fetched_at: number; cached: boolean; stale: boolean; provider_timestamp?: string; data: { train?: { number?: string; name?: string; runDays?: string[] }; route?: Stop[]; status?: string; isLive?: boolean; lastUpdatedAt?: string; delayMinutes?: number; currentLocation?: { stationCode?: string; stationName?: string; status?: string }; nextHalt?: { stationName?: string }; exceptions?: unknown[] } };
type Between = { fetched_at: number; cached: boolean; stale: boolean; data: { trains: { train: { number: string; name: string; runDays?: string[] }; from: { departure?: string }; to: { arrival?: string } }[] } };
type Snapshot = { id: number; fetched_at: number; station?: string };
const time = (value?: string | null) => value ? (value.includes('T') ? value.slice(11, 16) : value) : '—';
const stamp = (value: number) => new Date(value * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const corridor = new Set(['SC', 'MJF', 'BMO', 'MED', 'MOB', 'ME', 'WDR']);
export function RealStationBoard() {
  const token = useStationToken();
  const [board, setBoard] = useState<Board | null>(null);
  const [boardStation, setBoardStation] = useState('SC');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotHint, setSnapshotHint] = useState('');
  const [train, setTrain] = useState('');
  const [origin, setOrigin] = useState('MJF');
  const [destination, setDestination] = useState('WDR');
  const [between, setBetween] = useState<Between | null>(null);
  const [route, setRoute] = useState<Lookup | null>(null);
  const [catalog, setCatalog] = useState<Catalog[] | null>(null);
  const [live, setLive] = useState<Lookup | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function get(path: string) {
    const response = await fetch(`${config.API_BASE_URL}/station-access/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Request failed.');
    return result;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load data.'); }
    finally { setBusy(false); }
  }
  const matched = route?.data.route?.filter(s => corridor.has(s.station?.code)) ?? [];
  return <section className="real-board" aria-label="RailRadar station board">
    <div className="real-board-header"><div><p className="controller-eyebrow">RAILRADAR · STATION REFERENCE</p><h2>Station arrivals and departures</h2><p>Provider data is separate from the simulated timetable and decisions.</p></div><button className="controller-secondary" onClick={() => void run(async () => { const loaded: Board = await get(`board/${boardStation}`); setBoard(loaded); const saved: Snapshot[] = await get('snapshots'); setSnapshots(saved); setSnapshotHint(saved.length ? '' : loaded.recorded === false ? 'The station board loaded, but it could not be recorded on this server.' : 'No recorded boards yet. Please load the station board first.'); })} disabled={busy}>{busy ? 'Loading…' : 'Load station board'}</button></div>
    <div className="real-board-actions"><span>Reference station</span><StationSelector id="reference-board-station" label="Reference" value={boardStation} disabled={busy} allowed={['SC', 'MED', 'MOB', 'WDR']} onChange={value => { setBoardStation(value); setBoard(null); }} /></div>
    <p>These are public reference boards, not station control or verified track occupancy. On-demand requests are cached for 15 minutes per station. Times are in IST; scheduled entries may have no live update.</p>
    <div className="real-board-actions"><button className="controller-secondary" disabled={busy} onClick={() => void run(async () => { const saved: Snapshot[] = await get('snapshots'); setSnapshots(saved); setSnapshotHint(saved.length ? '' : board?.recorded === false ? 'The station board loaded, but it could not be recorded on this server.' : 'No recorded boards yet. Please load the station board first.'); })}>Show recorded boards</button>{snapshots.length > 0 && <select aria-label="Recorded station boards" value="" onChange={e => { if (e.target.value) { const snapshotId = e.target.value; void run(async () => { const saved: Board = await get(`snapshots/${snapshotId}`); setBoard(saved); setBoardStation(saved.station || 'SC'); }); } }}><option value="">Select a recorded board</option>{snapshots.map(s => <option value={s.id} key={s.id}>{s.station || 'SC'} · {stamp(s.fetched_at)} IST</option>)}</select>}</div>
    {snapshotHint && <p role="status">{snapshotHint}</p>}
    {error && <p role="alert">{error}</p>}
    {board && <><p>{board.replay ? 'REPLAY · recorded board · ' : board.stale ? 'STALE · provider unavailable · ' : board.cached ? 'CACHED · ' : 'PROVIDER DATA · '}{board.station || 'SC'} · Fetched {stamp(board.fetched_at)} IST {board.provider_timestamp ? `· Provider timestamp ${board.provider_timestamp}` : ''}{board.recorded === false ? ' · recording unavailable' : ''}</p>
      <div className="real-board-scroll"><table><thead><tr><th>Train</th><th>Scheduled arrival / departure</th><th>Expected arrival / departure</th><th>Delay</th><th>Status</th><th>Details</th></tr></thead><tbody>{board.data.trains.map((row, i) => <tr key={`${row.train.number}-${i}`}><td>{row.train.number} {row.train.name}</td><td>{time(row.stop.arrival)} / {time(row.stop.departure)}</td><td>{time(row.live.expectedArrivalTime)} / {time(row.live.expectedDepartureTime)}</td><td>{row.live.delayMinutes == null ? '—' : `${row.live.delayMinutes} min`}</td><td>{row.live.type}</td><td><button className="controller-secondary" onClick={() => { setTrain(row.train.number); setRoute(null); setLive(null); }}>Select</button></td></tr>)}</tbody></table></div>
      {board.data.trains.length === 0 && <p>No trains returned for this window.</p>}</>}
    <div className="real-board-lookup"><h3>Find trains between stations</h3><p>Search one direction at a time. This is a timetable search, not a complete list of every train using part of the corridor; trains may bypass Secunderabad. Each uncached search uses one API request.</p><div className="real-board-actions"><span>From</span><StationSelector id="between-from" value={origin} onChange={value => { setOrigin(value); setBetween(null); }} /><span>To</span><StationSelector id="between-to" value={destination} onChange={value => { setDestination(value); setBetween(null); }} /><button className="controller-secondary" disabled={busy || origin === destination} onClick={() => void run(async () => setBetween(await get(`between/${origin}/${destination}`)))}>Find trains</button></div>
    {between && <><p>{between.stale ? 'STALE' : between.cached ? 'CACHED' : 'PROVIDER TIMETABLE'} · fetched {stamp(between.fetched_at)} IST · {between.data.trains.length} trains</p><div className="real-board-scroll"><table><thead><tr><th>Train</th><th>Departure</th><th>Arrival</th><th>Running days</th><th>Details</th></tr></thead><tbody>{between.data.trains.map((row, i) => <tr key={`${row.train.number}-${i}`}><td>{row.train.number} {row.train.name}</td><td>{time(row.from?.departure)}</td><td>{time(row.to?.arrival)}</td><td>{row.train.runDays?.join(', ') || '—'}</td><td><button className="controller-secondary" onClick={() => { setTrain(row.train.number); setRoute(null); setLive(null); }}>Select</button></td></tr>)}</tbody></table></div></>}
    </div><div className="real-board-lookup"><h3>Check a train</h3><p>Enter a train number or select one above. Each uncached lookup uses one API request. Route matching is a timetable comparison, not proof of track occupancy.</p><div className="real-board-actions"><label htmlFor="lookup-train">Train number</label><input id="lookup-train" value={train} maxLength={20} onChange={e => { setTrain(e.target.value); setRoute(null); setLive(null); }} placeholder="e.g. 17664" /><button className="controller-secondary" disabled={busy || !train.trim()} onClick={() => void run(async () => setRoute(await get(`train/${encodeURIComponent(train.trim())}/route`)))}>Check route</button><button className="controller-secondary" disabled={busy || !train.trim()} onClick={() => void run(async () => setLive(await get(`train/${encodeURIComponent(train.trim())}/live`)))}>Check live status</button></div>
      <button className="controller-secondary" disabled={busy} onClick={() => void run(async () => setCatalog(await get('timetables')))}>Show saved routes</button>
      {catalog && <div><p>Saved provider timetables · {catalog.length} trains. These review records can be used in an isolated timetable preview below; the active controller plan remains simulated.</p>{catalog.length === 0 ? <p>No routes saved yet. Check a train route first.</p> : <ul>{catalog.map(item => <li key={item.train.number}>{item.train.number} {item.train.name} · {item.modelled_stations.join(' → ') || 'no modelled stations'} · {item.warnings.length} review {item.warnings.length === 1 ? 'note' : 'notes'}{item.warnings.length > 0 && <ul>{item.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</li>)}</ul>}</div>}
      {route && <div>{route.catalog && <><p>{route.catalog.recorded ? 'Route saved for review.' : 'Route could not be saved.'} The active controller plan remains simulated.</p>{route.catalog.warnings.length > 0 && <ul>{route.catalog.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</>}<p>{route.stale ? 'STALE' : route.cached ? 'CACHED' : 'PROVIDER TIMETABLE'} · fetched {stamp(route.fetched_at)} IST · {route.data.train?.name} · Runs: {route.data.train?.runDays?.join(', ') || 'not provided'}</p><p>{matched.length >= 2 ? `${matched.length} modelled corridor stations appear in this route.` : 'Fewer than two modelled corridor stations found; do not assume this train traverses the section.'} Stops and passing points depend on provider coverage; topology remains assumed.</p><div className="real-board-scroll"><table><thead><tr><th>Station</th><th>Arrival</th><th>Departure</th><th>Type</th></tr></thead><tbody>{matched.map((stop, i) => <tr key={`${stop.station.code}-${i}`}><td>{stop.station.name} ({stop.station.code})</td><td>{time(stop.arrival)}{stop.arrivalDay ? ` · day ${stop.arrivalDay}` : ''}</td><td>{time(stop.departure)}{stop.departureDay ? ` · day ${stop.departureDay}` : ''}</td><td>{stop.isHalt ? 'Halt' : 'Pass / unspecified'}</td></tr>)}</tbody></table></div></div>}
      {live && <div><p>{live.stale ? 'STALE' : live.cached ? 'CACHED' : 'PROVIDER STATUS'} · fetched {stamp(live.fetched_at)} IST · source update {live.data.lastUpdatedAt || 'not provided'}</p><p>Status: {live.data.status || 'unknown'} · Live: {live.data.isLive === true ? 'yes' : 'not confirmed'} · Delay: {live.data.delayMinutes == null ? 'unknown' : `${live.data.delayMinutes} min`}</p><p>Reported location: {live.data.currentLocation?.stationName || live.data.currentLocation?.stationCode || 'not available'} {live.data.currentLocation?.status ? `(${live.data.currentLocation.status})` : ''} · Next halt: {live.data.nextHalt?.stationName || 'not available'}</p><p>Location is a provider observation, not an independently verified accident location. Exceptions reported: {live.data.exceptions?.length ?? 'unknown'}.</p></div>}
    </div>
  </section>;
}
