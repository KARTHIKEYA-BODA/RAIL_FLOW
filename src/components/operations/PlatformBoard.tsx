import { useState } from 'react';
import { ArrowRight, CheckCircle2, TrainFront, TriangleAlert, Ban } from 'lucide-react';
import type { ScheduleEntry, Station, Train, ConflictItem } from '../../types/railway';
import { useOperationsFeed } from '../../context/OperationsFeedContext';
import { usePreferences } from '../../context/WorkspacePreferences';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { formatTime } from '../../lib/dateTimeUtils';
import { stationName, stopDelay } from '../../lib/corridorStatus';
interface PlatformBoardProps {stations:Station[];schedule:ScheduleEntry[];trains:Train[];now?:Date;conflicts?:ConflictItem[];onSelectTrain?:(id:string,entry:ScheduleEntry)=>void;onReviewConflict?:(id?:string)=>void;fullWidth?:boolean;}
export function PlatformBoard({stations,schedule,trains,now=new Date(),conflicts=[],onSelectTrain,onReviewConflict}:PlatformBoardProps) {
 const feed=useOperationsFeed(),prefs=usePreferences();
 const [stationId,setStation]=useState(conflicts[0]?.station_id||stations[0]?.id),[service,setService]=useState<{station:string;platform:number;closed:boolean}|null>(null);
 const station=stations.find(s=>s.id===stationId)||stations[0];
 if(!station)return <p className="panel-empty">Station information is unavailable. Refresh the feed to try again.</p>;
 return <div className="overview"><div className="page-heading"><div><span className="rail-eyebrow">Station operations</span><h1>Platform board</h1><p>Current occupancy and the next booked train at each platform.</p></div></div>
 <div className="station-switcher" aria-label="Choose station">{stations.map(s=><button key={s.id} aria-pressed={station.id===s.id} onClick={()=>setStation(s.id)}><span>{s.id}</span><strong>{stationName(s.id,stations)}</strong><small>{s.platforms} platforms</small>{conflicts.some(c=>c.station_id===s.id)&&<span className="status-label danger"><TriangleAlert size={16}/>Conflict</span>}</button>)}</div>
 <div className="platform-legend"><span>○ Approaching / occupied</span><span className="ink-amber">⏱ Delayed</span><span className="ink-coral">⚠ Conflict</span><span className="ink-mint">✓ Clear</span></div>
 <div className={'platform-grid platforms-'+station.platforms}>{Array.from({length:station.platforms},(_,i)=>i+1).map(p=>{
  const conflict=conflicts.find(c=>c.station_id===station.id&&c.platform===p),closed=feed.blockedPlatforms.includes(station.id+'-'+p);
  const entries=schedule.filter(e=>e.station_id===station.id&&e.assigned_platform===p&&Date.parse(e.actual_departure)>=now.getTime()).sort((a,b)=>Date.parse(a.actual_arrival)-Date.parse(b.actual_arrival));
  const entry=entries[0],train=trains.find(t=>t.id===entry?.train_id),delay=entry?stopDelay(entry,trains):0,arr=entry?Math.ceil((Date.parse(entry.actual_arrival)-now.getTime())/60000):0;
  return <article className={'platform-card'+(conflict?' has-conflict':delay>2?' has-delay':'')} key={p}><header><h2>Platform {p}</h2><span className={conflict?'ink-coral':delay>2?'ink-amber':!entry?'ink-mint':'muted'}>{closed?'⊘ Closed':conflict?'⚠ Conflict':!entry?'✓ Clear':delay>2?'⏱ +'+delay+' min':arr<=0?'● Occupied':'○ Approaching'}</span></header>
   <div className="platform-content">{entry?<><button className="train-title" onClick={()=>onSelectTrain?.(entry.train_id,entry)}><TrainFront size={24}/>{entry.train_id}<ArrowRight size={18}/></button><p>{train?.type||'Train'} · To {stationName(train?.destination)}</p><dl><div><dt>{arr<=0?'Departs':'Arrives'}</dt><dd>{formatTime(arr<=0?entry.actual_departure:entry.actual_arrival)}</dd></div><div><dt>{arr<=0?'Remaining':'From now'}</dt><dd>{arr<=0?Math.max(0,Math.ceil((Date.parse(entry.actual_departure)-now.getTime())/60000)):arr} min</dd></div><div><dt>Platform stop</dt><dd>{Math.round((Date.parse(entry.actual_departure)-Date.parse(entry.actual_arrival))/60000)} min</dd></div></dl></>:<><CheckCircle2 size={28} className="ink-mint"/><h3>{closed?'Out of service':'No upcoming booking'}</h3><p>{closed?'Reopen when the platform is ready.':'Available in the current timetable.'}</p></>}</div>
   {conflict?<button className="review-button" onClick={()=>onReviewConflict?.(conflict.id)}>Review {conflict.trains_involved?.join(' / ')} →</button>:<div className="platform-next">{entries[1]?'Next: '+entries[1].train_id+' · '+formatTime(entries[1].actual_arrival):'No later booking in this timetable'}</div>}
   {!feed.isLiveBackend&&<button className="service-control" disabled={prefs.role==='viewer'} onClick={()=>setService({station:station.id,platform:p,closed:!closed})}><Ban size={15}/>{closed?'Reopen platform':'Mark out of service…'}</button>}
  </article>;
 })}</div><ConfirmDialog open={!!service} title={service?.closed?'Take this platform out of service?':'Reopen this platform?'} message={service?.closed?'Future bookings will be flagged for reassignment. Review each recommendation before applying it.':'The platform will be available for future assignments.'} confirmLabel={service?.closed?'Close platform':'Reopen platform'} onCancel={()=>setService(null)} onConfirm={()=>{if(service)feed.setPlatformService(service.station,service.platform,service.closed);setService(null);}}/></div>;
}

