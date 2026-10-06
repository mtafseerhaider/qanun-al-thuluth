import { fireEvent, screen } from '@testing-library/react-native';

import { useOutboxStore } from '@/lib/offline/outbox';
import { renderWithProviders } from '@/test/render';

import { ALPHA_FEEDBACK_KIND, buildFeedback, FEEDBACK_MAX_LENGTH } from '../api/alpha-feedback-api';
import { AlphaFeedbackScreen } from '../screens/alpha-feedback-screen';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

beforeEach(() => useOutboxStore.getState().reset());

describe('alpha feedback (24 S3-17, stub)', () => {
  it('trims and caps the message and adds app context', () => {
    const f = buildFeedback(
      {
        category: 'bug',
        message: `  ${'x'.repeat(FEEDBACK_MAX_LENGTH + 10)}  `,
        screen: null,
        householdId: 'h',
        locale: 'en',
      },
      new Date('2026-10-06T10:00:00Z'),
    );
    expect(f.message).toHaveLength(FEEDBACK_MAX_LENGTH);
    expect(f.createdAt).toBe('2026-10-06T10:00:00.000Z');
    expect(f.platform).toBeTruthy();
  });

  it('queues the report on the device through the outbox', async () => {
    await renderWithProviders(<AlphaFeedbackScreen />);
    await fireEvent.press(screen.getByTestId('alpha-feedback.category.idea'));
    await fireEvent.changeText(
      screen.getByTestId('alpha-feedback.message'),
      'The swap sheet is great',
    );
    await fireEvent.press(screen.getByTestId('alpha-feedback.send'));
    const [entry] = useOutboxStore.getState().entries;
    expect(entry?.kind).toBe(ALPHA_FEEDBACK_KIND);
    expect(entry?.payload).toMatchObject({ category: 'idea', message: 'The swap sheet is great' });
    expect(screen.getByTestId('alpha-feedback.sent')).toBeTruthy();
  });
});
