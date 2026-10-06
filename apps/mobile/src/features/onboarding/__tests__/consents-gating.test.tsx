import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { fireEvent, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { CONSENT_VERSIONS, REQUIRED_CONSENTS } from '@shared';

import {
  canContinueWithConsents,
  missingRequiredConsents,
  needsChildDataConsent,
} from '@/features/auth';
import { renderWithProviders } from '@/test/render';

import { OnboardingConsentsScreen } from '../screens/onboarding-consents-screen';

const live = (kind: string, householdId: string | null = null, version?: string) => ({
  kind,
  version: version ?? CONSENT_VERSIONS[kind as keyof typeof CONSENT_VERSIONS],
  household_id: householdId,
});

describe('consent rules', () => {
  it('requires terms, privacy, health data and AI processing; marketing is optional', async () => {
    expect([...REQUIRED_CONSENTS].sort()).toEqual(
      ['ai_processing', 'health_data', 'privacy', 'terms'].sort(),
    );
    expect(canContinueWithConsents({ terms: true, privacy: true, health_data: true })).toBe(false);
    expect(
      canContinueWithConsents({
        terms: true,
        privacy: true,
        health_data: true,
        ai_processing: true,
      }),
    ).toBe(true);
  });

  it('counts live grants of the current version only', async () => {
    const grants = [live('terms'), live('privacy'), live('health_data', null, '2020-01-01')];
    expect(missingRequiredConsents(grants)).toEqual(['health_data', 'ai_processing']);
    expect(canContinueWithConsents({ health_data: true, ai_processing: true }, grants)).toBe(true);
  });

  it('asks for child-data consent per household, only for minors', async () => {
    const grants = [live('child_data', 'hh-1')];
    expect(needsChildDataConsent(false, [], 'hh-1')).toBe(false);
    expect(needsChildDataConsent(true, [], 'hh-1')).toBe(true);
    expect(needsChildDataConsent(true, grants, 'hh-1')).toBe(false);
    expect(needsChildDataConsent(true, grants, 'hh-2')).toBe(true);
  });
});

describe('OnboardingConsentsScreen', () => {
  const Stack = createNativeStackNavigator();
  const Next = () => <View testID="next-step" />;

  async function renderScreen() {
    await renderWithProviders(
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="OnboardingConsents" component={OnboardingConsentsScreen} />
        <Stack.Screen name="OnboardingHousehold" component={Next} />
      </Stack.Navigator>,
      { withNavigation: true },
    );
  }

  const continueButton = () => screen.getByTestId('onboarding-consents.screen.continue');

  it('keeps Continue disabled until the age attestation and every required consent are ticked', async () => {
    await renderScreen();
    expect(continueButton()).toBeDisabled();

    for (const kind of ['terms', 'privacy', 'health_data', 'ai_processing']) {
      await fireEvent.press(screen.getByTestId(`onboarding-consents.${kind}`));
    }
    expect(continueButton()).toBeDisabled();

    await fireEvent.press(screen.getByTestId('onboarding-consents.age'));
    expect(continueButton()).toBeEnabled();

    // Marketing stays optional and unticked by default.
    expect(screen.getByTestId('onboarding-consents.marketing')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: false }),
    );

    await fireEvent.press(screen.getByTestId('onboarding-consents.privacy'));
    expect(continueButton()).toBeDisabled();
  });

  it('moves to the household step once everything required is accepted', async () => {
    await renderScreen();
    for (const id of ['age', 'terms', 'privacy', 'health_data', 'ai_processing']) {
      await fireEvent.press(screen.getByTestId(`onboarding-consents.${id}`));
    }
    await fireEvent.press(continueButton());
    expect(await screen.findByTestId('next-step')).toBeTruthy();
  });
});
