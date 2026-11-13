import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ControllerWorkspace } from './ControllerWorkspace';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('switches to a labelled read-only replay and back without mutating the plan', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url); calls.push(`${options?.method || 'GET'} ${path}`);
    let data: unknown = [];
    if (path.endsWith('/schedule')) data = { schedule: [], previous: [], recommendations: [], kpis: {} };
    if (path.endsWith('/controller/replays')) data = [{ id: 7, corridor_date: '2026-11-09', train_count: 1 }];
    if (path.endsWith('/controller/replays/7')) data = { id: 7, corridor_date: '2026-11-09', schedule: [{ train_id: 'T1', station_id: 'SC', assigned_platform: 0, actual_arrival: '2026-11-09T09:00:00+05:30', actual_departure: '2026-11-09T09:05:00+05:30' }], trains: [{ id: 'T1', type: 'Express' }], decisions: [], limitations: 'Recorded simulation' };
    return { ok: true, json: async () => data };
  }));
  render(<ControllerWorkspace />);
  fireEvent.click(await screen.findByRole('button', { name: 'Choose recorded timetable' }));
  const picker = await screen.findByLabelText('Controller timetable source');
  fireEvent.change(picker, { target: { value: '7' } });
  expect(await screen.findByText('Recorded replay · review')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Report disruption/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Return to simulation' }));
  await waitFor(() => expect(screen.queryByText('Recorded replay · review')).not.toBeInTheDocument());
  expect(calls.some(call => call.startsWith('POST '))).toBe(false);
});

it('reviews a replay hold without touching active-plan endpoints', async () => {
  const calls: string[] = [];
  const row = { train_id: 'T1', station_id: 'SC', assigned_platform: 0, actual_arrival: '2026-11-09T09:00:00+05:30', actual_departure: '2026-11-09T09:05:00+05:30' };
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url); calls.push(`${options?.method || 'GET'} ${path}`);
    let data: unknown = [];
    if (path.endsWith('/schedule')) data = { schedule: [], previous: [], recommendations: [], kpis: {} };
    if (path.endsWith('/controller/replays')) data = [{ id: 7, corridor_date: '2026-11-09', train_count: 1 }];
    if (path.endsWith('/controller/replays/7')) data = { id: 7, model_current: true, corridor_date: '2026-11-09', schedule: [row], trains: [{ id: 'T1', name: 'Example', type: 'Express' }], decisions: [{ train_id: 'T1', station_id: 'SC', hold_minutes: 5 }], limitations: 'Recorded simulation' };
    if (path.endsWith('/decisions/0/preview')) data = { status: 'FEASIBLE', delta_weighted_delay_min: 3, assumption: 'Minimum dwell', alternative_schedule: [row] };
    return { ok: true, json: async () => data };
  }));
  render(<ControllerWorkspace />);
  fireEvent.click(await screen.findByRole('button', { name: 'Choose recorded timetable' }));
  fireEvent.change(await screen.findByLabelText('Controller timetable source'), { target: { value: '7' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Preview without this hold' }));
  expect(await screen.findByText(/\+3.0 weighted delay-minutes/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show alternative on chart' }));
  expect(screen.getByText(/ALTERNATIVE PREVIEW/)).toBeInTheDocument();
  expect(calls.some(call => call.includes('/recommendations/'))).toBe(false);
});
