import { useTranslation } from 'react-i18next';

import { track } from '@/lib/analytics/track';
import { changeLocale } from '@/lib/i18n/i18n';
import { usePreferencesStore, type AppLocale } from '@/stores/use-preferences-store';

import { OptionGroup } from './option-group';

export function LanguageToggle() {
  const { t } = useTranslation('settings');
  const locale = usePreferencesStore((s) => s.locale);
  const options = [
    { value: 'en', label: t('language.english') },
    { value: 'ur', label: t('language.urdu') },
  ] as const satisfies readonly { value: AppLocale; label: string }[];

  const onChange = (next: AppLocale) => {
    if (next === locale) return;
    track('locale_changed', { from: locale, to: next });
    void changeLocale(next);
  };

  return (
    <OptionGroup
      label={t('language.title')}
      hint={t('language.hint')}
      options={options}
      value={locale}
      onChange={onChange}
      testID="settings.language"
    />
  );
}
