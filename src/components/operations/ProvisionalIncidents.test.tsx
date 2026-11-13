import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProvisionalIncidents } from './ProvisionalIncidents';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows an impact preview and confirms only on controller action', async () => {
  let confirmed = false;
  const mock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') { confirmed = true; return { ok: true, json: async () => ({ status: 'confirmed' }) }; }
    return { ok: true, json: async () => confirmed ? [] : [{ id: 'INC-1', type: 'signal_failure', station: 'SC', status: 'reported', note: 'Test report', impact_preview: { status: 'FEASIBLE', weighted_delay_min: 12, model_effect: true } }] };
  });
  vi.stubGlobal('fetch', mock);
  const refresh = vi.fn();
  render(<ProvisionalIncidents onConfirmed={refresh} />);
  expect(await screen.findByText(/Impact preview: FEASIBLE/)).toBeInTheDocument();
  expect(mock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm report' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});
