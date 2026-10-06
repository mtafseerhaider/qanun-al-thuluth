import { cityCoordinates } from '@shared/prayer/cities';
import { defaultMethodFor } from '@shared/prayer/methods';
import { fastingTimes, formatLocalTime } from '@shared/prayer/times';

/**
 * Suhoor end and iftar for the household's city (FR-FAST-05) from the shared prayer module
 * (`packages/shared/src/prayer`, 24 S4-10). Method defaults per country and tradition (Karachi
 * University for Pakistan, Ja'fari for a Shia preference). Null when the city is unknown.
 */
export interface DayFastingTimes {
  suhoorEnd: string;
  iftar: string;
  /** Instants (ISO) for the timer and the default started_at / ended_at of a log. */
  fajrIso: string;
  maghribIso: string;
}

export function householdFastingTimes(
  date: string,
  household: { city: string | null; country_code: string | null; timezone: string | null } | null,
  tradition: 'shared' | 'sunni' | 'shia' = 'shared',
): DayFastingTimes | null {
  if (!household) return null;
  const city = cityCoordinates(household.city, household.country_code);
  if (!city) return null;
  try {
    const { method, asr } = defaultMethodFor(household.country_code, tradition);
    const t = fastingTimes(date, city, { method, asr });
    const tz = household.timezone ?? city.timeZone;
    return {
      suhoorEnd: formatLocalTime(t.suhoor_end, tz),
      iftar: formatLocalTime(t.iftar, tz),
      fajrIso: t.suhoor_end.toISOString(),
      maghribIso: t.iftar.toISOString(),
    };
  } catch {
    return null;
  }
}

/** Progress of today's fast from Fajr to Maghrib (0..1) and minutes left, or null outside it. */
export function fastProgress(
  times: Pick<DayFastingTimes, 'fajrIso' | 'maghribIso'>,
  now: Date,
): { progress: number; minutesLeft: number } | null {
  const start = Date.parse(times.fajrIso);
  const end = Date.parse(times.maghribIso);
  const t = now.getTime();
  if (!(end > start) || t < start || t > end) return null;
  return { progress: (t - start) / (end - start), minutesLeft: Math.ceil((end - t) / 60_000) };
}
