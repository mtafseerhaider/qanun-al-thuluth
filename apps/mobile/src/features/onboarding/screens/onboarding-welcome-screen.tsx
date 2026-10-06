import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { LanguageToggle } from '@/features/settings';
import { useProfile, useUpdateProfile } from '@/hooks/use-profile';
import { isSupabaseConfigured } from '@/lib/env';
import { errorKeyFor } from '@/lib/supabase/error-mapping';

import { OnboardingScaffold } from '../components/onboarding-scaffold';
import { useOnboardingFlow } from '../hooks/use-onboarding-flow';

const BISMILLAH = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

/**
 * O1 Welcome (02 §7.2.1, 24 S1-08): greeting, language picker (switching to Urdu flips RTL via
 * `applyDirection` and reloads; the persisted onboarding store resumes here) and display name.
 */
export function OnboardingWelcomeScreen() {
  const { t } = useTranslation(['onboarding', 'errors']);
  const flow = useOnboardingFlow('welcome');
  const profile = useProfile();
  const update = useUpdateProfile();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data?.display_name && !name) setName(profile.data.display_name);
    // Prefill once from the provider name (Apple / Google) when it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.data?.display_name]);

  const onContinue = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 40 || !/[\p{L}\p{N}]/u.test(trimmed)) {
      setNameError(t('onboarding:welcome.nameError'));
      return;
    }
    if (isSupabaseConfigured) {
      try {
        await update.mutateAsync({ display_name: trimmed });
      } catch {
        return;
      }
    }
    flow.goNext();
  };

  return (
    <OnboardingScaffold
      step={flow.stepNumber}
      total={flow.totalSteps}
      title={t('onboarding:welcome.greeting')}
      subtitle={t('onboarding:welcome.body')}
      primaryLabel={t('onboarding:common.continue')}
      onPrimary={() => void onContinue()}
      primaryLoading={update.isPending}
      error={update.error ? t(`errors:${errorKeyFor(update.error)}`) : null}
      testID="onboarding-welcome.screen"
    >
      <Text
        script="arabic"
        align="center"
        accessibilityLabel={t('onboarding:welcome.bismillahA11y')}
        testID="onboarding-welcome.bismillah"
      >
        {BISMILLAH}
      </Text>
      <Card>
        <LanguageToggle
          testID="onboarding-welcome.language"
          onChanged={async (locale) => {
            if (isSupabaseConfigured) await update.mutateAsync({ locale }).catch(() => undefined);
          }}
        />
      </Card>
      <View>
        <Input
          label={t('onboarding:welcome.nameLabel')}
          helperText={t('onboarding:welcome.nameHelper')}
          {...(nameError ? { errorText: nameError } : {})}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setNameError(null);
          }}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="givenName"
          maxLength={40}
          returnKeyType="done"
          testID="onboarding-welcome.name"
        />
      </View>
    </OnboardingScaffold>
  );
}
