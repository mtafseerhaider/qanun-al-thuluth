import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { track } from '@/lib/analytics/track';
import { updateProfile } from '@/lib/auth/profile';
import { qk } from '@/lib/query/query-keys';
import type { OnboardingStackParamList } from '@/navigation/types';
import { useSessionStore } from '@/stores/use-session-store';

import {
  nextStep,
  ONBOARDING_STEPS,
  stepNumber,
  useOnboardingStore,
  type OnboardingStep,
} from '../store/use-onboarding-store';
import { routeForStep } from '../utils/onboarding-routes';

type Nav = NativeStackNavigationProp<OnboardingStackParamList>;

/**
 * Step navigation for onboarding: records completion (persisted), moves to the next route, and
 * after the last step sets `users.onboarding_completed_at` so the root navigator switches to Main.
 */
export function useOnboardingFlow(step: Exclude<OnboardingStep, 'done'>) {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<unknown>(null);

  const finish = async (memberCount: number) => {
    const userId = useSessionStore.getState().userId;
    if (!userId) return;
    setFinishing(true);
    setFinishError(null);
    try {
      await updateProfile(userId, { onboarding_completed_at: new Date().toISOString() });
      track('onboarding_completed', { members: memberCount });
      void qc.invalidateQueries({ queryKey: qk.profile() });
      useOnboardingStore.getState().complete('members');
      useSessionStore.getState().markOnboarded();
    } catch (e) {
      setFinishError(e);
    } finally {
      setFinishing(false);
    }
  };

  const goNext = (opts: { memberCount?: number } = {}) => {
    const store = useOnboardingStore.getState();
    track('onboarding_step_completed', { step });
    const next = nextStep(step, { skipHousehold: store.joinedByInvite });
    if (next === 'done') {
      void finish(opts.memberCount ?? 0);
      return;
    }
    store.complete(step);
    navigation.navigate(routeForStep(next));
  };

  const goBack = () => {
    const i = ONBOARDING_STEPS.indexOf(step);
    const prev = i > 0 ? ONBOARDING_STEPS[i - 1] : undefined;
    if (!prev) return;
    useOnboardingStore.getState().goTo(prev);
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace(routeForStep(prev));
  };

  return {
    goNext,
    goBack,
    canGoBack: step !== 'welcome',
    stepNumber: stepNumber(step),
    totalSteps: ONBOARDING_STEPS.length,
    finishing,
    finishError,
  };
}
