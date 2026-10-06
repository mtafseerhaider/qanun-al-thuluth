import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { SourceTradition } from '@shared';

import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Text } from '@/components/ui/text';
import { useUpdateProfile } from '@/hooks/use-profile';
import { isSupabaseConfigured } from '@/lib/env';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import { usePreferencesStore } from '@/stores/use-preferences-store';

import { OnboardingScaffold } from '../components/onboarding-scaffold';
import { PlateDiagram } from '../components/plate-diagram';
import { ThirdsDiagram } from '../components/thirds-diagram';
import { useOnboardingFlow } from '../hooks/use-onboarding-flow';

/**
 * O2 Philosophy (02 §7.2.2, 24 S1-09): the rule of thirds with the Tirmidhi 2380 narration as given
 * in 00 §2, the plate method, the "children are never restricted" promise, and the tradition
 * preference (`users.tradition_preference`, 02 §7.2.4) folded into this step for Sprint 1.
 */
export function OnboardingPhilosophyScreen() {
  const { t } = useTranslation(['onboarding', 'errors']);
  const flow = useOnboardingFlow('philosophy');
  const update = useUpdateProfile();
  const stored = usePreferencesStore((s) => s.traditionPreference);
  const setTradition = usePreferencesStore((s) => s.setTraditionPreference);
  const [tradition, setLocal] = useState<SourceTradition>(stored);

  const onContinue = async () => {
    if (isSupabaseConfigured) {
      try {
        await update.mutateAsync({ tradition_preference: tradition });
      } catch {
        return;
      }
    }
    setTradition(tradition);
    flow.goNext();
  };

  return (
    <OnboardingScaffold
      step={flow.stepNumber}
      total={flow.totalSteps}
      title={t('onboarding:philosophy.title')}
      subtitle={t('onboarding:philosophy.body')}
      primaryLabel={t('onboarding:common.continue')}
      onPrimary={() => void onContinue()}
      primaryLoading={update.isPending}
      onBack={flow.goBack}
      error={update.error ? t(`errors:${errorKeyFor(update.error)}`) : null}
      testID="onboarding-philosophy.screen"
    >
      <ThirdsDiagram />

      <Card testID="onboarding-philosophy.hadith">
        <Text variant="overline" tone="muted">
          {t('onboarding:philosophy.hadith.label')}
        </Text>
        <Text>{t('onboarding:philosophy.hadith.translation')}</Text>
        <View className="self-start rounded-full bg-primary-soft px-3 py-1">
          <Text variant="caption" tone="primary">
            {t('onboarding:philosophy.hadith.citation')}
          </Text>
        </View>
        <Text variant="caption" tone="muted">
          {t('onboarding:philosophy.hadith.note')}
        </Text>
      </Card>

      <Card>
        <Text variant="heading" accessibilityRole="header">
          {t('onboarding:philosophy.plateTitle')}
        </Text>
        <PlateDiagram />
      </Card>

      <InlineMessage
        tone="info"
        title={t('onboarding:philosophy.childrenTitle')}
        message={t('onboarding:philosophy.childrenBody')}
        testID="onboarding-philosophy.children"
      />

      <RadioCardGroup<SourceTradition>
        label={t('onboarding:philosophy.tradition.label')}
        hint={t('onboarding:philosophy.tradition.hint')}
        options={[
          {
            value: 'shared',
            title: t('onboarding:philosophy.tradition.shared'),
            description: t('onboarding:philosophy.tradition.sharedDescription'),
          },
          {
            value: 'sunni',
            title: t('onboarding:philosophy.tradition.sunni'),
            description: t('onboarding:philosophy.tradition.sunniDescription'),
          },
          {
            value: 'shia',
            title: t('onboarding:philosophy.tradition.shia'),
            description: t('onboarding:philosophy.tradition.shiaDescription'),
          },
        ]}
        value={tradition}
        onChange={setLocal}
        testID="onboarding-philosophy.tradition"
      />
    </OnboardingScaffold>
  );
}
