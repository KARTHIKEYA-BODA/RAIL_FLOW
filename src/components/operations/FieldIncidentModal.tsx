import { useState, type FormEvent } from 'react';
import {
  ShieldAlert,
  X,
  Send,
  Calculator,
  Ban,
} from 'lucide-react';
import { useOperationsFeed } from '../../context/OperationsFeedContext';
import { notify } from '../../lib/notify';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Input } from '../ui/input';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FieldIncidentModal({ open, onClose }: Props) {
  const feed = useOperationsFeed();
  const [activeTab, setActiveTab] = useState<'tsr' | 'platform' | 'report'>('tsr');

  // TSR calculation state
  const [sector, setSector] = useState('SC South throat (KM 11.2 – 11.8)');
  const nominalSpeed = 90;
  const [restrictedSpeed, setRestrictedSpeed] = useState(30);
  const zoneLengthKm = 1.2;

  // Platform closure state
  const [closeStation, setCloseStation] = useState('SC');
  const [closePlatform, setClosePlatform] = useState(1);
  const [closureReason, setClosureReason] = useState('Emergency track ballast repair');

  // Field memo state
  const [memoText, setMemoText] = useState('');

  if (!open) return null;

  // Kinematic formula for TSR delay:
  // Delta T = (Distance / V_restr - Distance / V_nom) * 60 + Accel/Decel loss (~1.2 min)
  const timeNominalMin = (zoneLengthKm / nominalSpeed) * 60;
  const timeRestrictedMin = (zoneLengthKm / restrictedSpeed) * 60;
  const accelLossMin = 1.2;
  const delayDeltaMin = Math.max(0, Number(((timeRestrictedMin - timeNominalMin) + accelLossMin).toFixed(1)));

  const handleApplyTsr = () => {
    const desc = `TSR-14 Issued: ${sector} restricted to ${restrictedSpeed} km/h (nominal ${nominalSpeed} km/h). Projected delay: +${delayDeltaMin} min per rake.`;
    feed.recordEvent('Caution Order (TSR-14)', desc);
    feed.addShiftNote(desc);
    notify.success('TSR-14 Caution Order Issued', `+${delayDeltaMin} min kinematic delay logged.`);
    onClose();
  };

  const handleTogglePlatformClosure = () => {
    const isCurrentlyBlocked = feed.blockedPlatforms.includes(`${closeStation}-${closePlatform}`);
    feed.setPlatformService(closeStation, closePlatform, !isCurrentlyBlocked);
    const action = !isCurrentlyBlocked ? 'taken out of service' : 'returned to service';
    notify.info(`Platform ${closeStation} P${closePlatform} ${action}`, closureReason);
    onClose();
  };

  const handlePostMemo = (e: FormEvent) => {
    e.preventDefault();
    if (!memoText.trim()) return;
    feed.recordEvent('Field Observation', memoText.trim());
    feed.addShiftNote(memoText.trim());
    notify.success('Field report recorded in operations log');
    setMemoText('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="field-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-[#2A323C] bg-[#14181D] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2A323C] bg-[#1B2027] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#2A323C] bg-[#14181D] text-[#E0A030]">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 id="field-modal-title" className="text-base font-semibold text-[#E6E9ED]">
                Field Incidents &amp; Caution Orders
              </h2>
              <p className="text-xs text-[#9AA4B0]">
                Kinematic speed restrictions, emergency platform closures, and field logs.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#9AA4B0] hover:text-white hover:bg-[#2A323C] transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#2A323C] bg-[#14181D] px-6 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('tsr')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-md transition-colors ${
              activeTab === 'tsr'
                ? 'bg-[#1B2027] text-white border-t border-x border-[#2A323C]'
                : 'text-[#9AA4B0] hover:text-white'
            }`}
          >
            TSR-14 Speed Restriction
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('platform')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-md transition-colors ${
              activeTab === 'platform'
                ? 'bg-[#1B2027] text-white border-t border-x border-[#2A323C]'
                : 'text-[#9AA4B0] hover:text-white'
            }`}
          >
            Platform Berth Closure
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('report')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-md transition-colors ${
              activeTab === 'report'
                ? 'bg-[#1B2027] text-white border-t border-x border-[#2A323C]'
                : 'text-[#9AA4B0] hover:text-white'
            }`}
          >
            Field Observation Log
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {activeTab === 'tsr' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-[#9AA4B0] mb-1">
                    Sector / Throat
                  </label>
                  <select
                    value={sector}
                    onChange={(e) => setSector(e.target.value)}
                    className="w-full rounded-lg border border-[#2A323C] bg-[#1B2027] p-2 text-xs text-[#E6E9ED] focus:border-[#5B9BD5] focus:outline-none"
                  >
                    <option value="SC South throat (KM 11.2 – 11.8)">Secunderabad South throat (KM 11.2 – 11.8)</option>
                    <option value="HYB Junction throat (KM 2.1 – 2.9)">Hyderabad Deccan Junction throat (KM 2.1 – 2.9)</option>
                    <option value="SC to KCG Inter-station line (KM 5.0 – 6.5)">SC to KCG Inter-station curve (KM 5.0 – 6.5)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-[#9AA4B0] mb-1">
                    Restricted Speed (km/h)
                  </label>
                  <select
                    value={restrictedSpeed}
                    onChange={(e) => setRestrictedSpeed(Number(e.target.value))}
                    className="w-full rounded-lg border border-[#2A323C] bg-[#1B2027] p-2 text-xs text-[#E6E9ED] focus:border-[#5B9BD5] focus:outline-none"
                  >
                    <option value={15}>15 km/h (Dead Slow / Track Inspection)</option>
                    <option value={30}>30 km/h (Ballast Tamping / Monsoon)</option>
                    <option value={45}>45 km/h (Turnout Geometry Caution)</option>
                  </select>
                </div>
              </div>

              {/* Kinematic Calculation Display */}
              <div className="rounded-lg border border-[#2A323C] bg-[#1B2027] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Calculator className="h-4 w-4 text-[#5B9BD5]" />
                    Kinematic Delay Calculation
                  </span>
                  <Badge variant="outline" className="text-[#E0A030] border-[#E0A030]/40">
                    +{delayDeltaMin} min per train
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-[#2A323C]">
                  <div>
                    <span className="text-[10px] uppercase text-[#9AA4B0] block">Nominal Speed</span>
                    <strong className="text-sm font-mono text-white">{nominalSpeed} km/h</strong>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-[#9AA4B0] block">Restricted Speed</span>
                    <strong className="text-sm font-mono text-[#E0A030]">{restrictedSpeed} km/h</strong>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-[#9AA4B0] block">Length of Zone</span>
                    <strong className="text-sm font-mono text-white">{zoneLengthKm} km</strong>
                  </div>
                </div>

                <p className="text-[11px] text-[#9AA4B0] leading-relaxed pt-1">
                  Accounting for deceleration entry curves and acceleration exit penalties (+1.2 min standard Kavach braking profile).
                </p>
              </div>

              <div className="flex justify-end">
                <Button variant="default" size="sm" onClick={handleApplyTsr} className="gap-2">
                  <Send className="h-3.5 w-3.5" />
                  Issue TSR-14 Caution Order
                </Button>
              </div>
            </div>
          )}

          {activeTab === 'platform' && (
            <div className="space-y-4">
              <p className="text-[#9AA4B0]">
                Declare an emergency platform berth outage to divert oncoming traffic:
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-[#9AA4B0] mb-1">
                    Station
                  </label>
                  <select
                    value={closeStation}
                    onChange={(e) => setCloseStation(e.target.value)}
                    className="w-full rounded-lg border border-[#2A323C] bg-[#1B2027] p-2 text-xs text-[#E6E9ED]"
                  >
                    <option value="SC">Secunderabad Junction (SC)</option>
                    <option value="HYB">Hyderabad Deccan (HYB)</option>
                    <option value="KCG">Kacheguda (KCG)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-[#9AA4B0] mb-1">
                    Platform Number
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={closeStation === 'SC' ? 6 : closeStation === 'HYB' ? 4 : 3}
                    value={closePlatform}
                    onChange={(e) => setClosePlatform(Number(e.target.value))}
                    className="bg-[#1B2027] border-[#2A323C]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-[#9AA4B0] mb-1">
                  Closure Reason
                </label>
                <Input
                  type="text"
                  value={closureReason}
                  onChange={(e) => setClosureReason(e.target.value)}
                  placeholder="e.g. Signal track circuit failure, rail crack inspection"
                  className="bg-[#1B2027] border-[#2A323C]"
                />
              </div>

              {feed.blockedPlatforms.length > 0 && (
                <div className="rounded-lg border border-[#E5484D]/40 bg-[#E5484D]/10 p-3 text-xs">
                  <span className="font-semibold text-[#E5484D] block mb-1">Currently Out of Service:</span>
                  <div className="flex gap-2 flex-wrap">
                    {feed.blockedPlatforms.map(bp => (
                      <Badge key={bp} variant="destructive">
                        {bp}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  variant={feed.blockedPlatforms.includes(`${closeStation}-${closePlatform}`) ? 'outline' : 'destructive'}
                  size="sm"
                  onClick={handleTogglePlatformClosure}
                  className="gap-2"
                >
                  <Ban className="h-3.5 w-3.5" />
                  {feed.blockedPlatforms.includes(`${closeStation}-${closePlatform}`)
                    ? `Restore Platform ${closeStation} P${closePlatform}`
                    : `Close Platform ${closeStation} P${closePlatform}`}
                </Button>
              </div>
            </div>
          )}

          {activeTab === 'report' && (
            <form onSubmit={handlePostMemo} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-[#9AA4B0] mb-1">
                  Report Field Observation / Controller Log
                </label>
                <textarea
                  rows={4}
                  value={memoText}
                  onChange={(e) => setMemoText(e.target.value)}
                  placeholder="Enter observation from station master, driver, or track inspector (e.g. Loco pilot T104 reported heavy rain at Moula Ali approach)..."
                  className="w-full rounded-lg border border-[#2A323C] bg-[#1B2027] p-3 text-xs text-[#E6E9ED] placeholder-[#6C7684] focus:border-[#5B9BD5] focus:outline-none"
                />
              </div>

              <div className="flex justify-end">
                <Button variant="default" size="sm" type="submit" disabled={!memoText.trim()} className="gap-2">
                  <Send className="h-3.5 w-3.5" />
                  Submit Field Memo
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end border-t border-[#2A323C] bg-[#1B2027] px-6 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
