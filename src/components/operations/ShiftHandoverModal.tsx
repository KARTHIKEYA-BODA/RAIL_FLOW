import React, { useState } from 'react';
import {
  FileText,
  AlertTriangle,
  Clock,
  X,
  UserCheck,
  Send,
  Lock,
  ClipboardList,
} from 'lucide-react';
import { useOperationsFeed } from '../../context/OperationsFeedContext';
import { formatIndianDate, formatRailwayDateTime } from '../../lib/dateTimeUtils';
import { notify } from '../../lib/notify';
import { Button } from '../ui/Button';
import { Input } from '../ui/input';
import { Badge } from '../ui/Badge';

interface ShiftHandoverModalProps {
  open: boolean;
  onClose: () => void;
  controllerName?: string;
}

export function ShiftHandoverModal({
  open,
  onClose,
  controllerName = 'Duty Controller (Desk 4)',
}: ShiftHandoverModalProps) {
  const {
    conflictCount,
    activeDelays,
    trains,
    schedule,
    shiftNotes,
    addShiftNote,
    logs,
  } = useOperationsFeed();

  const [newNote, setNewNote] = useState('');
  const [signedOff, setSignedOff] = useState(false);
  const isSubmitting = false;
  const [reliefController, setReliefController] = useState('Relief Controller (Desk 4)');

  if (!open) return null;

  const todayStr = formatIndianDate(new Date());

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    addShiftNote(newNote.trim());
    setNewNote('');
    notify.success('Shift note added');
  };

  const handleCompleteHandover = () => {
    if (!signedOff || !reliefController.trim()) return;
    addShiftNote('Handover to ' + reliefController.trim() + ' recorded at ' + formatRailwayDateTime(new Date()));
    setSignedOff(false);
    notify.success('Handover recorded in this session');
    onClose();
  };

  // Inspect manual platform overrides from recent logs
  const overrideLogs = logs.filter(
    (l) => l.action.toLowerCase().includes('override') || l.action.toLowerCase().includes('reassign')
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Shift Handover Briefing"
    >
      <div className="w-full max-w-3xl rounded-xl border border-[#344039] bg-[#111816] shadow-2xl overflow-hidden my-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#344039] bg-[#1a231f] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#9ac4fb]/10 border border-[#9ac4fb]/30 text-[#9ac4fb]">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#f1f5ef]">
                  OCC Shift Handover Briefing
                </h2>
                <Badge variant="outline" className="text-[11px] text-[#9be7be] border-[#9be7be]/40 bg-[#9be7be]/10">
                  Form OCC-7A
                </Badge>
              </div>
              <p className="text-xs text-[#acb9b0] mt-0.5">
                South Central Railway · Hyderabad Control Division · Desk 4
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#acb9b0] hover:text-white hover:bg-[#344039] transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Metadata Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3.5">
              <span className="text-[11px] uppercase font-semibold text-[#acb9b0] block mb-1">
                Outgoing Controller
              </span>
              <span className="text-xs font-semibold text-white block">
                {controllerName}
              </span>
              <span className="text-[11px] text-[#acb9b0] mt-1 block">
                Shift B (14:00 – 22:00 IST)
              </span>
            </div>

            <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3.5">
              <span className="text-[11px] uppercase font-semibold text-[#acb9b0] block mb-1">
                Relief Controller
              </span>
              <Input
                type="text"
                value={reliefController}
                onChange={(e) => setReliefController(e.target.value)}
                className="h-7 text-xs font-medium text-[#9ac4fb] bg-[#111816] border-[#344039]"
              />
              <span className="text-[11px] text-[#acb9b0] mt-1 block">
                Shift C (22:00 – 06:00 IST)
              </span>
            </div>

            <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3.5">
              <span className="text-[11px] uppercase font-semibold text-[#acb9b0] block mb-1">
                Date & Sector
              </span>
              <span className="text-xs font-semibold text-white block">
                {todayStr}
              </span>
              <span className="text-[11px] text-[#9be7be] mt-1 block">
                HYB · SC · KCG Section
              </span>
            </div>
          </div>

          {/* Corridor State Summary */}
          <div>
            <h3 className="text-xs uppercase font-semibold text-[#acb9b0] tracking-wider mb-2.5 flex items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5 text-[#9ac4fb]" />
              Corridor Status at Handover
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3 text-center">
                <span className="text-[11px] text-[#acb9b0] block">Total Monitored</span>
                <span className="text-lg font-semibold text-white mt-0.5 block font-mono">{trains.length} trains</span>
                <span className="text-[11px] text-[#acb9b0]">{schedule.length} scheduled stops</span>
              </div>

              <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3 text-center">
                <span className="text-[11px] text-[#acb9b0] block">Active Safety Clashes</span>
                <span className={`text-lg font-semibold mt-0.5 block font-mono ${conflictCount > 0 ? 'text-[#ffab9e]' : 'text-[#9be7be]'}`}>
                  {conflictCount}
                </span>
                <span className="text-[11px] text-[#acb9b0]">
                  {conflictCount > 0 ? 'Action required' : 'Clear headway'}
                </span>
              </div>

              <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3 text-center">
                <span className="text-[11px] text-[#acb9b0] block">Active Delays</span>
                <span className="text-lg font-semibold text-[#f2c278] mt-0.5 block font-mono">
                  {activeDelays.length} rakes
                </span>
                <span className="text-[11px] text-[#acb9b0]">Monitored across SC/HYB</span>
              </div>

              <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3 text-center">
                <span className="text-[11px] text-[#acb9b0] block">Headway model</span>
                <span className="text-lg font-semibold text-[#9be7be] mt-0.5 block font-mono">
                  Nominal
                </span>
                <span className="text-[11px] text-[#9be7be]">5m buffer verified</span>
              </div>
            </div>
          </div>

          {/* Active Overrides & Caution Orders */}
          <div>
            <h3 className="text-xs uppercase font-semibold text-[#acb9b0] tracking-wider mb-2.5 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-[#f2c278]" />
              Active Manual Overrides & Caution Orders
            </h3>
            <div className="space-y-2 text-xs">
              <div className="rounded-lg border border-[#f2c278]/30 bg-[#f2c278]/10 p-3 flex items-start gap-3">
                <span className="h-2 w-2 rounded-full bg-[#f2c278] mt-1 shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-200">
                      TSR-14/SC: Temporary Speed Restriction (30 km/h)
                    </span>
                    <span className="text-[11px] font-mono text-amber-300/80">KM 11.2 – 11.8</span>
                  </div>
                  <p className="text-[11px] text-[#acb9b0] mt-0.5">
                    Ballast tamping work underway at Secunderabad South throat. Speed restricted to 30 km/h until 23:30 IST.
                  </p>
                </div>
              </div>

              {overrideLogs.length > 0 ? (
                overrideLogs.slice(0, 2).map((ol, i) => (
                  <div key={i} className="rounded-lg border border-[#344039] bg-[#1a231f] p-3 flex items-start gap-3">
                    <span className="h-2 w-2 rounded-full bg-[#9ac4fb] mt-1 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{ol.action}</span>
                        <span className="text-[11px] font-mono text-[#acb9b0]">{ol.timestamp}</span>
                      </div>
                      <p className="text-[11px] text-[#acb9b0] mt-0.5">{ol.details}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-3 flex items-start gap-3">
                  <span className="h-2 w-2 rounded-full bg-[#9be7be] mt-1 shrink-0" />
                  <div className="flex-1">
                    <span className="font-semibold text-white">No active platform overrides</span>
                    <p className="text-[11px] text-[#acb9b0] mt-0.5">
                      All platform berths following nominal assignments.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Outgoing Controller Handover Notes */}
          <div>
            <h3 className="text-xs uppercase font-semibold text-[#acb9b0] tracking-wider mb-2.5 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-[#9ac4fb]" />
              Outgoing Controller Operational Notes
            </h3>

            {shiftNotes.length > 0 ? (
              <div className="space-y-1.5 mb-3">
                {shiftNotes.map((note, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-[#344039] bg-[#1a231f] px-3 py-2 text-xs flex items-start justify-between gap-2"
                  >
                    <span className="text-[#f1f5ef]">{note}</span>
                    <Badge variant="outline" className="text-[11px] text-[#acb9b0]">Logged</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#acb9b0] mb-3 italic">
                No custom shift notes appended yet.
              </p>
            )}

            <form onSubmit={handleAddNote} className="flex gap-2">
              <Input
                type="text"
                placeholder="Append operational memo (e.g. Loco pilot T104 reported heavy rain at Moula Ali)..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="flex-1 bg-[#1a231f] border-[#344039] text-xs"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="gap-1.5"
              >
                <Send className="h-3 w-3 text-[#9ac4fb]" />
                <span>Add Note</span>
              </Button>
            </form>
          </div>

          {/* Digital Sign-off Confirmation */}
          <div className="rounded-lg border border-[#344039] bg-[#1a231f] p-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="signoff-check"
                checked={signedOff}
                onChange={(e) => setSignedOff(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-[#344039] bg-[#111816] text-[#9ac4fb] focus:ring-[#9ac4fb]"
              />
              <label htmlFor="signoff-check" className="text-xs text-[#f1f5ef] leading-relaxed cursor-pointer">
                <strong>Controller Certification:</strong> I hereby certify that the current corridor occupancy, active speed restrictions, pending safety conflicts, and platform assignments have been briefed in full to the incoming relief controller.
              </label>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-[#344039] bg-[#1a231f] px-6 py-4">
          <div className="flex items-center gap-2 text-[11px] text-[#acb9b0]">
            <Lock className="h-3.5 w-3.5 text-[#9be7be]" />
            <span>Session handover record</span>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant={signedOff ? 'default' : 'secondary'}
              size="sm"
              disabled={!signedOff || !reliefController.trim() || isSubmitting}
              onClick={handleCompleteHandover}
              className="gap-2"
            >
              <UserCheck className="h-4 w-4" />
              <span>{isSubmitting ? 'Transferring Desk…' : 'Sign & Complete Handover'}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
