import { useCallback } from 'react';

import { IntakeWizard } from '@/features/intake';

import { useOnboardingFlow } from '../hooks/use-onboarding-flow';

/** Step 5 intake (02 §7.3, 24 S2-04): the intake wizard hosted inside onboarding. */
export function OnboardingIntakeScreen() {
  const flow = useOnboardingFlow('intake');
  const { goNext, goBack } = flow;
  const onComplete = useCallback(() => goNext(), [goNext]);
  return <IntakeWizard onComplete={onComplete} onExit={goBack} />;
}
