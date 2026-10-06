import { fireEvent, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { MealPhotoCaptureScreen } from '@/features/meal-log';
import { renderWithProviders } from '@/test/render';

import { ToolProposalCard } from '../components/tool-proposal-card';
import type { ChatProposal } from '../utils/chat-stream';
import { proposalAction } from '../utils/proposal-rules';

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
