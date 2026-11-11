import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, CheckCheck, CircleCheck, Clock3, Network, ShieldAlert, Signal, TrainFront, TriangleAlert, Volume2 } from 'lucide-react';
import { useOperationsFeed } from '../../context/OperationsFeedContext';
import { useSelection } from '../../context/SelectionContext';
import { usePreferences, useWords, guidedAlert, speak } from '../../context/WorkspacePreferences';
import { formatTime } from '../../lib/dateTimeUtils';
import { matchRecommendations } from '../../lib/incident';
import { countdown, conflictTime, fleetSummary, stationName, stopDelay } from '../../lib/corridorStatus';
import { notify } from '../../lib/notify';
import { NetworkMap } from './NetworkMap';
import { MareyChart } from './MareyChart';
import { SorvoCorridorHero } from './SorvoCorridorHero';
import type { AppSection } from '../../App';
interface Props { now:Date;tick:number;onNavigate:(section:AppSection)=>void;onReview:(id?:string)=>void;onTrain:(id:string)=>void;controls:ReactNode; }
export function CorridorOverview({now,tick,onNavigate,onReview,onTrain,controls}:Props) {
  const feed=useOperationsFeed(), prefs=usePreferences(), words=useWords(), {selectEntry}=useSelection();
  const {trains,stations,schedule,activeDelays,conflictList,conflictCount,recommendations,trainPositions,trackStatus,lastActionSnapshot}=feed;
  const [diagram,setDiagram]=useState<'map'|'graph'>('map');
  const incident=conflictList?.[0], suggested=incident&&matchRecommendations(incident,recommendations)[0];
  const summary=fleetSummary(trains,schedule,activeDelays);
  const next=schedule.filter(e=>Date.parse(e.actual_departure)>=now.getTime()).sort((a,b)=>Date.parse(a.actual_departure)-Date.parse(b.actual_departure)).slice(0,5);
  const history=useRef<number[][]>([]);
  const signature=[summary.total,summary.onTimePct,summary.delayed,conflictCount].join(',');
  useEffect(()=>{history.current=[...history.current,signature.split(',').map(Number)].slice(-12);},[signature]);
  const metrics=[
    {label:'Monitored trains',value:summary.total,detail:schedule.length+' scheduled stops · 3 stations',icon:TrainFront,tone:'',page:'schedule'},
    {label:'On-time performance',value:summary.onTimePct.toFixed(1)+'%',detail:summary.onTime+' of '+summary.total+' trains · ≤2 min late',icon:CircleCheck,tone:'mint',page:'schedule'},
    {label:'Active delays',value:summary.delayed,detail:summary.delayMinutes+' min reported fleet delay',icon:Clock3,tone:summary.delayed?'amber':'mint',page:'conflicts'},
    {label:'Open conflicts',value:conflictCount,detail:conflictCount?'Controller decision needed':'No conflicts reported',icon:ShieldAlert,tone:conflictCount?'coral':'mint',page:'conflicts'},
  ];
  const plain=incident?guidedAlert(prefs.language,incident.trains_involved||[],incident.platform,stationName(incident.station_id),suggested?.new_platform):words.clear;
  function readAlert(){if(!speak(plain,prefs.language))notify.info('Speech is unavailable in this browser','The written alert remains available.');}
  const beforeCount=lastActionSnapshot?.conflicts.conflicts?.length??0;
  const extra=lastActionSnapshot?summary.delayMinutes-lastActionSnapshot.activeDelays.reduce((s,d)=>s+d.minutes,0):0;
  return <div className="overview space-y-6">
    <div className="page-heading"><div><span className="rail-eyebrow">South Central Railway</span><h1>Hyderabad corridor</h1><p>{conflictCount?'A dispatch decision needs your attention.':'The corridor is ready for the next movement.'}</p></div><label className="check-row"><input type="checkbox" checked={prefs.guided} onChange={e=>prefs.setPreference('guided',e.target.checked)}/>{words.guided}</label></div>
    
    {prefs.guided ? (
      incident?<section className="conflict-hero" aria-labelledby="priority-title"><div><span className="status-label danger"><TriangleAlert size={18}/>Decision required</span><h2 id="priority-title">{plain}</h2><div className="hero-actions"><button className="review-button" onClick={()=>onReview(incident.id)}>{words.move}<ArrowRight size={18}/></button><button className="quiet-button" onClick={readAlert}><Volume2 size={18}/>{words.read}</button><button className="quiet-button" onClick={()=>onReview(incident.id)}>{words.other}</button></div></div><div className="conflict-countdown"><Clock3 size={20}/><strong>{Math.max(0,Math.ceil(((conflictTime(incident,schedule)||now.getTime())-now.getTime())/60000))} min</strong><span>{countdown(incident,schedule,now).startsWith('Clash')?'until predicted conflict':'Action due now'}</span></div></section>:<section className="clear-card"><CheckCheck size={40}/><div><h2>{words.complete}</h2><p>{words.clear}</p></div></section>
    ) : (
      <SorvoCorridorHero
        incident={incident ?? null}
        suggested={suggested ?? null}
        conflictCount={conflictCount}
        activeDelayCount={activeDelays.length}
        totalTrains={summary.total}
        onTimePct={summary.onTimePct}
        onReview={onReview}
        onReadAlert={readAlert}
      />
    )}

    {lastActionSnapshot&&<div className="impact-meter" aria-label="Impact of the applied change"><div><strong>{Math.max(0,beforeCount-conflictCount)}</strong><span>Conflicts resolved</span></div><div><strong>{Math.max(0,extra)} min</strong><span>Extra fleet delay</span></div><div><strong>{Math.max(0,conflictCount-beforeCount)}</strong><span>New conflicts</span></div><div><strong>Controller approved</strong><span>Recorded in History · Undo available for 30 seconds</span></div></div>}
    {!prefs.guided&&<><div className="metric-grid">{metrics.map((m,i)=><button className="metric" key={m.label} data-testid={m.label==='Open conflicts'?'status-conflicts':undefined} onClick={()=>{onNavigate(m.page as AppSection);if(m.label==='Active delays')location.hash='conflicts?tab=delays';}}><div className="metric-top"><span>{m.label}</span><m.icon size={20}/></div><strong className={m.tone?'ink-'+m.tone:''}>{m.value}</strong><span className="metric-note">{m.detail}</span>{history.current.length>1&&<svg className="metric-spark" viewBox="0 0 70 25" aria-label="Trend during this session"><polyline fill="none" stroke="currentColor" strokeWidth="2" points={history.current.map((v,n)=>[n*70/(history.current.length-1),22-v[i]/Math.max(1,...history.current.map(h=>h[i]))*19].join(',')).join(' ')}/></svg>}</button>)}</div>
      <section className="workspace-panel network-panel"><div className="panel-head"><div className="panel-title"><Network size={20}/><h2>Corridor movements</h2></div><div className="segmented" aria-label="Network view">{(['map','graph']as const).map(mode=><button key={mode} aria-pressed={diagram===mode} onClick={()=>setDiagram(mode)}>{mode==='map'?'Network map':'Time–distance graph'}</button>)}</div></div>{diagram==='map'?<NetworkMap stations={stations} trains={trains} schedule={schedule} trainPositions={trainPositions} trackStatus={trackStatus} animTick={tick} onTrainClick={onTrain} compact/>:<MareyChart schedule={schedule} trains={trains} stations={stations} conflicts={conflictList??[]} now={now} onSelectTrain={onTrain} onResolveConflict={onReview}/>}</section>
      <div className="overview-pair"><section className="workspace-panel"><div className="panel-head"><div className="panel-title"><Clock3 size={20}/><h2>Next departures</h2></div><button className="panel-link" onClick={()=>onNavigate('schedule')}>Timetable →</button></div>{next.length?<div className="departure-list">{next.map(e=>{const train=trains.find(t=>t.id===e.train_id),delay=stopDelay(e,trains);return <button key={e.train_id+e.station_id+e.actual_departure} onClick={()=>selectEntry(e)}><time>{delay>0&&e.scheduled_departure&&<del>{formatTime(e.scheduled_departure)}</del>}{formatTime(e.actual_departure)}</time><span className="departure-id">{e.train_id}<small>{train?.type}</small></span><span className="departure-stop">{stationName(e.station_id)}<small>To {stationName(train?.destination)}</small></span><span className="platform-tag">P{e.assigned_platform}</span><span className={delay>2?'ink-amber':'ink-mint'}>{delay>2?'⏱ +'+delay+'m':'✓ On time'}</span></button>;})}</div>:<p className="panel-empty">No further departures in this timetable.</p>}</section><section className="workspace-panel"><div className="panel-head"><div className="panel-title"><Signal size={20}/><h2>Track occupancy</h2></div></div><div className="dispatch-controls">{controls}</div></section></div></>}
    {!feed.isLiveBackend&&<div className="scenario-bar"><span><strong>Demonstration scenarios</strong><small>Start normal, report a disruption, then approve a resolution.</small></span>{([['normal','Normal running'],['signal','Signal failure'],['rain','Heavy rain'],['platform','Platform closed']]as const).map(([kind,label])=><button key={kind} className="quiet-button" disabled={prefs.role==='viewer'} onClick={()=>feed.loadDemoScenario(kind)}>{label}</button>)}</div>}
  </div>;
}

