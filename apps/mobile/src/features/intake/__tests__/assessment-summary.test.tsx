import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import type { AiIntakeAssessResponse, MemberAssessment } from '@shared/contracts';

import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { renderWithProviders } from '@/test/render';

import { runIntakeAssessment } from '../api/intake-api';
import {
  AssessmentSummaryScreen,
  MemberAssessmentCard,
} from '../screens/assessment-summary-screen';
import { useIntakeDraftStore } from '../store/use-intake-draft-store';
import {
  childSafeLines,
  energyRange,
  hydrationDisplay,
  memberSummaryText,
  mentionsEnergy,
  riskFlagKey,
} from '../utils/assessment-display';

const HH = '00000000-0000-4000-8000-0000000000aa';
const USMAN = '00000000-0000-4000-8000-000000000001';
const IBRAHIM = '00000000-0000-4000-8000-000000000003';

jest.mock('@/features/family/hooks/use-family-members', () => ({
  useFamilyMembers: () => ({
    data: [
      { id: '00000000-0000-4000-8000-000000000001', name: 'Usman' },
      { id: '00000000-0000-4000-8000-000000000003', name: 'Ibrahim' },
    ],
    isLoading: false,
  }),
}));

jest.mock('../api/intake-api', () => ({
  runIntakeAssessment: jest.fn(),
}));

const adult: MemberAssessment = {
  assessment_id: '00000000-0000-4000-8000-0000000000b1',
  family_member_id: USMAN,
  life_stage: 'adult',
  summary: 'Usman is moderately active and wants to lose weight gradually.',
  energy_targets: {
    kcal_per_day: 2211,
    method: 'mifflin_st_jeor',
    bmr_kcal: 1749,
    tdee_kcal: 2711,
    goal_adjustment_kcal: -500,
    pal: 1.55,
  },
  macro_targets: { protein_g: 110, carbs_g: 250, fat_g: 75, fiber_g: 30 },
  hydration_target_ml: 2500,
  risk_flags: [],
  escalation: null,
  recommendation_ids: [],
};

const child: MemberAssessment = {
  assessment_id: '00000000-0000-4000-8000-0000000000b3',
  family_member_id: IBRAHIM,
  life_stage: 'child',
  summary: 'Ibrahim is growing well. He needs about 1,700 kcal a day. Offer a safe food at meals.',
  energy_targets: null,
  macro_targets: null,
  hydration_target_ml: 1250,
  child_guidance: [
    'Offer one safe food at every meal.',
    'Aim for about 1,700 calories a day.',
    'Serve water with meals.',
  ],
  risk_flags: [],
  escalation: null,
  recommendation_ids: [],
};

const response = (assessments: MemberAssessment[]): AiIntakeAssessResponse => ({
  household_id: HH,
  assessments,
  disclaimer_key: 'disclaimer.not_medical_advice',
});

beforeEach(() => {
  jest.clearAllMocks();
  useActiveHouseholdStore.setState({ activeHouseholdId: HH });
  useIntakeDraftStore.getState().reset();
  useIntakeDraftStore.getState().begin(HH);
});

describe('assessment display rules', () => {
  it('detects calorie wording in English and Urdu', () => {
    expect(mentionsEnergy('About 1,700 kcal')).toBe(true);
    expect(mentionsEnergy('1,700 Calories')).toBe(true);
    expect(mentionsEnergy('روزانہ 1700 کیلوری')).toBe(true);
    expect(mentionsEnergy('Offer water with meals')).toBe(false);
  });

  it('strips calorie lines and sentences for children only', () => {
    expect(childSafeLines(child.child_guidance)).toEqual([
      'Offer one safe food at every meal.',
      'Serve water with meals.',
    ]);
    expect(memberSummaryText(child)).toBe('Ibrahim is growing well. Offer a safe food at meals.');
    expect(memberSummaryText({ ...adult, summary: 'Target 2,200 kcal.' })).toBe(
      'Target 2,200 kcal.',
    );
  });

  it('rounds the energy range and converts water to glasses', () => {
    expect(energyRange(2211)).toEqual({ low: 2100, high: 2300 });
    expect(hydrationDisplay(2500)).toEqual({ count: 10, litres: '2.5' });
    expect(hydrationDisplay(100).count).toBe(1);
  });

  it('maps server risk flags to copy keys', () => {
    expect(riskFlagKey('red_flag.insulin_or_sulfonylurea_fasting')).toBe(
      'riskFlags.insulin_or_sulfonylurea_fasting',
    );
    expect(riskFlagKey('something_new')).toBe('riskFlags.other');
  });
});

describe('MemberAssessmentCard', () => {
  it('shows an adult the energy range, TDEE, macros and water', async () => {
    await renderWithProviders(
      <MemberAssessmentCard assessment={adult} name="Usman" testID="card" />,
    );
    expect(screen.getByTestId('card.energy')).toHaveTextContent(
      'Around 2,100 to 2,300 kcal a day.',
    );
    expect(screen.getByTestId('card.tdee')).toHaveTextContent(
      'Daily energy use (TDEE): 2,711 kcal',
    );
    expect(screen.getByTestId('card.macros')).toHaveTextContent(/Protein 110 g/);
    expect(screen.queryByTestId('card.child')).toBeNull();
  });

  it('never shows a child a calorie number, and collapses the parents section', async () => {
    await renderWithProviders(
      <MemberAssessmentCard assessment={child} name="Ibrahim" testID="card" />,
    );
    const card = screen.getByTestId('card');
    expect(within(card).queryByText(/kcal|calori/i)).toBeNull();
    expect(screen.queryByTestId('card.energy')).toBeNull();
    expect(screen.queryByTestId('card.tdee')).toBeNull();
    expect(screen.queryByTestId('card.macros')).toBeNull();
    expect(screen.getByTestId('card.water')).toHaveTextContent('Water: about 5 cups (1.3 L).');
    expect(screen.queryByText('Offer one safe food at every meal.')).toBeNull();

    await fireEvent.press(screen.getByTestId('card.parents.toggle'));
    expect(screen.getByText('Offer one safe food at every meal.')).toBeTruthy();
    expect(within(card).queryByText(/kcal|calori/i)).toBeNull();
  });

  it('ignores numbers for a minor even if the server sent them', async () => {
    const leaked = {
      ...child,
      energy_targets: adult.energy_targets,
      macro_targets: adult.macro_targets,
    };
    await renderWithProviders(
      <MemberAssessmentCard assessment={leaked} name="Ibrahim" testID="card" />,
    );
    expect(screen.queryByTestId('card.energy')).toBeNull();
    expect(screen.queryByTestId('card.tdee')).toBeNull();
    expect(screen.queryByText(/2,711/)).toBeNull();
  });

  it('shows risk flags and a clinician card when escalation is present', async () => {
    const flagged: MemberAssessment = {
      ...adult,
      energy_targets: null,
      risk_flags: ['red_flag.insulin_or_sulfonylurea_fasting'],
      escalation: {
        reason: 'insulin_or_sulfonylurea_fasting',
        family_member_id: USMAN,
        message: 'Please speak with your doctor before fasting.',
        recommend: 'see_gp',
      },
    };
    await renderWithProviders(
      <MemberAssessmentCard assessment={flagged} name="Usman" testID="card" />,
    );
    expect(screen.getByTestId('card.risk.red_flag.insulin_or_sulfonylurea_fasting')).toBeTruthy();
    expect(screen.getByTestId('card.clinician')).toHaveTextContent(/Suggested: your family doctor/);
  });
});

describe('AssessmentSummaryScreen (S2-15)', () => {
  const Stack = createNativeStackNavigator();
  const renderSummary = (onContinue: () => void = jest.fn()) => {
    const Summary = () => <AssessmentSummaryScreen onContinue={onContinue} onEdit={jest.fn()} />;
    return renderWithProviders(
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="AssessmentSummary" component={Summary} />
      </Stack.Navigator>,
      { withNavigation: true },
    );
  };

  it('calls ai-intake-assess once with screening answers and renders each member', async () => {
    (runIntakeAssessment as jest.Mock).mockResolvedValue(response([adult, child]));
    useIntakeDraftStore.getState().updateAnswers(USMAN, { screening: { intends_to_fast: true } });
    const onContinue = jest.fn();
    await renderSummary(onContinue);

    expect(await screen.findByTestId('assessment.member-0.tdee')).toHaveTextContent(/2,711/);
    expect(screen.getByTestId('assessment.member-1.child')).toBeTruthy();
    expect(screen.getByTestId('assessment.recommendations.empty')).toBeTruthy();
    expect(runIntakeAssessment).toHaveBeenCalledTimes(1);
    expect(runIntakeAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: HH,
        locale: 'en',
        screening: { [USMAN]: expect.objectContaining({ intends_to_fast: true }) },
      }),
    );
    await fireEvent.press(screen.getByTestId('assessment.continue'));
    expect(onContinue).toHaveBeenCalled();
  });

  it('reuses a stored assessment without calling the server again', async () => {
    useIntakeDraftStore.getState().setAssessment(response([adult]));
    await renderSummary();
    expect(await screen.findByTestId('assessment.member-0')).toBeTruthy();
    expect(runIntakeAssessment).not.toHaveBeenCalled();
  });

  it('shows a retry when the assessment fails', async () => {
    (runIntakeAssessment as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(response([adult]));
    await renderSummary();
    await fireEvent.press(await screen.findByTestId('assessment.retry'));
    await waitFor(() => expect(screen.getByTestId('assessment.member-0')).toBeTruthy());
    expect(screen.getByTestId('assessment.continue')).toBeEnabled();
  });
});
