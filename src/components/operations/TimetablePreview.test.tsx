import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TimetablePreview } from './TimetablePreview';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('explains that saved routes are needed when the catalogue is empty', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  render(<TimetablePreview />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved routes' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No saved routes'));
});

it('submits selected saved trains for an isolated preview', async () => {
  const mock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/timetables')) return { ok: true, json: async () => [{ train_number: '17664', train: { name: 'Example' }, modelled_stations: ['MJF', 'BMO'], warnings: [] }] };
    if (url.endsWith('/timetable-preview')) {
      expect(JSON.parse(String(options?.body)).train_numbers).toEqual(['17664']);
      return { ok: true, json: async () => ({ id: 1, input_fingerprint: '1234567890123456', input: { corridor_date: '2026-11-09', timetables: [] }, limitations: 'Simulation only', result: { status: 'FEASIBLE', excluded: [], trains: [{ number: '17664' }], decisions: [], schedule: [] } }) };
    }
    return { ok: true, json: async () => [] };
  });
  vi.stubGlobal('fetch', mock);
  render(<TimetablePreview />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved routes' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /17664/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Run timetable preview' }));
  expect(await screen.findByText(/SAVED PREVIEW.*FEASIBLE/)).toBeInTheDocument();
});

it('submits a synthetic closed-block scenario with its selected time', async () => {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/timetables')) return { ok: true, json: async () => [{ train_number: '17664', train: { name: 'Example' }, modelled_stations: ['MJF', 'BMO'], warnings: [] }] };
    if (url.endsWith('/timetable-preview')) {
      const payload = JSON.parse(String(options?.body));
      expect(payload.scenario).toMatchObject({ type: 'closed_block', block_id: 'MJF_BMO', start_minute: 540, duration_minutes: 15 });
      return { ok: true, json: async () => ({ id: 2, input_fingerprint: '1234567890123456', input: { corridor_date: '2026-11-09', timetables: [], scenario: payload.scenario }, limitations: 'Simulation only', result: { status: 'FEASIBLE', excluded: [], trains: [], decisions: [], schedule: [] } }) };
    }
    return { ok: true, json: async () => [] };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<TimetablePreview />);
  fireEvent.click(screen.getByRole('button', { name: 'Load saved routes' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /17664/ }));
  fireEvent.change(screen.getByLabelText('Synthetic scenario'), { target: { value: 'closed_block' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run timetable preview' }));
  expect(await screen.findByText(/SAVED PREVIEW.*FEASIBLE/)).toBeInTheDocument();
});
