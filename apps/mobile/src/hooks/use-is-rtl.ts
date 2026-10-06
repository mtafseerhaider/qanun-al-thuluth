import { useTranslation } from 'react-i18next';
import { I18nManager } from 'react-native';

import { isRtlLocale } from '@shared';

/** True when the active UI language is right-to-left. */
export function useIsRtl(): boolean {
  const { i18n } = useTranslation();
  return isRtlLocale(i18n.language) || I18nManager.isRTL;
}
