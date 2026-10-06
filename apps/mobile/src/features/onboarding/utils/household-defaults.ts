import { toMinor } from '@shared';

/**
 * Country, currency and time-zone defaults for onboarding step 3 (02 §7.3.1, 24 S1-10). Launch market
 * is Pakistan, so anything unknown falls back to Pakistan, PKR and Asia/Karachi.
 */
export const COUNTRIES = ['PK', 'AE', 'SA', 'GB', 'US', 'CA'] as const;
export type CountryCode = (typeof COUNTRIES)[number];

export const CURRENCY_FOR_COUNTRY: Record<CountryCode, string> = {
  PK: 'PKR',
  AE: 'AED',
  SA: 'SAR',
  GB: 'GBP',
  US: 'USD',
  CA: 'CAD',
};

export const DEFAULT_TIMEZONE_FOR_COUNTRY: Record<CountryCode, string> = {
  PK: 'Asia/Karachi',
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  GB: 'Europe/London',
  US: 'America/New_York',
  CA: 'America/Toronto',
};

export const CITY_SUGGESTIONS: Partial<Record<CountryCode, readonly string[]>> = {
  PK: ['Lahore', 'Karachi', 'Islamabad'],
};

export function isCountryCode(code: string | null | undefined): code is CountryCode {
  return !!code && (COUNTRIES as readonly string[]).includes(code);
}

export function isValidTimeZone(tz: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz.trim())) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/** Device region and zone to defaults. A device zone is kept only when it fits the country. */
export function householdDefaults(device: {
  regionCode?: string | null;
  timeZone?: string | null;
}): { country_code: CountryCode; currency: string; timezone: string } {
  const country = isCountryCode(device.regionCode) ? device.regionCode : 'PK';
  const deviceTz = device.timeZone && isValidTimeZone(device.timeZone) ? device.timeZone : null;
  const timezone = country === 'PK' || !deviceTz ? DEFAULT_TIMEZONE_FOR_COUNTRY[country] : deviceTz;
  return { country_code: country, currency: CURRENCY_FOR_COUNTRY[country], timezone };
}

export type HouseholdField = 'name' | 'city' | 'timezone' | 'budget';
export type HouseholdErrorKey =
  'nameRequired' | 'nameTooLong' | 'cityTooLong' | 'timezoneInvalid' | 'budgetInvalid';

const MAX_BUDGET_MAJOR = 10_000_000;

/** Parses the optional budget (major units) to minor units; '' is "no budget". */
/** Parses the optional budget (major units) to minor units; '' is "no budget". */
export function parseBudget(text: string, currency: string): number | null | 'invalid' {
  const trimmed = text.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_BUDGET_MAJOR) return 'invalid';
  return toMinor(n, currency);
}

export function validateHouseholdDraft(d: {
  name: string;
  city: string;
  timezone: string;
  currency: string;
  budgetMajor: string;
}): Partial<Record<HouseholdField, HouseholdErrorKey>> {
  const errors: Partial<Record<HouseholdField, HouseholdErrorKey>> = {};
  const name = d.name.trim();
  if (!name) errors.name = 'nameRequired';
  else if (name.length > 40) errors.name = 'nameTooLong';
  if (d.city.trim().length > 60) errors.city = 'cityTooLong';
  if (!isValidTimeZone(d.timezone)) errors.timezone = 'timezoneInvalid';
  if (parseBudget(d.budgetMajor, d.currency) === 'invalid') errors.budget = 'budgetInvalid';
  return errors;
}
