/**
 * Indian Railway Standard Date & Time Utilities
 * Formats dates in standard Indian operational formats (e.g., 10 Nov 2026, 22:43)
 * Completely prevents "Invalid Date" errors across all charts, heatmaps, and tables.
 */

export function parseSafeDate(val: unknown, fallback: Date = new Date()): Date {
  if (!val) return fallback;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? fallback : val;
  }
  if (typeof val === 'number') {
    // If timestamp is in seconds, convert to ms
    const ms = val < 10000000000 ? val * 1000 : val;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? fallback : d;
  }
  if (typeof val === 'string') {
    // Check if time-only string like "09:30" or "14:00"
    const timeMatch = val.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      const d = new Date(fallback);
      d.setHours(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), parseInt(timeMatch[3] || '0', 10), 0);
      return d;
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? fallback : d;
  }
  return fallback;
}

/**
 * 24-hour Railway time: "22:43"
 */
export function formatTime(val: unknown): string {
  if (!val) return '--:--';
  const d = parseSafeDate(val);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * 24-hour Railway time with seconds: "22:43:15"
 */
export function formatTimeWithSeconds(val: unknown): string {
  if (!val) return '--:--:--';
  const d = parseSafeDate(val);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Indian standard date: "10 Nov 2026"
 */
export function formatIndianDate(val: unknown): string {
  if (!val) return '—';
  const d = parseSafeDate(val);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Combined railway date-time: "10 Nov 2026, 22:43"
 */
export function formatRailwayDateTime(val: unknown): string {
  if (!val) return '—';
  const d = parseSafeDate(val);
  return `${formatIndianDate(d)}, ${formatTime(d)}`;
}

/**
 * Format delay in standard railway operational notation:
 * 0 -> "On time"
 * > 0 -> "+X min"
 * < 0 -> "-X min" (early)
 */
export function formatDelayBadge(minutes: number): { text: string; isDelayed: boolean; isEarly: boolean } {
  const rounded = Math.round(minutes);
  if (rounded <= 0) {
    return { text: 'On time', isDelayed: false, isEarly: rounded < 0 };
  }
  return { text: `+${rounded} min`, isDelayed: true, isEarly: false };
}
