import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StationReportSheet } from './StationReportSheet';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps the section report form on its selected step and offers simulation trains', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  render(<StationReportSheet open onClose={() => {}} trainOptions={[{ id: 'EXP-12001', name: 'Express 12001' }]} />);
  fireEvent.click(screen.getByText('Late train'));
  const select = await screen.findByLabelText('Select simulated train:');
  fireEvent.change(select, { target: { value: 'EXP-12001' } });
  fireEvent.click(screen.getByText('Next Step'));
  expect(screen.getByText(/Step 3 · Expected Duration/)).toBeInTheDocument();
});
