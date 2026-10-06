import * as Crypto from 'expo-crypto';

/** Client row id: a retried save upserts the same row (05 §8 rows are keyed by uuid). */
export const newRowId = (): string => Crypto.randomUUID();

/** Parses a user-typed number in en or ur digits; returns undefined when empty or invalid. */
export function parseNumber(text: string): number | undefined {
  const western = text
    .trim()
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(',', '.');
  if (western === '') return undefined;
  const n = Number(western);
  return Number.isFinite(n) ? n : undefined;
}

export const parseInteger = (text: string): number | undefined => {
  const n = parseNumber(text);
  return n === undefined ? undefined : Math.round(n);
};

export const numberText = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : String(n);

export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
