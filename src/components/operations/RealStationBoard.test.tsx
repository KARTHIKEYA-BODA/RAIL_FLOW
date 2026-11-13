import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RealStationBoard } from './RealStationBoard';
import { StationSelector } from './StationSelector';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shows an instruction when there are no recorded station boards', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  render(<RealStationBoard />);
  fireEvent.click(screen.getByRole('button', { name: /show recorded boards/i }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Please load the station board first'));
});

it('makes station names available on hover and keyboard focus while keeping codes visible', () => {
  const onChange = vi.fn();
  render(<StationSelector id="between-from" value="MJF" onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('From station: Malkajgiri Junction (MJF)'));
  const option = screen.getByRole('button', { name: 'WDR — Wadiaram' });
  fireEvent.focus(option);
  expect(option).toHaveTextContent('Wadiaram');
  fireEvent.click(option);
  expect(onChange).toHaveBeenCalledWith('WDR');
});

it('loads a nearby station board only when requested', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('/snapshots')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ station: 'WDR', fetched_at: 1760000000, cached: false, stale: false, data: { trains: [] } }) };
  }));
  render(<RealStationBoard />);
  const station = screen.getByLabelText('Reference station: Secunderabad Junction (SC)');
  fireEvent.click(station);
  fireEvent.click(within(station.parentElement!).getByRole('button', { name: 'WDR — Wadiaram' }));
  expect(calls).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Load station board' }));
  await waitFor(() => expect(calls.some(url => url.endsWith('/station-access/board/WDR'))).toBe(true));
  expect(await screen.findByText(/WDR · Fetched/)).toBeInTheDocument();
});
