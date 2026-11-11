import { useState } from 'react';
import { formatRailwayDateTime } from '../../lib/dateTimeUtils';

export interface ActivityLogEntry { timestamp: string; action: string; details: string; }
type Category = 'all' | 'override' | 'conflict' | 'ai' | 'system';

function getCategory(log: ActivityLogEntry): {
  kind: Category;
  label: string;
  badgeStyle: string;
} {
  const act = (log.action || '').toLowerCase();
  const det = (log.details || '').toLowerCase();

  if (act.includes('override') || det.includes('override')) {
    return {
      kind: 'override',
      label: 'Manual Override',
      badgeStyle: 'bg-[#9ac4fb]/15 text-[#9ac4fb] border-[#9ac4fb]/40',
    };
  }
  if (act.includes('conflict') || det.includes('clash') || det.includes('double-book')) {
    return {
      kind: 'conflict',
      label: 'Safety Conflict',
      badgeStyle: 'bg-[#ffab9e]/15 text-[#ffab9e] border-[#ffab9e]/40',
    };
  }
  if (act.includes('ai') || act.includes('optimization') || act.includes('recommendation') || det.includes('solver') || det.includes('greedy')) {
    return {
      kind: 'ai',
      label: 'Dispatch Proposal',
      badgeStyle: 'bg-[#9ac4fb]/15 text-[#9ac4fb] border-[#9ac4fb]/40',
    };
  }
  if (act.includes('delay') || det.includes('delay')) {
    return {
      kind: 'system',
      label: 'Delay Telemetry',
      badgeStyle: 'bg-[#f2c278]/15 text-[#f2c278] border-[#f2c278]/40',
    };
  }
  return {
    kind: 'system',
    label: 'System Sync',
    badgeStyle: 'bg-[#344039]/50 text-[#acb9b0] border-[#344039]',
  };
}

export function ActivityPanel({ logs }: { logs: ActivityLogEntry[] }) {
  const [filter, setFilter] = useState<Category>('all');
  const visible = logs.filter(log => filter === 'all' || getCategory(log).kind === filter);
  return <div className="activity-log">
    <div className="activity-filters" aria-label="Filter activity">{(['all','override','conflict','ai','system'] as Category[]).map(cat =>
      <button key={cat} aria-pressed={filter === cat} onClick={() => setFilter(cat)}>{cat === 'ai' ? 'Proposals' : cat}</button>
    )}</div>
    <ol>{visible.map((log,i) => {
      const meta = getCategory(log);
      return <li key={log.timestamp + i}><span className={'log-dot ' + meta.kind}/><article>
        <header><time>{formatRailwayDateTime(log.timestamp)}</time><span className={'log-badge ' + meta.badgeStyle}>{meta.label}</span></header>
        <strong>{log.action}</strong>
        {log.details && <p>{log.details}</p>}
      </article></li>;
    })}</ol>
  </div>;
}
