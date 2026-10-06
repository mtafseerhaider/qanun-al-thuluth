import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { AssistantTurn } from '../components/assistant-turn';
import { applyChatEvent, isTurnActive, newTurn, type ChatTurn } from '../utils/chat-stream';

const SESSION = '11111111-1111-4111-8111-111111111111';

/**
 * ai-chat now sends `message.start` only after safety classification and intent routing (a few
 * hundred ms after the request). The pending state must start when the user sends, not then.
 */
describe('chat pending state before message.start', () => {
  const sent = newTurn({ clientMessageId: 'c1', userText: 'Is dates with milk okay?' });

  it('is active from the moment of sending, so the composer shows Stop', () => {
    expect(sent.status).toBe('sending');
    expect(isTurnActive(sent)).toBe(true);
  });

  it('stays pending through events that arrive before message.start', () => {
    const turn = applyChatEvent(sent, {
      type: 'follow_up',
      data: { suggestions: [] },
    } as never);
    expect(turn.status).toBe('sending');
    expect(isTurnActive(turn)).toBe(true);
  });

  it('moves to streaming on message.start', () => {
    const turn = applyChatEvent(sent, {
      type: 'message.start',
      data: {
        session_id: SESSION,
        user_message_id: SESSION,
        assistant_message_id: SESSION,
        quota: null,
      },
    } as never);
    expect(turn.status).toBe('streaming');
  });

  it('renders "Thinking…" for a turn that has no server event yet', async () => {
    const noop = jest.fn();
    const render = (turn: ChatTurn) =>
      renderWithProviders(
        <AssistantTurn
          turn={turn}
          countryCode="PK"
          canEdit
          online
          actionFor={() => ({ kind: 'invalid' }) as never}
          memberName={() => ''}
          onConfirm={noop}
          onDismiss={noop}
          onRetry={noop}
          onOpenCitation={noop}
          onFollowUp={noop}
          onPaywall={noop}
          busy
          testID="turn"
        />,
      );
    await render(sent);
    expect(screen.getByTestId('turn.thinking')).toHaveTextContent('Thinking…');
  });
});
