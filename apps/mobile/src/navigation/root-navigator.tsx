import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { BootScreen } from '@/features/auth';
import { LogExposureSheet } from '@/features/exposures';
import { CreateExportSheet } from '@/features/exports';
import { FastLogSheet } from '@/features/fasting';
import { AddGrowthMeasurementScreen } from '@/features/growth';
import { AcceptInviteScreen, InviteCaregiverScreen } from '@/features/household';
import { DehydrationCheckSheet } from '@/features/hydration';
import { ReportSourceSheet, SourceDetailSheet } from '@/features/knowledge';
import { MealAnalysisResultScreen, MealPhotoCaptureScreen } from '@/features/meal-log';
import { SwapMealSheet } from '@/features/meals';
import { PlanGenerationProgressScreen } from '@/features/plan';
import { RamadanSetupScreen } from '@/features/ramadan';
import { PaywallScreen } from '@/features/subscription';
import { useSessionStore, type SessionStatus } from '@/stores/use-session-store';

import { AuthStack } from './auth-stack';
import { MainTabs } from './main-tabs';
import { useStackMotion } from './motion';
import { OnboardingStack } from './onboarding-stack';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export type RootBranch = 'Boot' | 'Auth' | 'Onboarding' | 'Main';

/**
 * State-driven root routing (02 §3.1, 11 §8): exactly one branch is mounted for each session status.
 * The status comes from the Supabase session plus `users.onboarding_completed_at` (AuthProvider).
 */
export function branchForStatus(status: SessionStatus): RootBranch {
  switch (status) {
    case 'initializing':
      return 'Boot';
    case 'signed_out':
      return 'Auth';
    case 'needs_age_gate':
    case 'needs_onboarding':
      return 'Onboarding';
    case 'signed_in':
      return 'Main';
  }
}

/** A parked invite opens AcceptInvite once a signed-in branch is mounted (11 §12.3). */
export function shouldOpenAcceptInvite(
  status: SessionStatus,
  token: string | null,
  currentRoute: string | undefined,
): boolean {
  if (!token || currentRoute === 'AcceptInvite') return false;
  return branchForStatus(status) === 'Onboarding' || branchForStatus(status) === 'Main';
}

export function RootNavigator() {
  const { t } = useTranslation('navigation');
  const status = useSessionStore((s) => s.status);
  const branch = branchForStatus(status);
  const signedIn = branch === 'Onboarding' || branch === 'Main';
  const motion = useStackMotion();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {branch === 'Boot' ? <Stack.Screen name="Boot" getComponent={() => BootScreen} /> : null}
      {branch === 'Auth' ? <Stack.Screen name="Auth" component={AuthStack} /> : null}
      {branch === 'Onboarding' ? (
        <Stack.Screen name="Onboarding" component={OnboardingStack} />
      ) : null}
      {branch === 'Main' ? <Stack.Screen name="Main" component={MainTabs} /> : null}
      {signedIn ? (
        <Stack.Group screenOptions={{ presentation: 'modal', headerShown: true, ...motion }}>
          <Stack.Screen
            name="AcceptInvite"
            getComponent={() => AcceptInviteScreen}
            options={{ title: t('screens.acceptInvite') }}
          />
          <Stack.Screen
            name="SourceDetailSheet"
            getComponent={() => SourceDetailSheet}
            options={{
              title: t('screens.sourceDetail'),
              presentation: 'formSheet',
              sheetAllowedDetents: [0.6, 1],
            }}
          />
          {branch === 'Main' ? (
            <>
              <Stack.Screen
                name="InviteCaregiverModal"
                getComponent={() => InviteCaregiverScreen}
                options={{ title: t('screens.inviteCaregiver') }}
              />
              <Stack.Screen
                name="PlanGenerationProgress"
                getComponent={() => PlanGenerationProgressScreen}
                options={{ title: t('screens.planGenerationProgress'), gestureEnabled: true }}
              />
              <Stack.Screen
                name="SwapMealSheet"
                getComponent={() => SwapMealSheet}
                options={{
                  title: t('screens.swapMeal'),
                  presentation: 'formSheet',
                  sheetAllowedDetents: [0.7, 1],
                }}
              />
              <Stack.Screen
                name="FastLogSheet"
                getComponent={() => FastLogSheet}
                options={{
                  title: t('screens.fastLog'),
                  presentation: 'formSheet',
                  sheetAllowedDetents: [0.8, 1],
                }}
              />
              <Stack.Screen
                name="PaywallModal"
                getComponent={() => PaywallScreen}
                options={{ title: t('screens.paywall'), headerShown: false }}
              />
              <Stack.Screen
                name="MealPhotoCapture"
                getComponent={() => MealPhotoCaptureScreen}
                options={{ title: t('screens.mealPhoto') }}
              />
              <Stack.Screen
                name="MealAnalysisResult"
                getComponent={() => MealAnalysisResultScreen}
                options={{ title: t('screens.mealAnalysis') }}
              />
              <Stack.Screen
                name="RamadanSetup"
                getComponent={() => RamadanSetupScreen}
                options={{ title: t('screens.ramadanSetup') }}
              />
              <Stack.Screen
                name="AddGrowthMeasurementModal"
                getComponent={() => AddGrowthMeasurementScreen}
                options={{ title: t('screens.addGrowthMeasurement') }}
              />
              <Stack.Screen
                name="LogExposureSheet"
                getComponent={() => LogExposureSheet}
                options={{
                  title: t('screens.logExposure'),
                  presentation: 'formSheet',
                  sheetAllowedDetents: [0.9, 1],
                }}
              />
              <Stack.Screen
                name="CreateExportSheet"
                getComponent={() => CreateExportSheet}
                options={{
                  title: t('screens.createExport'),
                  presentation: 'formSheet',
                  sheetAllowedDetents: [0.9, 1],
                }}
              />
              <Stack.Screen
                name="ReportSourceSheet"
                getComponent={() => ReportSourceSheet}
                options={{
                  title: t('screens.reportSource'),
                  presentation: 'formSheet',
                  sheetAllowedDetents: [0.8, 1],
                }}
              />
              <Stack.Screen
                name="DehydrationCheckSheet"
                getComponent={() => DehydrationCheckSheet}
                options={{
                  title: t('screens.dehydrationCheck'),
                  presentation: 'formSheet',
                  sheetAllowedDetents: [0.8, 1],
                }}
              />
            </>
          ) : null}
        </Stack.Group>
      ) : null}
    </Stack.Navigator>
  );
}
