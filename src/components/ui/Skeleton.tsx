import * as React from 'react';
import { cn } from '../../lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded bg-[#344039]/60', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export function KpiSkeleton() {
  return (
    <div className="flex gap-4 mb-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex-1">
          <Skeleton className="h-3 w-20 mb-2" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-label="Loading schedule">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function MapSkeleton() {
  return (
    <div className="h-[280px] rounded border border-[#344039] bg-[#111816] p-4">
      <Skeleton className="h-full w-full" />
    </div>
  );
}
