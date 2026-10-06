import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { track } from '@/lib/analytics/track';
import { changeLocale } from '@/lib/i18n/i18n';
import { needsDirectionChange } from '@/lib/i18n/rtl';
import { usePreferencesStore, type AppLocale } from '@/stores/use-preferences-store';

import { OptionGroup } from './option-group';

/**
 * English / اردو switch used on Auth Welcome, onboarding step 1 and Settings. A direction flip
 * (en <-> ur) needs a reload, so the user confirms first (02 §5.2). `onChanged` lets callers save
 * the choice to `users.locale` once signed in.
 */
export function LanguageToggle({
  compact = false,
  onChanged,
  testID = 'settings.language',
}: {
  compact?: boolean;
  onChanged?: (locale: AppLocale) => Promise<void> | void;
  testID?: string;
}) {
  const { t } = useTranslation('settings');
  const locale = usePreferencesStore((s) => s.locale);
  const options = [
    { value: 'en', label: t('language.english') },
    { value: 'ur', label: t('language.urdu') },
  ] as const satisfies readonly { value: AppLocale; label: string }[];

  const apply = async (next: AppLocale) => {
    track('locale_changed', { from: locale, to: next });
    await onChanged?.(next);
    await changeLocale(next);
  };

  const onChange = (next: AppLocale) => {
    if (next === locale) return;
    if (!needsDirectionChange(next)) {
      void apply(next);
      return;
    }
    Alert.alert(t('language.restartTitle'), t('language.restartBody'), [
      { text: t('language.cancel'), style: 'cancel' },
      { text: t('language.restartConfirm'), onPress: () => void apply(next) },
    ]);
  };

  return (
    <OptionGroup
      label={t('language.title')}
      {...(compact ? { compact: true } : { hint: t('language.hint') })}
      options={options}
      value={locale}
      onChange={onChange}
      testID={testID}
    />
  );
}
