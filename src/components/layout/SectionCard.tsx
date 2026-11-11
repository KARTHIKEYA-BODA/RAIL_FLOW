import type { ReactNode } from 'react';

interface SectionCardProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
}

export function SectionCard({ title, subtitle, children, className = '', headerAction }: SectionCardProps) {
  return (
    <section className={`section-card rounded-xl border border-[#344039] bg-[#1a231f] p-5 ${className}`}>
      {(title || headerAction) && (
        <div className="mb-3.5 flex items-start justify-between gap-3 border-b border-[#344039] pb-3">
          <div>
            {title && <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>}
            {subtitle && <p className="mt-1 text-sm text-[#acb9b0]">{subtitle}</p>}
          </div>
          {headerAction}
        </div>
      )}
      {children}
    </section>
  );
}
