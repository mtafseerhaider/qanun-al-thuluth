import { useTranslation } from 'react-i18next';

import { scriptForLocale, type UiScript } from '@/theme/fonts';

/** Which UI font family set (Inter or Noto Nastaliq Urdu) the active language needs. */
export function useUiScript(): UiScript {
  const { i18n } = useTranslation();
  return scriptForLocale(i18n.language ?? 'en');
}
