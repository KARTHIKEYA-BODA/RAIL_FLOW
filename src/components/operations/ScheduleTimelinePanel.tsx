import type { TrainPosition } from './NetworkMap';
import type { ConflictItem, ScheduleEntry, Station, Train } from '../../types/railway';
import { TrainGraph } from './TrainGraph';
import { SectionCard } from '../layout/SectionCard';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

interface ScheduleTimelinePanelProps {
  beforeEntries: ScheduleEntry[];
  afterEntries: ScheduleEntry[];
  stations: Station[];
  trains: Train[];
  conflicts: ConflictItem[];
  trainPositions?: TrainPosition[];
  now: Date;
  animTick: number;
  onEntryClick: (entry: ScheduleEntry) => void;
}

export function ScheduleTimelinePanel({
  beforeEntries,
  afterEntries,
  stations,
  trains,
  conflicts,
  trainPositions = [],
  now,
  animTick,
  onEntryClick,
}: ScheduleTimelinePanelProps) {
  const changedTrains = new Set<string>();
  afterEntries.forEach((after) => {
    const before = beforeEntries.find(
      (b) => b.train_id === after.train_id && b.station_id === after.station_id
    );
    if (
      before &&
      (before.assigned_platform !== after.assigned_platform ||
        before.actual_arrival !== after.actual_arrival ||
        before.actual_departure !== after.actual_departure)
    ) {
      changedTrains.add(after.train_id);
    }
  });

  return (
    <SectionCard
      title="Platform timeline"
      subtitle="Compare platform bookings with the baseline timetable."
    >
      {/* Plain Language Status Summary */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-[#344039] bg-[#111816] p-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-white font-medium">
            <span className="text-[#acb9b0]">Changes vs baseline:</span>
            <span className={`font-medium px-1.5 py-0.5 rounded ${changedTrains.size > 0 ? 'bg-[#f2c278]/15 text-[#f2c278] border border-[#f2c278]/30' : 'bg-[#1a231f] text-white border border-[#344039]'}`}>
              {changedTrains.size}
            </span>
          </div>

          <span className="text-[#344039]">|</span>

          <span className="text-[#acb9b0]">
            {trains.length} monitored trains, {afterEntries.length} scheduled stops
          </span>
        </div>

        {changedTrains.size > 0 ? (
          <div className="flex items-center gap-1.5 text-[#f2c278]">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Modified: {Array.from(changedTrains).join(', ')}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[#9be7be]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Schedule aligned with master timetable</span>
          </div>
        )}
      </div>

      <TrainGraph
        baselineEntries={beforeEntries}
        actualEntries={afterEntries}
        stations={stations}
        trains={trains}
        conflicts={conflicts}
        trainPositions={trainPositions}
        now={now}
        animTick={animTick}
        onEntryClick={onEntryClick}
      />
    </SectionCard>
  );
}
