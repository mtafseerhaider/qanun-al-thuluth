import { clearOutboxHandlers, flushOutbox, useOutboxStore } from '@/lib/offline/outbox';

import {
  buildFeedback,
  registerAlphaFeedbackOutboxHandler,
  submitAlphaFeedback,
} from '../api/alpha-feedback-api';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const mockUpsert = jest.fn(async (_row: unknown, _opts: unknown) => ({ error: null }));
jest.mock('@/lib/supabase/client', () => ({
  supabase: { from: () => ({ upsert: (row: unknown, opts: unknown) => mockUpsert(row, opts) }) },
}));

beforeEach(() => {
  useOutboxStore.getState().reset();
  clearOutboxHandlers();
  mockUpsert.mockClear();
});

describe('alpha feedback sync (Sprint 4, alpha_feedback table)', () => {
  it('inserts a queued report once, keyed by the outbox id, with the client time', async () => {
    const id = submitAlphaFeedback(
      buildFeedback(
        {
          category: 'idea',
          message: ' Love the water ring ',
          screen: 'Dashboard',
          householdId: 'h1',
          locale: 'ur',
        },
        new Date('2026-10-06T10:00:00Z'),
      ),
    );
    registerAlphaFeedbackOutboxHandler();
    expect((await flushOutbox()).sent).toBe(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        household_id: 'h1',
        category: 'idea',
        message: 'Love the water ring',
        screen: 'Dashboard',
        locale: 'ur',
        client_created_at: '2026-10-06T10:00:00.000Z',
      }),
      { onConflict: 'id', ignoreDuplicates: true },
    );
    expect(useOutboxStore.getState().entries).toHaveLength(0);
  });
});
