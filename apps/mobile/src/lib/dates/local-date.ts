/**
 * Household-local calendar dates (`YYYY-MM-DD`, 02 §3.3: dates are in the household time zone).
 * Pure helpers with a device-time fallback when the time zone is unknown or unsupported.
 */
export type IsoDate = string;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function deviceIsoDate(now: Date): IsoDate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Today's date in `timeZone` (IANA), e.g. 'Asia/Karachi'. */
export function localIsoDate(timeZone: string | null | undefined, now: Date = new Date()): IsoDate {
  if (!timeZone) return deviceIsoDate(now);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get('year');
    const m = get('month');
    const d = get('day');
    return y && m && d ? `${y}-${m}-${d}` : deviceIsoDate(now);
  } catch {
    return deviceIsoDate(now);
  }
}

/** Minutes since midnight in `timeZone`. */
export function localMinutes(timeZone: string | null | undefined, now: Date = new Date()): number {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
      const h = Number(parts.find((p) => p.type === 'hour')?.value);
      const m = Number(parts.find((p) => p.type === 'minute')?.value);
      if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
    } catch {
      // fall through to device time
    }
  }
  return now.getHours() * 60 + now.getMinutes();
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 'HH:mm:ss' or 'HH:mm' to minutes since midnight; null when absent or malformed. */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 'HH:mm' for display; digits stay Western (03 §5.5). */
export function formatTime(time: string | null | undefined): string | null {
  const minutes = timeToMinutes(time);
  if (minutes === null) return null;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Day of week 0 (Sunday) to 6 for an ISO date, independent of the device zone. */
export function weekday(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** A stable day number (days since 1970-01-01) for rotation, e.g. the tip of the day. */
export function dayNumber(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
