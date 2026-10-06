import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { SourceTradition } from '@shared';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { useProfile, useUpdateProfile } from '@/hooks/use-profile';
import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import { usePreferencesStore } from '@/stores/use-preferences-store';

import { LanguageToggle } from '../components/language-toggle';
import { OptionGroup } from '../components/option-group';

/**
 * Settings > Profile (FR-SET-01, 02 §7.13.2): display name, language, units and tradition. Units and
 * tradition apply immediately on the device and are saved to `users`; language may restart the app.
 */
export function SettingsProfileScreen() {
  const { t } = useTranslation(['settings', 'errors']);
  const profile = useProfile();
  const update = useUpdateProfile();
  const units = usePreferencesStore((s) => s.units);
  const tradition = usePreferencesStore((s) => s.traditionPreference);
  const setUnits = usePreferencesStore((s) => s.setUnits);
  const setTradition = usePreferencesStore((s) => s.setTraditionPreference);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile.data) setName(profile.data.display_name);
  }, [profile.data]);

  const save = (
    patch: Parameters<typeof update.mutate>[0],
    key: 'display_name' | 'locale' | 'units' | 'tradition',
  ) => {
    setSaved(false);
    track('setting_changed', { key });
    if (!isSupabaseConfigured) return;
    update.mutate(patch, { onSuccess: () => setSaved(true) });
  };

  return (
    <Screen testID="settings-profile.screen">
      <Card>
        <Input
          label={t('settings:profile.displayName')}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setSaved(false);
          }}
          maxLength={40}
          autoCapitalize="words"
          testID="settings-profile.name"
        />
        <View>
          <Button
            label={t('settings:profile.saveName')}
            size="sm"
            disabled={name.trim().length === 0 || name.trim() === profile.data?.display_name}
            loading={update.isPending && update.variables?.display_name !== undefined}
            onPress={() => save({ display_name: name.trim() }, 'display_name')}
            testID="settings-profile.save-name"
          />
        </View>
      </Card>
      <Card>
        <LanguageToggle
          testID="settings-profile.language"
          onChanged={async (locale) => {
            track('setting_changed', { key: 'locale' });
            if (isSupabaseConfigured) await update.mutateAsync({ locale }).catch(() => undefined);
          }}
        />
      </Card>
      <Card>
        <OptionGroup<'metric' | 'imperial'>
          label={t('settings:profile.units')}
          hint={t('settings:profile.unitsHint')}
          options={[
            { value: 'metric', label: t('settings:profile.metric') },
            { value: 'imperial', label: t('settings:profile.imperial') },
          ]}
          value={units}
          onChange={(v) => {
            setUnits(v);
            save({ units: v }, 'units');
          }}
          testID="settings-profile.units"
        />
      </Card>
      <Card>
        <OptionGroup<SourceTradition>
          label={t('settings:profile.tradition')}
          hint={t('settings:profile.traditionHint')}
          options={[
            { value: 'shared', label: t('settings:profile.traditionShared') },
            { value: 'sunni', label: t('settings:profile.traditionSunni') },
            { value: 'shia', label: t('settings:profile.traditionShia') },
          ]}
          value={tradition}
          onChange={(v) => {
            setTradition(v);
            save({ tradition_preference: v }, 'tradition');
          }}
          testID="settings-profile.tradition"
        />
      </Card>
      {update.error ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(update.error)}`)} />
      ) : saved ? (
        <InlineMessage
          tone="success"
          message={t('settings:profile.saved')}
          testID="settings-profile.saved"
        />
      ) : null}
    </Screen>
  );
}
