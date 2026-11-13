import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { StationMasterView } from './StationMasterView';

const mockArrivalsResponse = {
  station_id: 'SC',
  station_name: 'Secunderabad Jn',
  platforms_count: 6,
  window_minutes: 120,
  arrivals: [
    {
      train_id: 'T104',
      train_name: 'T104 Express',
      category: 'Express',
      is_synthetic: false,
      scheduled_arrival: '09:51',
      expected_arrival: '10:00',
      scheduled_departure: '09:56',
      expected_departure: '10:05',
      delay_minutes: 9.0,
      assigned_platform: 1,
      cause_source: 'inferred',
      cause_text: 'Inferred: P1 still occupied by T107 until 09:58',
      recommendation: {
        id: 'REC-T104',
        action_type: 'PLATFORM_CHANGE',
        title: 'Move T104 to Platform 3',
        reason: 'Alleviates platform contention at SC',
        savings_text: 'Saves 6 min. If rejected +6',
        can_station_master_accept: true,
        button_label: 'Accept',
      },
    },
    {
      train_id: 'T101',
      train_name: 'T101 Suburban',
      category: 'Suburban',
      is_synthetic: false,
      scheduled_arrival: '09:49',
      expected_arrival: '09:49',
      scheduled_departure: '09:52',
      expected_departure: '09:52',
      delay_minutes: 0.0,
      assigned_platform: 2,
      cause_source: null,
      cause_text: 'On time',
      recommendation: null,
    },
  ],
  active_incidents: [
    {
      id: 'INC-101',
      station: 'SC',
      type: 'signal_failure',
      train_ids: [],
      platform: null,
      started_at: '09:12',
      est_duration_min: 20,
      note: 'Signal failure · open',
      status: 'open',
      reported_by: 'Station Master SC',
    },
  ],
  blocked_platforms: [1],
  safety_alert: null,
  timestamp: new Date().toISOString(),
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = String(url);
      if (path.includes('/corridor/blocks')) {
        return Promise.resolve({ ok: true, json: async () => [{ id: 'SC_MJF', from_station: 'SC', to_station: 'MJF' }] });
      }
      if (path.includes('/arrivals')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockArrivalsResponse,
        });
      }
      if (path.includes('/incidents')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'created',
            incident: {
              id: 'INC-999',
              station: 'SC',
              type: 'late_train',
              started_at: '09:55',
              est_duration_min: 15,
              status: 'open',
            },
            solve_time_ms: 120.0,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'success' }),
      });
    }) as unknown as typeof fetch
  );
});

afterEach(() => {
  cleanup();
});

describe('StationMasterView', () => {
  it('renders RailFlow station view console with arrivals and causes', async () => {
    render(<StationMasterView stationId="SC" />);

    await waitFor(() => {
      expect(screen.getAllByText(/Secunderabad/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Every departure, right on time/i)).toBeInTheDocument();
      expect(screen.getAllByText(/T104/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/\+9 min/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Inferred/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Inferred: P1 still occupied by T107 until 09:58/i)).toBeInTheDocument();
      expect(screen.getByText('Move T104 to Platform 3')).toBeInTheDocument();
      expect(screen.getByText(/Section Control reviews and decides this recommendation/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Accept$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Reject$/i })).not.toBeInTheDocument();
      expect(screen.getByText(/Controller verifies clearance/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Resolve$/i })).not.toBeInTheDocument();
    });
  });

  it('filters to delayed only when checkbox toggled', async () => {
    render(<StationMasterView stationId="SC" />);

    await waitFor(() => {
      expect(screen.getAllByText(/T101/i).length).toBeGreaterThan(0);
    });

    const checkbox = screen.getByLabelText(/Delayed only/i);
    fireEvent.click(checkbox);

    expect(screen.getAllByText(/T104/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('T101')).not.toBeInTheDocument();
  });

  it('opens 10-second report sheet on button click and allows 3-step reporting', async () => {
    render(<StationMasterView stationId="SC" />);

    await waitFor(() => {
      expect(screen.getByText(/Report \(I\)/i)).toBeInTheDocument();
    });

    // Click Report button
    fireEvent.click(screen.getByText(/Report \(I\)/i));

    // Step 1: Check categories visible
    expect(screen.getByText(/Step 1 · Select Incident Category/i)).toBeInTheDocument();
    expect(screen.getByText('Loco failure')).toBeInTheDocument();

    // Click Loco failure (advances to Step 2)
    fireEvent.click(screen.getByText('Loco failure'));

    // Step 2: Target
    expect(screen.getByText(/Step 2 · Target Train or Platform/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: 'SC – MJF' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Affected simulated section/i), { target: { value: 'SC_MJF' } });
    fireEvent.click(screen.getByText('Next Step'));

    // Step 3: Duration
    expect(screen.getByText(/Step 3 · Expected Duration & Notes/i)).toBeInTheDocument();
    const submitBtn = screen.getByText(/Submit Report/i);
    fireEvent.click(submitBtn);

    // After submit, report sheet closes and undo banner shows up
    await waitFor(() => {
      expect(screen.getByText(/Undo \(/i)).toBeInTheDocument();
    });
  });
});
