import type { Coordinates } from './times.ts';

/**
 * City centre coordinates for prayer times until households store their own (15 §5.2 geocodes
 * `households.city` at onboarding; no column exists yet). Keys are lower-case city names and
 * common spellings. Coordinates: city centres, rounded to 4 decimals (GeoNames).
 */
export interface CityInfo extends Coordinates {
  name: string;
  country: string;
  timeZone: string;
}

const PK = (name: string, latitude: number, longitude: number): CityInfo => ({
  name,
  country: 'PK',
  latitude,
  longitude,
  timeZone: 'Asia/Karachi',
});

export const CITIES: Record<string, CityInfo> = {
  lahore: PK('Lahore', 31.5204, 74.3587),
  karachi: PK('Karachi', 24.8607, 67.0011),
  islamabad: PK('Islamabad', 33.6844, 73.0479),
  rawalpindi: PK('Rawalpindi', 33.5651, 73.0169),
  faisalabad: PK('Faisalabad', 31.4504, 73.135),
  multan: PK('Multan', 30.1575, 71.5249),
  peshawar: PK('Peshawar', 34.0151, 71.5249),
  quetta: PK('Quetta', 30.1798, 66.975),
  hyderabad: PK('Hyderabad', 25.396, 68.3578),
  gujranwala: PK('Gujranwala', 32.1877, 74.1945),
  sialkot: PK('Sialkot', 32.4945, 74.5229),
  london: {
    name: 'London',
    country: 'GB',
    latitude: 51.5074,
    longitude: -0.1278,
    timeZone: 'Europe/London',
  },
  birmingham: {
    name: 'Birmingham',
    country: 'GB',
    latitude: 52.4862,
    longitude: -1.8904,
    timeZone: 'Europe/London',
  },
  manchester: {
    name: 'Manchester',
    country: 'GB',
    latitude: 53.4808,
    longitude: -2.2426,
    timeZone: 'Europe/London',
  },
  dubai: {
    name: 'Dubai',
    country: 'AE',
    latitude: 25.2048,
    longitude: 55.2708,
    timeZone: 'Asia/Dubai',
  },
  riyadh: {
    name: 'Riyadh',
    country: 'SA',
    latitude: 24.7136,
    longitude: 46.6753,
    timeZone: 'Asia/Riyadh',
  },
  makkah: {
    name: 'Makkah',
    country: 'SA',
    latitude: 21.4225,
    longitude: 39.8262,
    timeZone: 'Asia/Riyadh',
  },
};

const ALIASES: Record<string, string> = {
  lhr: 'lahore',
  khi: 'karachi',
  isb: 'islamabad',
  pindi: 'rawalpindi',
  'islamabad/rawalpindi': 'islamabad',
  lyallpur: 'faisalabad',
  mecca: 'makkah',
};

/** Country capital or largest city, used when the household city is unknown. */
const COUNTRY_FALLBACK: Record<string, string> = {
  PK: 'lahore',
  GB: 'london',
  AE: 'dubai',
  SA: 'riyadh',
};

export function cityCoordinates(
  city: string | null | undefined,
  countryCode?: string | null,
): CityInfo | null {
  const key = (city ?? '').trim().toLowerCase();
  const found = CITIES[ALIASES[key] ?? key];
  if (found) return found;
  const fallback = COUNTRY_FALLBACK[(countryCode ?? '').toUpperCase()];
  return fallback ? (CITIES[fallback] ?? null) : null;
}
