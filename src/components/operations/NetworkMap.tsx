import { useId, useState } from 'react';
import { TrainFront } from 'lucide-react';
import type { ScheduleEntry, Station, Train } from '../../types/railway';
import type { TrackStatusResponse } from '../../context/OperationsFeedContext';
export interface TrainPosition {
  train_id: string;
  from_station: string;
  to_station: string;
  current_position?: string;
  progress?: number;
  status: 'waiting' | 'moving' | 'arrived';
  delay_minutes?: number;
}

export interface NetworkMapProps {
  stations: Station[];
  schedule: ScheduleEntry[];
  trains: Train[];
  trainPositions: TrainPosition[];
  animTick: number;
  trackStatus?: TrackStatusResponse | null;
  onTrainClick?: (trainId: string) => void;
  compact?: boolean;
  className?: string;
}


type Point = [number, number];
const junctions: Record<string, Point> = { HYB: [76, 125], SC: [330, 56], KCG: [562, 158] };
const paths = [
  { from: 'HYB', to: 'SC', color: '#73dcb5', points: [junctions.HYB, [174,125], [243,56], junctions.SC] as Point[] },
  { from: 'SC', to: 'KCG', color: '#7ba9f2', points: [junctions.SC, [415,56], [517,158], junctions.KCG] as Point[] },
  { from: 'HYB', to: 'KCG', color: '#8795a4', points: [junctions.HYB, [128,177], [424,177], [443,158], junctions.KCG] as Point[] },
];

function pointAlong(points: Point[], progress: number): Point {
  const lengths = points.slice(1).map(([x,y], i) => Math.hypot(x - points[i][0], y - points[i][1]));
  let distance = Math.max(0, Math.min(1, progress)) * lengths.reduce((a,b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i]) {
      const t = distance / lengths[i];
      return [points[i][0] + (points[i+1][0] - points[i][0]) * t, points[i][1] + (points[i+1][1] - points[i][1]) * t];
    }
    distance -= lengths[i];
  }
  return points[points.length - 1];
}

export function MapLegend() {
  return <div className="map-key"><span><i className="key-station"/>Station</span><span><i className="key-moving"/>Moving</span><span><i className="key-delayed"/>Delayed</span></div>;
}

export function NetworkMap({ stations, schedule, trainPositions, onTrainClick, compact, className = '' }: NetworkMapProps) {
  const grid = useId();
  const [focused, setFocused] = useState<string | null>(null);
  const stationIds = new Set(stations.map(s => s.id));
  const routes = paths.filter(r => stationIds.has(r.from) && stationIds.has(r.to));
  const markers = trainPositions.flatMap(pos => {
    const route = routes.find(r => (r.from === pos.from_station && r.to === pos.to_station) || (r.to === pos.from_station && r.from === pos.to_station));
    if (!route) return [];
    const progress = pos.status === 'arrived' ? 1 : pos.progress ?? 0;
    const [x, y] = pointAlong(route.points, route.from === pos.from_station ? progress : 1 - progress);
    return [{ ...pos, x, y }];
  });
  return <div className={'corridor-map ' + (compact ? 'map-compact ' : '') + className}>
    <svg viewBox="0 0 640 224" aria-label="Schematic of Hyderabad corridor stations and reported train positions" role="img">
      <defs><pattern id={grid} width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#51635b"/></pattern></defs>
      <rect width="640" height="224" fill={'url(#' + grid + ')'} opacity=".52"/>
      {routes.map(r => <g key={r.from + r.to} fill="none" strokeLinejoin="round" strokeLinecap="round">
        <polyline points={r.points.map(p => p.join(',')).join(' ')} stroke={r.color} strokeWidth="8" opacity=".12"/>
        <polyline points={r.points.map(p => p.join(',')).join(' ')} stroke={r.color} strokeWidth="3.5"/>
      </g>)}
      {stations.map(s => {
        const pos = junctions[s.id];
        if (!pos) return null;
        const [x,y] = pos;
        const labelY = s.id === 'KCG' ? y + 32 : y - 28;
        return <g key={s.id} textAnchor="middle"><circle cx={x} cy={y} r="9" fill="#16241f" stroke="#d7e7df" strokeWidth="3"/><circle cx={x} cy={y} r="3" fill="#e2f0e7"/>
          <text x={x} y={labelY} fill="#eef5f0" fontSize="15" fontWeight="700">{s.station_name?.replace(' Junction','') || s.id}</text>
          <text x={x} y={labelY + 14} fill="#a1b6aa" fontSize="10.5" letterSpacing="1">{s.id} · {s.platforms} PF</text>
        </g>;
      })}
      {markers.filter(m => m.status === 'moving').map(m => <g key={m.train_id} transform={'translate(' + m.x + ',' + m.y + ')'} onMouseEnter={() => setFocused(m.train_id)} onMouseLeave={() => setFocused(null)} onClick={() => onTrainClick?.(m.train_id)} style={{cursor:'pointer'}}>
        <title>{m.train_id} · {m.from_station} to {m.to_station}</title><circle r="12" fill="transparent"/><rect x="-9" y="-6" width="18" height="12" rx="4" fill={(m.delay_minutes ?? 0) > 0 ? '#f5bd6a' : '#a4ebcb'} stroke="#16241f" strokeWidth="2"/><path d="M-4 -2v4m4-4v4m4-4v4" stroke="#23362e" strokeWidth="1.7"/>
        {focused === m.train_id && <g><rect x="-24" y="-28" width="48" height="18" rx="4" fill="#e7f5ec"/><text y="-15" textAnchor="middle" fontSize="12" fill="#173528" fontWeight="700">{m.train_id}</text></g>}
      </g>)}
    </svg>
    <div className="map-bottom"><MapLegend/><span>{markers.filter(m => m.status === 'moving').length} moving</span></div>
    {markers.length > 0 && <div className="map-trains" aria-label="Inspect train">{markers.map(m => <button key={m.train_id} disabled={!onTrainClick || !schedule.some(e => e.train_id === m.train_id)} onClick={() => onTrainClick?.(m.train_id)} onFocus={() => setFocused(m.train_id)} onBlur={() => setFocused(null)} onMouseEnter={() => setFocused(m.train_id)} onMouseLeave={() => setFocused(null)}>
      <TrainFront size={13}/>{m.train_id}{(m.delay_minutes ?? 0) > 0 && <small>+{m.delay_minutes}m</small>}
    </button>)}</div>}
  </div>;
}

