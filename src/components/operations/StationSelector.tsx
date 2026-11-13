import { useRef } from 'react';

const STATIONS = [
  ['SC', 'Secunderabad Junction'], ['KCG', 'Kacheguda'], ['MJF', 'Malkajgiri Junction'],
  ['BMO', 'Bolarum'], ['MED', 'Medchal'], ['MOB', 'Manoharabad Junction'],
  ['ME', 'Masaipet'], ['WDR', 'Wadiaram'],
] as const;

export function StationSelector({ id, value, onChange, allowed, label, disabled = false }: { id: string; value: string; onChange: (value: string) => void; allowed?: string[]; label?: string; disabled?: boolean }) {
  const details = useRef<HTMLDetailsElement>(null);
  const currentName = STATIONS.find(([code]) => code === value)?.[1] ?? value;
  return <details className="station-selector" ref={details} onKeyDown={e => {
    if (e.key === 'Escape' && details.current?.open) { details.current.open = false; details.current.querySelector('summary')?.focus(); }
  }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }}>
    <summary id={id} aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault(); }} aria-label={`${label || (id === 'between-from' ? 'From' : 'To')} station: ${currentName} (${value})`} title={currentName}>{value}<span aria-hidden="true">⌄</span></summary>
    <div className="station-selector-options" aria-label="Station choices">
      {STATIONS.filter(([code]) => !allowed || allowed.includes(code)).map(([code, name]) => <button key={code} type="button" disabled={disabled} aria-label={`${code} — ${name}`} aria-current={value === code ? 'true' : undefined} onClick={() => { onChange(code); if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } }}><span>{code}</span><span className="station-full-name" aria-hidden="true">{name}</span></button>)}
    </div>
  </details>;
}
