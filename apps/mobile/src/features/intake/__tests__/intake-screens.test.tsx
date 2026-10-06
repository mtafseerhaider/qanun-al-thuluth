import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import type { FamilyMember } from '@/features/family';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { renderWithProviders } from '@/test/render';

import { saveGoals, saveHealth } from '../api/intake-api';
import { IntakeGoalsScreen } from '../screens/intake-goals-screen';
import { IntakeHealthScreen } from '../screens/intake-health-screen';
import { useIntakeDraftStore } from '../store/use-intake-draft-store';

const HH = '00000000-0000-4000-8000-0000000000aa';
const member = (patch: Partial<FamilyMember>): FamilyMember => ({
  id: '00000000-0000-4000-8000-000000000001',
  household_id: HH,
  linked_user_id: null,
  name: 'Usman',
  date_of_birth: '1988-03-14',
  sex_at_birth: 'male',
  height_cm: 175,
  weight_kg: 84,
  activity_level: 'moderate',
  life_stage: 'adult',
  sort_order: 0,
  special_modules: [],
  ...patch,
});
const USMAN = member({});
const IBRAHIM = member({
  id: '00000000-0000-4000-8000-000000000003',
  name: 'Ibrahim',
  date_of_birth: '2018-04-20',
  height_cm: 128,
  weight_kg: 25,
  life_stage: 'child',
  sort_order: 2,
});
const TEEN = member({
  id: '00000000-0000-4000-8000-000000000005',
  name: 'Zainab',
  date_of_birth: '2010-02-01',
  sex_at_birth: 'female',
  life_stage: 'teen',
  sort_order: 3,
});

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const mockMembers = [USMAN, IBRAHIM, TEEN];
jest.mock('@/features/family/hooks/use-family-members', () => ({
  useFamilyMembers: () => ({
    data: mockMembers,
    isLoading: false,
  }),
}));

jest.mock('../api/intake-api', () => ({
  saveGoals: jest.fn(() => Promise.resolve()),
  saveHealth: jest.fn(() => Promise.resolve()),
}));

const Stack = createNativeStackNavigator();
type ScreenComponent = NonNullable<ComponentProps<typeof Stack.Screen>['component']>;
const Hub = () => <View testID="intake-members.screen" />;
const NextStep = () => <View testID="next-step" />;

async function renderStep(name: string, component: ScreenComponent, familyMemberId: string) {
  await renderWithProviders(
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name={name} component={component} initialParams={{ familyMemberId }} />
      <Stack.Screen name="IntakeMembers" component={Hub} />
      {['IntakeMemberAllergies', 'IntakeMemberHealth', 'IntakeMemberGoals', 'IntakeMemberFood'].map(
        (r) => (r === name ? null : <Stack.Screen key={r} name={r} component={NextStep} />),
      )}
    </Stack.Navigator>,
    { withNavigation: true },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useActiveHouseholdStore.setState({ activeHouseholdId: HH });
  useIntakeDraftStore.getState().reset();
  useIntakeDraftStore.getState().begin(HH);
});

describe('IntakeGoalsScreen (S2-06)', () => {
  const renderGoals = (id: string) =>
    renderStep('IntakeMemberGoals', IntakeGoalsScreen as ScreenComponent, id);

  it('never shows weight goals to a child, and explains how a doctor-advised gain is handled', async () => {
    await renderGoals(IBRAHIM.id);
    expect(await screen.findByTestId('intake-goals.child_growth')).toBeTruthy();
    expect(screen.queryByTestId('intake-goals.weight_loss')).toBeNull();
    expect(screen.queryByTestId('intake-goals.weight_gain')).toBeNull();
    expect(screen.queryByTestId('intake-goals.target')).toBeNull();
    expect(screen.getByTestId('intake-goals.child-weight-note')).toBeTruthy();
  });

  it('hides weight goals for a 16-year-old too', async () => {
    await renderGoals(TEEN.id);
    expect(await screen.findByTestId('intake-goals.child_growth')).toBeTruthy();
    expect(screen.queryByTestId('intake-goals.weight_loss')).toBeNull();
    expect(screen.queryByTestId('intake-goals.weight_gain')).toBeNull();
  });

  it('drops a weight goal smuggled into a child draft before saving', async () => {
    useIntakeDraftStore.getState().updateAnswers(IBRAHIM.id, {
      goals: [{ id: 'g1', goal_type: 'weight_loss', is_primary: true }],
    });
    await renderGoals(IBRAHIM.id);
    await fireEvent.press(await screen.findByTestId('intake-goals.screen.next'));
    await waitFor(() => expect(saveGoals).toHaveBeenCalled());
    const goals = (saveGoals as jest.Mock).mock.calls[0][1] as Array<{ goal_type: string }>;
    expect(goals.map((g) => g.goal_type)).not.toContain('weight_loss');
  });

  it('offers adults weight loss with a target that blocks anything under a healthy BMI', async () => {
    await renderGoals(USMAN.id);
    await fireEvent.press(await screen.findByTestId('intake-goals.weight_loss'));
    expect(screen.queryByTestId('intake-goals.child_growth')).toBeNull();
    expect(screen.getByTestId('intake-goals.target')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('intake-goals.target-weight'), '50');
    expect(screen.getByTestId('intake-goals.screen.next')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('intake-goals.target-weight'), '78');
    expect(screen.getByTestId('intake-goals.screen.next')).toBeEnabled();
  });
});

describe('IntakeHealthScreen red-flag capture (S2-05)', () => {
  it('flags type 2 diabetes on insulin with an intent to fast and saves the insulin flag', async () => {
    await renderStep('IntakeMemberHealth', IntakeHealthScreen as ScreenComponent, USMAN.id);
    await fireEvent.press(await screen.findByTestId('intake-health.condition.type_2_diabetes'));
    await fireEvent.changeText(
      screen.getByTestId('intake-health.medications.new.input'),
      'Insulin glargine',
    );
    await fireEvent.press(screen.getByTestId('intake-health.medications.new.add'));
    expect(screen.getByTestId('intake-health.medication-0.flag.insulin')).toBeTruthy();
    expect(screen.getByTestId('intake-health.fasting-risk')).toBeTruthy();
    expect(screen.queryByTestId('intake-health.red-flag')).toBeNull();

    await fireEvent.press(screen.getByTestId('intake-health.intends-to-fast.yes'));
    expect(screen.getByTestId('intake-health.red-flag')).toBeTruthy();

    const answers = useIntakeDraftStore.getState().members[USMAN.id]!.answers;
    expect(answers.screening?.intends_to_fast).toBe(true);
    expect(answers.medications?.items[0]?.food_interaction_flags).toContain('insulin');

    await fireEvent.press(screen.getByTestId('intake-health.weight-change.no'));
    await fireEvent.press(screen.getByTestId('intake-health.eating-concern.no'));
    await fireEvent.press(screen.getByTestId('intake-health.screen.next'));
    await waitFor(() => expect(saveHealth).toHaveBeenCalled());
    const saved = (saveHealth as jest.Mock).mock.calls[0][1] as {
      conditions: Array<{ label: string }>;
      medications: Array<{ name: string }>;
    };
    expect(saved.conditions).toHaveLength(1);
    expect(saved.medications[0]?.name).toBe('Insulin glargine');
    expect(await screen.findByTestId('next-step')).toBeTruthy();
  });

  it('does not ask a young child about eating worries', async () => {
    await renderStep('IntakeMemberHealth', IntakeHealthScreen as ScreenComponent, IBRAHIM.id);
    expect(await screen.findByTestId('intake-health.weight-change')).toBeTruthy();
    expect(screen.queryByTestId('intake-health.eating-concern')).toBeNull();
  });
});
