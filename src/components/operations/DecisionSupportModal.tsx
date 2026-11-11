import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, GitCompareArrows, ShieldCheck, X } from 'lucide-react';
import { useOperationsFeed } from '../../context/OperationsFeedContext';
import { usePreferences, useWords } from '../../context/WorkspacePreferences';
import { matchRecommendations } from '../../lib/incident';
import { changeSchedule } from '../../lib/localSchedule';
import { detectIssues } from '../../lib/demoScenarios';
import { formatTime } from '../../lib/dateTimeUtils';
import { stationName } from '../../lib/corridorStatus';
interface Props { open:boolean;onClose:()=>void;conflictId?:string;applying?:boolean;onApplyOption:(id:string)=>Promise<boolean>|boolean|void; }
export function DecisionSupportModal({open,onClose,conflictId,applying,onApplyOption}:Props) {
  const feed=useOperationsFeed(),prefs=usePreferences(),words=useWords(),ref=useRef<HTMLDialogElement>(null);
  const [choice,setChoice]=useState<string|null>(null),[confirmed,setConfirmed]=useState(false);
  const conflict=feed.conflictList?.find(c=>c.id===conflictId)??feed.conflictList?.[0];
  const options=conflict?matchRecommendations(conflict,feed.recommendations):[];
  const selected=options.find(r=>r.id===choice)??options[0];
  let proposed=feed.schedule,error='';
  try { if(selected)proposed=changeSchedule(feed.schedule,selected,feed.stations); } catch(e){error=e instanceof Error?e.message:'Unable to preview this change.';}
  const beforeIssues=detectIssues(feed.schedule,feed.blockedPlatforms),afterIssues=detectIssues(proposed,feed.blockedPlatforms);
  const newIssues=afterIssues.filter(c=>!beforeIssues.some(b=>b.id===c.id));
  const target=proposed.find(e=>e.train_id===selected?.train_id&&e.station_id===selected?.station_id);
  const related=feed.schedule.filter(e=>e.station_id===conflict?.station_id&&conflict.trains_involved?.includes(e.train_id));
  const min=Math.min(...related.map(e=>Date.parse(e.actual_arrival)))-5*60000,max=Math.max(...related.map(e=>Date.parse(e.actual_departure)))+10*60000;
  const gap=related.length>1?Math.round((Date.parse(related[1].actual_arrival)-Date.parse(related[0].actual_departure))/60000):0;
  const extra=selected?.action_type==='delay_train'?selected.delay_minutes||0:0;
  useEffect(()=>{if(open){setChoice(null);setConfirmed(false);ref.current?.showModal?.();}else ref.current?.close?.();},[open,conflictId]);
  function timeline(after:boolean) {return <div className="preview-slot"><strong>{after?'After approval':'Current plan'} · {stationName(conflict?.station_id)}</strong>{related.map(e=>{
    const entry=after?proposed.find(p=>p.train_id===e.train_id&&p.station_id===e.station_id)||e:e;
    const left=Math.max(0,(Date.parse(entry.actual_arrival)-min)/(max-min)*100),width=Math.max(4,(Date.parse(entry.actual_departure)-Date.parse(entry.actual_arrival))/(max-min)*100);
    return <div className="mini-slot" key={e.train_id}><div><b>{entry.train_id} · P{entry.assigned_platform}</b><span>{formatTime(entry.actual_arrival)}–{formatTime(entry.actual_departure)}</span></div><div className="mini-track"><i className={after&&!newIssues.length?'safe':'risk'} style={{marginLeft:left+'%',width:Math.min(width,100-left)+'%'}}/></div></div>;
  })}<p className="muted">{after?(extra?extra+' min hold; downstream stops shift with this train.':'Arrival and departure times stay the same.'):(related.length>1?gap+' min gap here. Minimum modelled gap: 5 min.':'This platform is closed.')}</p></div>;}
  return <dialog ref={ref} className="rail-dialog decision-dialog" onCancel={e=>{if(applying)e.preventDefault();else onClose();}} aria-labelledby="decision-title">
    <div className="dialog-head"><span className="dialog-icon"><GitCompareArrows size={24}/></span><button disabled={applying} onClick={onClose} aria-label="Close decision review"><X/></button></div>
    <span className="rail-eyebrow">Explainable dispatch</span><h2 id="decision-title">Review options</h2><p className="dialog-lead">{conflict?'Platform '+conflict.platform+' at '+stationName(conflict.station_id)+' · '+conflict.trains_involved?.join(' / '):'No open incident to review.'}</p>
    <fieldset className="decision-options" disabled={applying}><legend>Choose a change. The controller makes the final decision.</legend>{options.map(r=>{const hold=r.action_type==='delay_train'?r.delay_minutes||0:0;return <label key={r.id} className={selected?.id===r.id?'chosen':''}><input type="radio" name="dispatch-option" checked={selected?.id===r.id} onChange={()=>{setChoice(r.id);setConfirmed(false);}}/><span><strong>{r.new_platform?'Move '+r.train_id+' to platform '+r.new_platform:'Hold '+r.train_id+' for '+hold+' min'}</strong><small>{hold?hold+' min extra delay':'No extra delay'} · Comparison score {Math.max(0,100-hold*2)}/100{r===options[0]?' · Suggested':''}</small></span></label>;})}</fieldset>
    {!options.length?<p className="panel-empty">No available recommendation. Inspect the affected trains before making a manual change.</p>:<><div className="impact-preview">{timeline(false)}{timeline(true)}</div>
      <div className="preview-impact" role="status">{error||newIssues.length?<strong>{error||newIssues.length+' new conflict(s). This option is blocked.'}</strong>:<><p><ShieldCheck size={18} style={{display:'inline',marginRight:8}}/>No new conflicts in the current timetable.</p><p>{target?'Platform '+target.assigned_platform+' checked '+formatTime(target.actual_arrival)+'–'+formatTime(target.actual_departure)+' with the 5-min gap rule.':''}</p><strong>{Math.max(0,beforeIssues.length-afterIssues.length)} conflict(s) resolved · {extra} min extra delay</strong></>}</div>
      <details className="glossary-item"><summary>Why this option?</summary><p>A platform change keeps the timetable intact. A hold moves this train and its later stops by the specified minutes. Each option is checked for overlapping platform bookings and a minimum 5-minute gap.</p><p>The comparison score starts at 100 and subtracts 2 per minute of extra delay. It is a transparent demo ranking, not a safety certification. Track-route and signal clearance must be verified by the controller.</p>{extra>0&&<p>Delay cascade: {proposed.filter(e=>e.train_id===selected?.train_id&&Date.parse(e.actual_arrival)>=Date.parse(target?.actual_arrival||'')).map(e=>stationName(e.station_id)+' '+formatTime(e.actual_arrival)).join(' → ')}</p>}</details>
      <label className="check-row"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={prefs.role==='viewer'||applying}/><span>I reviewed the platform, time window and affected trains.</span></label></>}
    <div className="decision-foot"><p>{prefs.role==='viewer'?'Viewer mode is read-only.':!confirmed?'Confirm the review above to enable Apply fix.':words.controller}</p><button className="quiet-button" disabled={applying} onClick={onClose}>Cancel</button><button className="review-button" disabled={!selected||!confirmed||!!error||newIssues.length>0||prefs.role==='viewer'||applying} onClick={async()=>{if(selected&&await onApplyOption(selected.id)!==false)onClose();}}>{applying?'Applying…':<><Check size={18}/>Apply fix<ArrowRight size={18}/></>}</button></div>
  </dialog>;
}

