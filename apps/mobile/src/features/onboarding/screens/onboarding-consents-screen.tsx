import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ConsentKind } from '@shared';

import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Text } from '@/components/ui/text';
import {
  canContinueWithConsents,
  hasCurrentConsent,
  useConsents,
  useGrantConsents,
} from '@/features/auth';
import { fetchMyHouseholds } from '@/features/household';
import { useProfile, useUpdateProfile } from '@/hooks/use-profile';
import { isSupabaseConfigured } from '@/lib/env';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { useSessionStore } from '@/stores/use-session-store';

import { OnboardingScaffold } from '../components/onboarding-scaffold';
import { useOnboardingFlow } from '../hooks/use-onboarding-flow';
import { useOnboardingStore } from '../store/use-onboarding-store';

/** Order shown on screen; `child_data` is asked later, scoped to the household (11 §13.2). */
export const CONSENT_ROWS: ReadonlyArray<{ kind: ConsentKind; required: boolean }> = [
  { kind: 'terms', required: true },
  { kind: 'privacy', required: true },
  { kind: 'health_data', required: true },
  { kind: 'ai_processing', required: true },
  { kind: 'marketing', required: false },
];

/**
 * O5 Privacy and consents (02 §7.2.5, 24 S1-07) before any health data is entered. Each grant is a
 * `consents` row with the current `CONSENT_VERSIONS`; required kinds block Continue; marketing is
 * optional and unchecked by default (FR-AUTH-05).
 */
export function OnboardingConsentsScreen() {
  const { t } = useTranslation(['onboarding', 'errors']);
  const flow = useOnboardingFlow('consents');
  const consents = useConsents();
  const grant = useGrantConsents();
  const live = consents.data?.live ?? [];
  const [checked, setChecked] = useState<Partial<Record<ConsentKind, boolean>>>({});
  const [checking, setChecking] = useState(false);
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  // 18+ attestation (11 §13): the account holder is an adult; children are added as members.
  const ageAttested = Boolean(profile.data?.age_attested_at);
  const [adult, setAdult] = useState(false);
  const canContinue = canContinueWithConsents(checked, live) && (ageAttested || adult);

  const onContinue = async () => {
    const kinds = CONSENT_ROWS.map((r) => r.kind).filter(
      (k) => checked[k] && !hasCurrentConsent(live, k),
    );
    try {
      if (kinds.length > 0 && isSupabaseConfigured) await grant.mutateAsync({ kinds });
      if (!ageAttested && isSupabaseConfigured)
        await updateProfile.mutateAsync({ age_attested_at: new Date().toISOString() });
      useSessionStore.getState().markAgeAttested();
      // An invitee who already joined a household skips creating one (FR-AUTH-08).
      const userId = useSessionStore.getState().userId;
      const store = useOnboardingStore.getState();
      if (userId && isSupabaseConfigured && !store.createdHouseholdId) {
        setChecking(true);
        const memberships = await fetchMyHouseholds(userId);
        if (memberships.length > 0) {
          store.setJoinedByInvite(true);
          useActiveHouseholdStore.getState().reconcile(memberships);
        }
      }
    } catch {
      return;
    } finally {
      setChecking(false);
    }
    flow.goNext();
  };

  return (
    <OnboardingScaffold
      step={flow.stepNumber}
      total={flow.totalSteps}
      title={t('onboarding:consents.title')}
      subtitle={t('onboarding:consents.body')}
      primaryLabel={t('onboarding:consents.agree')}
      onPrimary={() => void onContinue()}
      primaryDisabled={!canContinue}
      primaryLoading={grant.isPending || updateProfile.isPending || checking}
      onBack={flow.goBack}
      error={
        grant.error || updateProfile.error
          ? t(`errors:${errorKeyFor(grant.error ?? updateProfile.error)}`)
          : null
      }
      testID="onboarding-consents.screen"
    >
      <Card variant="filled">
        <Text variant="bodyStrong">{t('onboarding:consents.summaryTitle')}</Text>
        <Text tone="muted">{t('onboarding:consents.summary')}</Text>
      </Card>
      <View className="gap-1" testID="onboarding-consents.list">
        <Checkbox
          label={t('onboarding:consents.age.title')}
          description={t('onboarding:consents.age.description')}
          checked={ageAttested || adult}
          disabled={ageAttested}
          required
          requiredLabel={t('onboarding:consents.required')}
          onChange={setAdult}
          testID="onboarding-consents.age"
        />
        {CONSENT_ROWS.map(({ kind, required }) => {
          const already = hasCurrentConsent(live, kind);
          return (
            <Checkbox
              key={kind}
              label={t(`onboarding:consents.kinds.${kind}.title`)}
              description={t(`onboarding:consents.kinds.${kind}.description`)}
              checked={already || checked[kind] === true}
              disabled={already}
              required={required}
              requiredLabel={t('onboarding:consents.required')}
              onChange={(v) => setChecked((c) => ({ ...c, [kind]: v }))}
              testID={`onboarding-consents.${kind}`}
            />
          );
        })}
      </View>
      <Text variant="caption" tone="muted">
        {canContinue ? t('onboarding:consents.ready') : t('onboarding:consents.requiredNote')}
      </Text>
    </OnboardingScaffold>
  );
}
