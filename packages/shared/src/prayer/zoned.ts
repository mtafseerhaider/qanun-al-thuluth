/**
 * Wall-clock helpers for IANA time zones, built on `Intl` only (Deno, Node and Hermes with Intl).
 * Notifications and prayer schedules store local `HH:mm` and `YYYY-MM-DD` values; these convert
 * them to UTC instants and back without a time-zone library.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (Asia/Karachi: +300). */
export function timeZoneOffsetMin(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** Local calendar date (`YYYY-MM-DD`) of an instant in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  const w = wallClock(instant, timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** Minutes since local midnight of an instant in `timeZone`. */
export function localMinutes(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return w.hour * 60 + w.minute;
}

/** Parses `HH:mm` (or `HH:mm:ss`) to minutes since midnight; null when malformed. */
export function parseHhmm(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * The UTC instant of a local wall-clock time. In a DST gap the time is moved forward by the gap;
 * in a DST overlap the earlier instant is returned.
 */
export function zonedTimeToInstant(date: string, hhmm: string, timeZone: string): Date {
  const minutes = parseHhmm(hhmm);
  const [y, m, d] = date.split('-').map(Number);
  if (minutes === null || !y || !m || !d) throw new Error(`Invalid local time ${date} ${hhmm}`);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  // Candidate offsets: those in force half a day either side cover any single DST transition.
  const offsets = new Set(
    [-12, 0, 12].map((h) => timeZoneOffsetMin(new Date(naive + h * 3_600_000), timeZone)),
  );
  const candidates = [...offsets].map((o) => naive - o * 60_000);
  const matches = candidates.filter(
    (t) =>
      localMinutes(new Date(t), timeZone) === minutes && localDate(new Date(t), timeZone) === date,
  );
  return new Date(matches.length ? Math.min(...matches) : Math.max(...candidates));
}
