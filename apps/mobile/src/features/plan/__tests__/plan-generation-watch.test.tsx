import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { RawPlan } from '../api/plan-api';
import { usePlanGenerationWatch } from '../hooks/use-plans';

jest.mock('@/lib/env', () => ({
  ...jest.requireActual('@/lib/env'),
  isSupabaseConfigured: true,
}));

const mockFetchMealPlan = jest.fn();
jest.mock('../api/plan-api', () => ({
  ...jest.requireActual('../api/plan-api'),
  fetchMealPlan: (id: string) => mockFetchMealPlan(id),
}));

type Sub = {
  onChange: (row: RawPlan) => void;
  onStatus: (s: 'subscribed' | 'error' | 'closed') => void;
  filter: string;
};
const mockSubs: Sub[] = [];
const mockUnsubscribe = jest.fn();
jest.mock('@/lib/supabase/realtime', () => ({
  subscribeToRowChanges: (opts: Sub) => {
    mockSubs.push(opts);
    return mockUnsubscribe;
  },
}));

const raw = (status: RawPlan['status'], phase = 'generating'): RawPlan => ({
  id: 'plan-1',
  household_id: 'h1',
  kind: 'standard',
  status,
  title: null,
  start_date: '2026-10-06',
  end_date: '2026-10-12',
  week_count: 1,
  rationale: status === 'draft' ? 'Built around daal and seasonal vegetables.' : null,
  version: 1,
  parent_plan_id: null,
  failure_reason: null,
  generation_progress: { phase, completed_weeks: 0, total_weeks: 1, attempt: 1 },
  weekly_themes: [],
  created_at: '2026-10-06T08:00:00Z',
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  mockSubs.length = 0;
  mockFetchMealPlan.mockReset();
  mockUnsubscribe.mockReset();
});

describe('usePlanGenerationWatch (24 S3-07)', () => {
  it('subscribes to the plan row and applies Realtime changes without waiting for a poll', async () => {
    const { toPlanView } = jest.requireActual('../api/plan-api');
    mockFetchMealPlan.mockResolvedValue(toPlanView(raw('generating')));
    const { result, unmount } = await renderHook(
      () => usePlanGenerationWatch({ householdId: 'h1', mealPlanId: 'plan-1', pollAfterMs: 2000 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.plan?.status).toBe('generating'));
    expect(mockSubs[0]?.filter).toBe('id=eq.plan-1');

    await act(async () => {
      mockSubs[0]?.onStatus('subscribed');
    });
    await waitFor(() => expect(result.current.realtime).toBe('subscribed'));
    await act(async () => {
      mockSubs[0]?.onChange(raw('generating', 'validating'));
    });
    await waitFor(() => expect(result.current.stage.stage).toBe('checking'));
    await act(async () => {
      mockSubs[0]?.onChange(raw('draft', 'done'));
    });
    await waitFor(() => expect(result.current.outcome).toBe('ready'));
    expect(result.current.plan?.rationale).toMatch(/daal/);
    expect(mockFetchMealPlan).toHaveBeenCalledTimes(1);

    await unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('falls back to polling at poll_after_ms when Realtime fails', async () => {
    jest.useFakeTimers();
    try {
      const { toPlanView } = jest.requireActual('../api/plan-api');
      mockFetchMealPlan
        .mockResolvedValueOnce(toPlanView(raw('generating')))
        .mockResolvedValueOnce(toPlanView(raw('generating', 'writing')))
        .mockResolvedValue(toPlanView(raw('draft', 'done')));
      const { result } = await renderHook(
        () =>
          usePlanGenerationWatch({ householdId: 'h1', mealPlanId: 'plan-1', pollAfterMs: 1500 }),
        { wrapper: wrapper() },
      );
      await waitFor(() => expect(result.current.plan?.status).toBe('generating'));
      await act(async () => {
        mockSubs[0]?.onStatus('error');
      });

      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      await waitFor(() => expect(result.current.stage.stage).toBe('saving'));
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      await waitFor(() => expect(result.current.outcome).toBe('ready'));
      const calls = mockFetchMealPlan.mock.calls.length;

      // Final: polling stops.
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
      expect(mockFetchMealPlan.mock.calls.length).toBe(calls);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a timeout after 120 s while still generating', async () => {
    const { toPlanView } = jest.requireActual('../api/plan-api');
    mockFetchMealPlan.mockResolvedValue(toPlanView(raw('generating')));
    const now = () => 1_000_000;
    const { result } = await renderHook(
      () =>
        usePlanGenerationWatch({
          householdId: 'h1',
          mealPlanId: 'plan-1',
          startedAt: now() - 121_000,
          now,
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.timedOut).toBe(true));
  });
});
