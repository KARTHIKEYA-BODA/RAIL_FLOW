import { useCallback, useEffect, useState } from 'react';
import { config } from '../../config';
import type { Incident } from '../../types/railway';

export function ProvisionalIncidents({ onConfirmed }: { onConfirmed: () => void }) {
  const [reports, setReports] = useState<Incident[]>([]);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<Array<{ incident_id: string; event: string; created_at: string; station: string; type: string }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${config.API_BASE_URL}/incidents`);
      if (!response.ok) throw new Error('Could not load reports.');
      const items: unknown = await response.json();
      if (!Array.isArray(items)) throw new Error('Could not load reports.');
      setReports(items.filter(item => item.status === 'reported'));
      setMessage(current => current === 'Provisional reports unavailable.' ? '' : current);
    } catch { setMessage('Provisional reports unavailable.'); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [refresh]);
  async function confirm(id: string, previewOnly = false) {
    setBusy(id); setMessage('');
    try {
      const response = await fetch(`${config.API_BASE_URL}/incidents/${encodeURIComponent(id)}/${previewOnly ? 'preview' : 'confirm'}`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not confirm the report.');
      setMessage(previewOnly ? 'Preview refreshed for the current simulation.' : 'Confirmed in the simulation. Use official channels for real incidents.');
      await refresh(); if (!previewOnly) onConfirmed();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not confirm the report.'); }
    finally { setBusy(null); }
  }
  async function showHistory() {
    try {
      const response = await fetch(`${config.API_BASE_URL}/incident-history`);
      if (!response.ok) throw new Error('Could not load incident history.');
      setHistory(await response.json());
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load incident history.'); }
  }
  return <div className="controller-reports"><p className="controller-eyebrow">PROVISIONAL REPORTS</p>
    <p>Reports do not change the simulated plan until confirmed.</p>
    {reports.length === 0 ? <p>No provisional reports.</p> : reports.map(report => <div className="controller-preview" key={report.id}>
      <strong>{report.type.replaceAll('_', ' ')} · {report.station}</strong><p>{report.note || 'No details provided.'}</p>
      <p>{report.impact_preview?.status ? `Impact preview: ${report.impact_preview.status}` : 'Preview unavailable'}{report.impact_preview?.weighted_delay_min != null ? ` · ${report.impact_preview.weighted_delay_min} weighted delay-minutes` : ''}{report.impact_preview && !report.impact_preview.model_effect ? ' · no modelled constraint for this report' : ''}</p>
      {report.restored && <p>Restored after restart. Refresh the preview before confirming; no old constraint was reapplied.</p>}
      {report.restored && <button className="controller-secondary" disabled={busy !== null} onClick={() => void confirm(report.id, true)}>Refresh impact preview</button>}
      <button className="controller-secondary report-confirm" disabled={busy !== null || !!report.restored} onClick={() => void confirm(report.id)}>{busy === report.id ? 'Confirming…' : 'Confirm report'}</button>
    </div>)}
    <button className="controller-secondary" onClick={() => void showHistory()}>Show report history</button>
    {history && <div><p>Recorded simulation events:</p>{history.length === 0 ? <p>No saved report events.</p> : history.map((event, index) => <p key={`${event.incident_id}-${index}`}>{event.created_at} · {event.station} · {event.type.replaceAll('_', ' ')} · {event.event.replaceAll('_', ' ')}</p>)}</div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
