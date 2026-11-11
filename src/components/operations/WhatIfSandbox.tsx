import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCheck, Clock3, FlaskConical, Play, RotateCcw } from 'lucide-react';
import { useOperationsFeed } from '../../context/OperationsFeedContext';
import { findPlatformConflicts } from '../../lib/localSchedule';
import { computeKPIs } from '../../lib/scheduleUtils';
import { formatTime } from '../../lib/dateTimeUtils';
import { PageHeader } from '../layout/PageHeader';
interface DrillCase {
  id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Critical';
  scenario: string;
  timeLimitSeconds: number;
  options: {
    id: string;
    text: string;
    safetyScore: number;
    delayImpactMin: number;
    explanation: string;
    isCorrect: boolean;
  }[];
}

const TRAINING_DRILLS: DrillCase[] = [
  {
    id: 'drill-1',
    title: 'Drill 1: Sudden Track Circuit Drop at SC North Throat',
    difficulty: 'Critical',
    scenario:
      'Train T104 (Charminar Express) is approaching Secunderabad at 65 km/h. Track circuit TC-SC-04 drops suddenly, indicating potential rail fracture. Rake is 3 minutes from Home Signal.',
    timeLimitSeconds: 45,
    options: [
      {
        id: 'opt-a',
        text: 'Immediately impose emergency signal clamp and divert T104 to Platform 3 loop',
        safetyScore: 98,
        delayImpactMin: 0,
        explanation: 'Safest action. Avoids suspected rail failure and utilizes idle Platform 3 with zero delay.',
        isCorrect: true,
      },
      {
        id: 'opt-b',
        text: 'Hold T104 at Outer Home signal for 15 minutes awaiting line clear verification',
        safetyScore: 88,
        delayImpactMin: 15,
        explanation: 'Safe but creates an acute delay cascade across the northern corridor.',
        isCorrect: false,
      },
      {
        id: 'opt-c',
        text: 'Authorize pilot caution passage at 15 km/h over the dropped circuit',
        safetyScore: 45,
        delayImpactMin: 6,
        explanation: 'Violates Kavach fail-safe protocols without prior engineering clearance.',
        isCorrect: false,
      },
    ],
  },
  {
    id: 'drill-2',
    title: 'Drill 2: Suburban EMU Overtake Priority Regulation',
    difficulty: 'Medium',
    scenario:
      'Express rake T101 is trailing slow passenger rake T107 by 4 minutes on the SC-KCG double line. Both trains are scheduled for Kacheguda.',
    timeLimitSeconds: 60,
    options: [
      {
        id: 'opt-a',
        text: 'Loop T107 into Sitafalmandi bypass loop line; signal clear run for T101 Express',
        safetyScore: 95,
        delayImpactMin: 2,
        explanation: 'Standard OCC dispatch protocol. Express maintains punctuality; commuter delay absorbed.',
        isCorrect: true,
      },
      {
        id: 'opt-b',
        text: 'Enforce 40 km/h trailing speed on T101 Express behind T107',
        safetyScore: 78,
        delayImpactMin: 12,
        explanation: 'Severe punctuality penalty on high-priority interstate express.',
        isCorrect: false,
      },
    ],
  },
];


export function WhatIfSandbox() {
  const { schedule, trains, stations, logs } = useOperationsFeed();
  const [tab, setTab] = useState<'plan' | 'replay' | 'training'>('plan');
  const [preset, setPreset] = useState('baseline');
  const [speed, setSpeed] = useState(100);
  const [buffer, setBuffer] = useState(5);
  const [weather, setWeather] = useState(0);
  const [block, setBlock] = useState(false);
  const [offset, setOffset] = useState(60);
  const [playing, setPlaying] = useState(false);
  const [drill, setDrill] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [anchor] = useState(() => Date.now());

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setOffset(n => {
      if (n >= 60) { setPlaying(false); return 60; }
      return n + 1;
    }), 700);
    return () => clearInterval(timer);
  }, [playing]);

  const result = useMemo(() => {
    const weatherDelay = weather;
    const estimate = schedule.map(entry => {
      const minutesAhead = Math.max(0, (Date.parse(entry.actual_arrival) - anchor) / 60000);
      const added = Math.round(minutesAhead * (100 / speed - 1) + (minutesAhead ? weatherDelay : 0));
      return { ...entry, actual_arrival: new Date(Date.parse(entry.actual_arrival) + added * 60000).toISOString(), actual_departure: new Date(Date.parse(entry.actual_departure) + added * 60000).toISOString() };
    });
    if (block) {
      for (let index = 0; index < estimate.length; index++) {
        const entry = estimate[index];
        if (entry.station_id !== 'SC' || entry.assigned_platform !== 1 || Date.parse(entry.actual_departure) < anchor) continue;
        const count = stations.find(s => s.id === 'SC')?.platforms ?? 1;
        for (let platform = 2; platform <= count; platform++) {
          const candidate = estimate.map((item,i) => i === index ? { ...item, assigned_platform: platform } : item);
          if (!findPlatformConflicts(candidate, buffer).some(c => c.trains_involved?.includes(entry.train_id) && c.station_id === entry.station_id)) {
            estimate[index] = candidate[index];
            break;
          }
        }
      }
    }
    return {
      entries: estimate,
      issues: findPlatformConflicts(estimate, buffer),
      kpis: computeKPIs(estimate, trains),
      changes: estimate.filter((entry,i) => entry.assigned_platform !== schedule[i].assigned_platform || entry.actual_arrival !== schedule[i].actual_arrival),
      blocked: block ? estimate.filter(e => e.station_id === 'SC' && e.assigned_platform === 1 && Date.parse(e.actual_departure) >= anchor).length : 0,
    };
  }, [schedule, speed, weather, block, buffer, stations, trains, anchor]);
  const baseline = computeKPIs(schedule, trains);
  const task = TRAINING_DRILLS[drill];
  const chosen = task.options.find(o => o.id === answer);
  const cutoff = anchor - (60 - offset) * 60000;
  const history = [...logs].filter(log => Date.parse(log.timestamp) <= cutoff).sort((a,b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  function choosePreset(id: string) {
    setPreset(id);
    setSpeed(id === 'rain' ? 75 : 100);
    setWeather(id === 'rain' ? 4 : 0);
    setBuffer(id === 'rain' ? 7 : 5);
    setBlock(id === 'closure');
  }

  return <div className="sandbox-page">
    <PageHeader title="What-if sandbox" subtitle="Explore a disruption, inspect its impact and rehearse a dispatch decision."/>
    <div className="sandbox-tabs" aria-label="Sandbox views">
      {([['plan','Scenario planner'],['replay','Activity replay'],['training','Training exercises']] as const).map(([id,label]) => <button key={id} aria-pressed={tab === id} onClick={() => {setTab(id);setPlaying(false);}}>{label}</button>)}
    </div>
    {tab === 'plan' && <div className="sandbox-grid">
      <section className="workspace-panel"><div className="panel-head"><div className="panel-title"><FlaskConical size={18}/><h2>Build a scenario</h2></div></div><div className="sandbox-controls">
        <label>Starting point<select value={preset} onChange={e => choosePreset(e.target.value)}><option value="baseline">Current corridor</option><option value="rain">Monsoon slowdown</option><option value="closure">SC platform 1 closure</option></select></label>
        <label htmlFor="scenario-speed">Corridor speed <strong>{speed}%</strong></label><input id="scenario-speed" type="range" min="50" max="100" step="5" value={speed} onChange={e => setSpeed(Number(e.target.value))}/>
        <label htmlFor="scenario-buffer">Platform headway <strong>{buffer} min</strong></label><input id="scenario-buffer" type="range" min="3" max="10" value={buffer} onChange={e => setBuffer(Number(e.target.value))}/>
        <label>Weather allowance<select value={weather} onChange={e => setWeather(Number(e.target.value))}><option value="0">Clear · 0 min</option><option value="2">Moderate rain · +2 min</option><option value="4">Heavy rain · +4 min</option></select></label>
        <label className="closure-toggle"><input type="checkbox" checked={block} onChange={e => setBlock(e.target.checked)}/>Close Secunderabad platform 1</label>
        <button className="quiet-button" onClick={() => choosePreset('baseline')}><RotateCcw size={14}/>Reset scenario</button>
      </div></section>
      <section className="workspace-panel"><div className="panel-head"><div className="panel-title"><h2>Projected timetable</h2></div><span className="rail-feed">Scenario preview</span></div><div className="scenario-result">
        <div className="scenario-metrics">
          <div><span>On-time trains</span><strong>{result.kpis.ontimePct}%</strong><small>Current {baseline.ontimePct}%</small></div>
          <div><span>Delay per train</span><strong>{result.kpis.avgDelay}<em>min</em></strong><small>Current {baseline.avgDelay} min</small></div>
          <div><span>Booking conflicts</span><strong className={result.issues.length ? 'ink-coral' : 'ink-mint'}>{result.issues.length}</strong><small>{result.changes.length} stops changed</small></div>
        </div>
        {result.blocked > 0 && <p className="scenario-caution">{result.blocked} bookings still need a platform after closure. Inspect the schedule before dispatch.</p>}
        <h3>How this preview is calculated</h3><p>Future arrival offsets scale with the selected speed. The weather allowance is added to future stops. Platform bookings are checked against the selected headway. A closure tries available platforms in order.</p>
        <div className="scenario-change-list">{result.changes.slice(0,8).map(entry => {
          const original = schedule.find(s => s.train_id === entry.train_id && s.station_id === entry.station_id);
          return <div key={entry.train_id + entry.station_id}><strong>{entry.train_id}<small>{entry.station_id}</small></strong><span>{formatTime(original?.actual_arrival)} · P{original?.assigned_platform}</span><ArrowRight size={13}/><span>{formatTime(entry.actual_arrival)} · P{entry.assigned_platform}</span></div>;
        })}</div>
        {!result.changes.length && <div className="scenario-neutral"><CheckCheck size={18}/>This preview matches the current timetable.</div>}
        {result.changes.length > 8 && <p className="scenario-more">{result.changes.length - 8} more stops affected.</p>}
        <button className="review-button" onClick={() => { window.location.hash = 'conflicts'; }}>Open dispatch queue<ArrowRight size={15}/></button>
      </div></section>
    </div>}
    {tab === 'replay' && <section className="workspace-panel"><div className="panel-head"><div className="panel-title"><Clock3 size={18}/><h2>Session event replay</h2></div><span>{formatTime(cutoff)} IST</span></div><div className="replay-controls"><button className="quiet-button" onClick={() => { if(offset >= 60) setOffset(0);setPlaying(!playing); }}><Play size={14}/>{playing ? 'Pause' : 'Play'}</button><label htmlFor="replay-time">Last 60 minutes</label><input id="replay-time" type="range" min="0" max="60" value={offset} onChange={e => {setOffset(Number(e.target.value));setPlaying(false);}}/></div><ol className="replay-events">{history.map((log,i) => <li key={i}><time>{formatTime(log.timestamp)}</time><div><strong>{log.action}</strong><p>{log.details}</p></div></li>)}</ol>{!history.length && <p className="panel-empty">No recorded events before this time.</p>}</section>}
    {tab === 'training' && <section className="workspace-panel"><div className="panel-head"><div className="panel-title"><h2>Dispatch practice</h2></div><span className="rail-feed">Illustrative exercise</span></div><div className="training-content"><label>Exercise<select value={drill} onChange={e => {setDrill(Number(e.target.value));setAnswer(null);setSubmitted(false);}}>{TRAINING_DRILLS.map((d,i) => <option key={d.id} value={i}>{d.title}</option>)}</select></label><h3>{task.title.replace(/^Drill \d+: /,'')}</h3><p>{task.scenario}</p><fieldset className="decision-options" disabled={submitted}><legend>Choose a response</legend>{task.options.map(option => <label key={option.id} className={answer === option.id ? 'chosen' : ''}><input type="radio" name="exercise-answer" checked={answer === option.id} onChange={() => setAnswer(option.id)}/><span>{option.text}</span></label>)}</fieldset>{submitted && chosen && <p className="training-feedback"><strong>{chosen.isCorrect ? 'Recommended response' : 'Review this response'}</strong>{chosen.explanation}</p>}<button className="review-button" disabled={!answer} onClick={() => submitted ? (setAnswer(null),setSubmitted(false)) : setSubmitted(true)}>{submitted ? 'Try again' : 'Check response'}</button></div></section>}
  </div>;
}

