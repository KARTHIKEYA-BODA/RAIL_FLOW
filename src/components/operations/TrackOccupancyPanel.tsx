import type { TrackStatusResponse } from '../../context/OperationsFeedContext';
import { Activity } from 'lucide-react';

interface TrackOccupancyPanelProps {
  trackStatus: TrackStatusResponse | null;
  isStale?: boolean;
}

export function TrackOccupancyPanel({ trackStatus, isStale }: TrackOccupancyPanelProps) {
  const occupancy = trackStatus?.track_occupancy;
  const entries = occupancy && typeof occupancy === 'object' ? Object.entries(occupancy) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-[#acb9b0]" />
          <span className="text-xs text-[#acb9b0]">Block occupancy</span>
        </div>
        {isStale && (
          <span className="rounded bg-[#f2c278]/15 border border-[#f2c278]/30 px-1.5 py-0.5 text-xs text-[#f2c278]">
            Stale telemetry
          </span>
        )}
      </div>

      {!trackStatus ? (
        <p className="text-xs text-[#acb9b0] font-mono">Syncing section block circuits...</p>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-[#acb9b0] bg-[#111816] px-2.5 py-1.5 rounded border border-[#344039]">
            <span>Active movements: <strong className="text-white">{trackStatus.active_movements ?? 0}</strong></span>
            <span>{entries.length} circuits</span>
          </div>

          {entries.length === 0 ? (
            <p className="text-xs text-[#acb9b0] font-mono">All interlocking blocks clear.</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {entries.slice(0, 10).map(([trackKey, info]) => {
                let isOccupied = false;
                let trainId: string | null = null;

                if (typeof info === 'object' && info !== null) {
                  const record = info as Record<string, unknown>;
                  isOccupied = record.status === 'occupied' || Boolean(record.train_id) || (Array.isArray(record.trains) && record.trains.length > 0);
                  trainId = record.train_id
                    ? String(record.train_id)
                    : Array.isArray(record.trains) && record.trains.length > 0
                      ? String(record.trains[0])
                      : null;
                } else if (typeof info === 'string') {
                  isOccupied = info.toLowerCase().includes('occupied');
                }

                const cleanTrack = trackKey.replace(/->/g, ' to ').replace(/_/g, ' ');

                return (
                  <div
                    key={trackKey}
                    className="flex items-center justify-between rounded border border-[#344039] bg-[#111816] px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-medium text-[#f1f5ef] truncate max-w-[150px]">
                      {cleanTrack}
                    </span>
                    {isOccupied ? (
                      <span className="flex items-center gap-1.5 text-xs text-[#9ac4fb] bg-[#9ac4fb]/15 border border-[#9ac4fb]/30 px-2 py-0.5 rounded">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#9ac4fb]" />
                        {trainId ? `Occupied (${trainId})` : 'Occupied'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-[#9be7be] bg-[#9be7be]/15 border border-[#9be7be]/30 px-2 py-0.5 rounded">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#9be7be]" />
                        Clear
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
