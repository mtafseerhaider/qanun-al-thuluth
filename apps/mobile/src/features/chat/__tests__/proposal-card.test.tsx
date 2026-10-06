import { fireEvent, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { MealPhotoCaptureScreen } from '@/features/meal-log';
import { renderWithProviders } from '@/test/render';

import { ToolProposalCard } from '../components/tool-proposal-card';
import type { ChatProposal } from '../utils/chat-stream';
import { canConfirm, proposalAction } from '../utils/proposal-rules';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));

const MEMBER = '44444444-4444-4444-8444-444444444444';

const proposal = (status: ChatProposal['status'] = 'pending'): ChatProposal => ({
  id: 'p1',
  status,
  card: {
    kind: 'log_proposal',
    table: 'hydration_logs',
    values: { family_member_id: MEMBER, volume_ml: 250 },
  },
});

describe('ToolProposalCard', () => {
  it('writes nothing until Confirm is tapped', async () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    const p = proposal();
    await renderWithProviders(
      <ToolProposalCard
        proposal={p}
        action={proposalAction(p.card)}
        memberName="Aisha"
        canEdit
        online
        onConfirm={onConfirm}
        onDismiss={onDismiss}
        testID="card"
      />,
    );
    expect(screen.getByText('Log 250 ml of water for Aisha')).toBeTruthy();
    expect(screen.getByText('Nothing is saved until you confirm.')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('card.confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('shows no buttons to viewers or once resolved', async () => {
    const p = proposal();
    const props = {
      action: proposalAction(p.card),
      memberName: 'Aisha',
      online: true,
      onConfirm: jest.fn(),
      onDismiss: jest.fn(),
      testID: 'card',
    };
    const { rerender } = await renderWithProviders(
      <ToolProposalCard {...props} proposal={p} canEdit={false} />,
    );
    expect(screen.queryByTestId('card.confirm')).toBeNull();
    await rerender(<ToolProposalCard {...props} proposal={proposal('dismissed')} canEdit />);
    expect(screen.queryByTestId('card.confirm')).toBeNull();
  });
});

const FOOD = '55555555-5555-4555-8555-555555555555';
const ladder = (targetIngredientId: string | null): ChatProposal => ({
  id: 'p2',
  status: 'pending',
  card: {
    kind: 'exposure_ladder_proposal',
    family_member_id: MEMBER,
    target_food: 'Peas',
    target_ingredient_id: targetIngredientId,
    strategy: 'exposure_ladder',
    steps: [
      {
        step_no: 1,
        stage: 'look',
        food_label: 'Peas',
        bridge_from_ingredient_id: null,
        criteria: 'On the plate',
      },
      {
        step_no: 2,
        stage: 'touch',
        food_label: 'Peas',
        bridge_from_ingredient_id: null,
        criteria: 'Touches one',
      },
    ],
  },
});

describe('ladder proposal card (S6-06)', () => {
  it('previews the ladder and saves nothing until Confirm', async () => {
    const p = ladder(FOOD);
    const action = proposalAction(p.card);
    expect(action.kind).toBe('ladder');
    expect(canConfirm(p, action, true)).toBe(true);
    const onConfirm = jest.fn();
    const onReview = jest.fn();
    await renderWithProviders(
      <ToolProposalCard
        proposal={p}
        action={action}
        memberName="Aisha"
        canEdit
        online
        onConfirm={onConfirm}
        onDismiss={jest.fn()}
        onReview={onReview}
        testID="card"
      />,
    );
    expect(screen.getByText('Exposure ladder for Peas for Aisha, 2 steps')).toBeTruthy();
    expect(screen.getByText('1. Peas: On the plate')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('card.review'));
    expect(onReview).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('card.confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('asks the parent to pick the food when the proposal has no catalog match', async () => {
    const p = ladder(null);
    const action = proposalAction(p.card);
    expect(canConfirm(p, action, true)).toBe(false);
    await renderWithProviders(
      <ToolProposalCard
        proposal={p}
        action={action}
        memberName="Aisha"
        canEdit
        online
        onConfirm={jest.fn()}
        onDismiss={jest.fn()}
        onReview={jest.fn()}
        testID="card"
      />,
    );
    expect(screen.queryByTestId('card.confirm')).toBeNull();
    expect(
      screen.getByText('Pick the food from the catalog before saving: tap Review.'),
    ).toBeTruthy();
  });
});

describe('photo meal log paywall (Q-09)', () => {
  it('shows free users the upsell instead of the camera and opens the paywall', async () => {
    await renderWithProviders(
      <MealPhotoCaptureScreen
        {...({
          route: { params: { returnTo: 'meal_log' } },
          navigation: { navigate: mockNavigate, replace: jest.fn(), goBack: jest.fn() },
        } as unknown as ComponentProps<typeof MealPhotoCaptureScreen>)}
      />,
    );
    expect(screen.getByTestId('meal-photo.upsell')).toBeTruthy();
    expect(screen.queryByTestId('meal-photo.camera')).toBeNull();
    await fireEvent.press(screen.getByTestId('meal-photo.upsell.see-premium'));
    expect(mockNavigate).toHaveBeenCalledWith('PaywallModal', { trigger: 'photo' });
  });
});
