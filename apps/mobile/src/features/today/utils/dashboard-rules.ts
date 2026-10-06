/**
 * Today dashboard helpers (02 §7.5.1, 24 S3-11). Pure so they are unit-tested without rendering.
 */
export type Greeting = 'morning' | 'afternoon' | 'evening';

export function greetingFor(minutesOfDay: number): Greeting {
  if (minutesOfDay < 12 * 60) return 'morning';
  if (minutesOfDay < 17 * 60) return 'afternoon';
  return 'evening';
}

/** Gregorian date in the UI locale for the household day ('YYYY-MM-DD'). */
export function formatLongDate(isoDate: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${isoDate}T12:00:00Z`));
  } catch {
    return isoDate;
  }
}

/**
 * Hijri date through Intl's islamic-umalqura calendar; null where the runtime has no support (some
 * Android Hermes builds without full ICU). Approximate: local moon sighting may differ by a day.
 */
export function formatHijriDate(isoDate: string, locale: string): string | null {
  try {
    const fmt = new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura`, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    if (!fmt.resolvedOptions().calendar.startsWith('islamic')) return null;
    return fmt.format(new Date(`${isoDate}T12:00:00Z`));
  } catch {
    return null;
  }
}

/** Rotates through the verified recommendation ids by day number; null with none. */
export function tipForDay<T>(ids: readonly T[], dayNumber: number): T | null {
  if (ids.length === 0) return null;
  const i = ((dayNumber % ids.length) + ids.length) % ids.length;
  return ids[i] ?? null;
}

/** "HH:mm" of a timestamp in the device time zone, for "Updated 14:05" while offline. */
export function formatUpdatedAt(ms: number): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
