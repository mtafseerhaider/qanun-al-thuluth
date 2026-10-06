export const SUPPORTED_LOCALES = ['en', 'ur'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const RTL_LOCALES: readonly SupportedLocale[] = ['ur'];
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export function isRtlLocale(locale: string): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}
