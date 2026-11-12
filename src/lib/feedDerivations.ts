import type { ScheduleEntry, ActiveDelay } from '../types/railway';
import type { TrainPosition } from '../components/operations/NetworkMap';
import { KNOWN_STATIONS } from './timetableEngine';
export function delaysFromSchedule(schedule:ScheduleEntry[]):ActiveDelay[] {
 const byTrain=new Map<string,ActiveDelay>();
 for(const e of schedule){
  const reference=Date.parse(e.scheduled_arrival||e.actual_arrival),actual=Date.parse(e.actual_arrival);
  const minutes=Math.max(0,Math.round((actual-reference)/60000));
  if(minutes>2 && minutes>(byTrain.get(e.train_id)?.minutes||0))byTrain.set(e.train_id,{train_id:e.train_id,minutes,type:'Reported delay',reason:e.reason});
 }
 return [...byTrain.values()];
}
export function stationsForSchedule(schedule:ScheduleEntry[]) {
 return [...new Set(schedule.map(e=>e.station_id))].map(id=>({id,station_code:id,station_name:KNOWN_STATIONS[id]?.name||id,platforms:KNOWN_STATIONS[id]?.platforms.length||Math.max(...schedule.filter(e=>e.station_id===id).map(e=>e.assigned_platform))}));
}
export function positionsFromSchedule(schedule:ScheduleEntry[], now=Date.now()):TrainPosition[]{
 const ids=[...new Set(schedule.map(e=>e.train_id))];
 return ids.flatMap<TrainPosition>(train_id=>{
  const trip=schedule.filter(e=>e.train_id===train_id).sort((a,b)=>Date.parse(a.actual_arrival)-Date.parse(b.actual_arrival));
  const here=trip.find(e=>Date.parse(e.actual_arrival)<=now&&Date.parse(e.actual_departure)>=now);
  const next=trip.find(e=>Date.parse(e.actual_arrival)>now);
  const prev=[...trip].reverse().find(e=>Date.parse(e.actual_departure)<now);
  if(here)return [{train_id,from_station:here.station_id,to_station:here.station_id,status:'waiting' as const,progress:0}];
  if(prev&&next) return [{train_id,from_station:prev.station_id,to_station:next.station_id,status:'moving' as const,progress:Math.max(0,Math.min(1,(now-Date.parse(prev.actual_departure))/(Date.parse(next.actual_arrival)-Date.parse(prev.actual_departure)))),delay_minutes:Math.max(0,Math.round((Date.parse(next.actual_arrival)-Date.parse(next.scheduled_arrival||next.actual_arrival))/60000))}];
  const terminal=next||prev;
  return terminal?[{train_id,from_station:terminal.station_id,to_station:terminal.station_id,status:next?'waiting' as const:'arrived' as const,progress:next?0:1}]:[];
 });
}
