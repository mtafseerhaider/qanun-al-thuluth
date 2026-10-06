import { useTranslation } from 'react-i18next';

import { usePreferencesStore, type ThemePreference } from '@/stores/use-preferences-store';

import { OptionGroup } from './option-group';

export function ThemeToggle() {
  const { t } = useTranslation('settings');
  const theme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const options = [
    { value: 'system', label: t('appearance.system') },
    { value: 'light', label: t('appearance.light') },
    { value: 'dark', label: t('appearance.dark') },
  ] as const satisfies readonly { value: ThemePreference; label: string }[];
  return (
    <OptionGroup
      label={t('appearance.theme')}
      hint={t('appearance.themeHint')}
      options={options}
      value={theme}
      onChange={setTheme}
      testID="settings.theme"
    />
  );
}
