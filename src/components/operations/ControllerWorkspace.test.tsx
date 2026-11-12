import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ControllerWorkspace } from './ControllerWorkspace';

vi.stubGlobal(
  'fetch',
  vi.fn((url: string) => {
    const path = String(url);
    if (path.includes('/schedule')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          schedule: [],
          previous: [],
          recommendations: [
            {
              id: 'REC-001',
              train_id: 'T101',
              station_id: 'SC',
              one_line_reason: 'Hold T101 at SC for 3.0 min; T104 clears BMO_MED before it enters.',
              status: 'PENDING',
            },
          ],
          kpis: {
            solve_time_ms: 3105.0,
            solver_status: 'FEASIBLE',
            weighted_delay_solver_min: 294.1,
          },
        }),
      });
    }
    if (path.includes('/maintenance/active')) {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    if (path.includes('/trains')) {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: 'T101', type: 'Express', priority: 3, origin: 'SC', destination: 'WDR' },
        ],
      });
    }
    if (path.includes('/stations')) {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: 'SC', station_name: 'Secunderabad', platforms: 6 },
          { id: 'MED', station_name: 'Medchal', platforms: 2 },
        ],
      });
    }
    if (path.includes('/benchmark/results')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'current', scenarios: {} }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => [] });
  }) as unknown as typeof fetch
);

describe('ControllerWorkspace', () => {
  afterEach(() => cleanup());

  it('renders focused 3-feature section controller shell', async () => {
    render(<ControllerWorkspace />);

    expect(screen.getByText('RAILFLOW')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /control/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /maintenance/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /proof/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /report disruption/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Hold T101 at SC for 3.0 min/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /preview without this hold/i })).toBeInTheDocument();
    });
  });
});
