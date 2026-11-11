import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button';

interface OperationsPanelProps {
  activeDelayCount: number;
  selectedTrainId?: string | null;
  onManualOverride: () => void;
  onClearDelays: () => void;
}

export function OperationsPanel({
  activeDelayCount,
  selectedTrainId,
  onManualOverride,
  onClearDelays,
}: OperationsPanelProps) {
  return (
    <div className="space-y-3 pt-3 border-t border-[#344039]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#acb9b0]">
          Dispatch controls
        </span>
        {selectedTrainId ? (
          <span className="text-xs text-white bg-[#111816] px-2 py-0.5 rounded border border-[#344039]">
            Selected: {selectedTrainId}
          </span>
        ) : (
          <span className="text-xs text-[#acb9b0] font-mono">Select a train to override</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          className="w-full justify-center text-xs font-medium py-1.5"
          onClick={onManualOverride}
        >
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1 text-[#acb9b0]" />
          {selectedTrainId ? 'Override platform' : 'Select train'}
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-center text-xs font-medium py-1.5 border border-[#344039] bg-[#111816] hover:bg-[#233128]"
          onClick={onClearDelays}
          disabled={activeDelayCount === 0}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1 text-[#acb9b0]" />
          Clear delays ({activeDelayCount})
        </Button>
      </div>
    </div>
  );
}
