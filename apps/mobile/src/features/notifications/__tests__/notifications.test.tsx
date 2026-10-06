import type { ComponentProps } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';

import { useOutboxStore } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';
import { useSessionStore } from '@/stores/use-session-store';
import { renderWithProviders } from '@/test/render';

import { inboxItems, NOTIFICATION_READ_KIND } from '../hooks/use-notifications';
import { NotificationsCenterScreen } from '../screens/notifications-center-screen';
import { NOTIFICATION_GROUPS } from '../utils/notification-preferences';
import {
  inboxDelivery,
  NOTIFICATION_KINDS,
  targetForKind,
  targetForNotification,
  targetForRoute,
  type InboxRow,
} from '../utils/notification-routing';
import {
  clearPendingNotification,
  flushPendingNotification,
  openNotificationTarget,
  pendingNotificationTarget,
  type NavigatorLike,
} from '../utils/open-notification';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const mockRootNavigate = jest.fn();
jest.mock('@/navigation/navigation-ref', () => ({
  navigationRef: {
    isReady: () => true,
    getRootState: () => ({ routes: [{ name: 'Main' }] }),
    navigate: (...args: unknown[]) => mockRootNavigate(...args),
  },
}));

const PLAN_ID = '4b8f2a52-3a1d-4a8e-9c31-0f5e1c2d3b4a';
const MEAL_ID = '9e1d7c66-2f0b-4d2e-8a55-6b7c8d9e0f1a';
const NOW = new Date('2026-10-06T12:00:00Z');

const row = (over: Partial<InboxRow>): InboxRow => ({
  id: 'n-1',
  kind: 'hydration_reminder',
  title: 'Water before lunch',
  body: 'A glass now leaves room for food.',
  data: { route: 'thuluth://hydration' },
  status: 'sent',
  channel: 'push',
  scheduledFor: '2026-10-06T11:30:00Z',
  readAt: null,
  ...over,
});

beforeEach(() => {
  useOutboxStore.getState().reset();
  mockRootNavigate.mockClear();
  clearPendingNotification();
});

describe('notification deep links (FR-NOT-04)', () => {
  it('maps every route the dispatcher sends to a screen', () => {
    expect(targetForRoute('thuluth://today')).toEqual({ tab: 'TodayTab', screen: 'Dashboard' });
    expect(targetForRoute(`thuluth://meal/${MEAL_ID}`)).toEqual({
      tab: 'TodayTab',
      screen: 'MealDetail',
      params: { dailyMealId: MEAL_ID },
    });
    expect(targetForRoute('thuluth://hydration')).toEqual({
      tab: 'MoreTab',
      screen: 'HydrationTracker',
    });
    expect(targetForRoute(`thuluth://plan/${PLAN_ID}`)).toEqual({
      tab: 'PlanTab',
      screen: 'MealPlanDetail',
      params: { mealPlanId: PLAN_ID },
    });
    expect(targetForRoute('thuluth://plans')).toEqual({ tab: 'PlanTab', screen: 'MealPlans' });
    expect(targetForRoute('thuluth://ramadan')).toEqual({
      tab: 'MoreTab',
      screen: 'FastingTracker',
    });
    expect(targetForRoute('thuluth://fasting')).toEqual({
      tab: 'MoreTab',
      screen: 'FastingTracker',
    });
    expect(targetForRoute('https://thuluth.app/hydration/')).toEqual({
      tab: 'MoreTab',
      screen: 'HydrationTracker',
    });
  });

  it('rejects unknown or malformed routes and falls back by kind', () => {
    expect(targetForRoute('thuluth://meal/not-a-uuid')).toBeNull();
    expect(targetForRoute('https://evil.example/hydration')).toBeNull();
    expect(targetForRoute('thuluth://hydration/x/y')).toBeNull();
    expect(targetForNotification({ kind: 'iftar_reminder', data: {} })).toEqual({
      tab: 'MoreTab',
      screen: 'FastingTracker',
    });
    expect(
      targetForNotification({
        kind: 'plan_ready',
        data: { deeplink: `thuluth://plan/${PLAN_ID}` },
      }),
    ).toMatchObject({ screen: 'MealPlanDetail' });
    expect(targetForKind('billing_issue')).toEqual({
      tab: 'TodayTab',
      screen: 'NotificationsCenter',
    });
  });

  it('parks a tap that arrives before the app is ready and opens it once Main is mounted', () => {
    const navigate = jest.fn();
    let ready = false;
    const ref: NavigatorLike = {
      isReady: () => ready,
      getRootState: () => ({ routes: [{ name: ready ? 'Main' : 'Boot' }] }),
      navigate,
    };
    const target = targetForNotification({
      kind: 'hydration_reminder',
      data: { route: 'thuluth://hydration' },
    });
    expect(openNotificationTarget(target, ref)).toBe(false);
    expect(pendingNotificationTarget()).toEqual(target);
    expect(navigate).not.toHaveBeenCalled();
    ready = true;
    expect(flushPendingNotification(ref)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('Main', {
      screen: 'MoreTab',
      params: { screen: 'HydrationTracker', initial: false },
    });
    expect(pendingNotificationTarget()).toBeNull();
  });
});

describe('quiet hours and the inbox (FR-NOT-02, 02 §7.13.1)', () => {
  it('lists a reminder held by quiet hours as quiet, and hides switched-off or future ones', () => {
    const quiet = row({
      status: 'cancelled',
      data: { route: 'thuluth://hydration', dispatch: { reason: 'quiet_hours' } },
    });
    expect(inboxDelivery(quiet, NOW)).toBe('quiet');
    expect(inboxDelivery(row({}), NOW)).toBe('pushed');
    expect(
      inboxDelivery(row({ status: 'cancelled', data: { dispatch: { reason: 'disabled' } } }), NOW),
    ).toBeNull();
    expect(inboxDelivery(row({ scheduledFor: '2026-10-06T13:00:00Z' }), NOW)).toBeNull();
    expect(inboxDelivery(row({ status: 'pending' }), NOW)).toBeNull();
  });

  it('applies queued read receipts', () => {
    useOutboxStore.getState().enqueue({
      kind: NOTIFICATION_READ_KIND,
      scope: 'me',
      payload: { ids: ['n-1'], at: NOW.toISOString() },
    });
    const items = inboxItems([row({})], useOutboxStore.getState().entries, NOW);
    expect(items[0]).toMatchObject({ read: true, delivery: 'pushed' });
  });

  it('opens a quiet reminder from the inbox in its tracker and marks it read', async () => {
    useSessionStore.setState({ userId: 'u-1' });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    client.setQueryData(qk.notifications(), [
      row({
        id: 'n-quiet',
        status: 'cancelled',
        scheduledFor: '2020-01-01T00:00:00Z',
        data: { route: 'thuluth://hydration', dispatch: { reason: 'quiet_hours' } },
      }),
      row({
        id: 'n-fast',
        kind: 'suhoor_reminder',
        title: 'Suhoor ends soon',
        scheduledFor: '2020-01-01T00:00:00Z',
        data: { route: 'thuluth://ramadan' },
      }),
    ]);
    await renderWithProviders(
      <NotificationsCenterScreen
        {...({ navigation: { navigate: jest.fn() } } as unknown as ComponentProps<
          typeof NotificationsCenterScreen
        >)}
      />,
      { queryClient: client },
    );
    expect(screen.getByTestId('notifications.row-0.quiet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('notifications.row-0'));
    expect(mockRootNavigate).toHaveBeenCalledWith('Main', {
      screen: 'MoreTab',
      params: { screen: 'HydrationTracker', initial: false },
    });
    const receipt = useOutboxStore
      .getState()
      .entries.find((e) => e.kind === NOTIFICATION_READ_KIND);
    expect(receipt?.payload).toMatchObject({ ids: ['n-quiet'] });
    expect(await screen.findByTestId('notifications.row-1.unread')).toBeTruthy();
    expect(screen.queryByTestId('notifications.row-0.unread')).toBeNull();

    await fireEvent.press(screen.getByTestId('notifications.row-1'));
    expect(mockRootNavigate).toHaveBeenLastCalledWith('Main', {
      screen: 'MoreTab',
      params: { screen: 'FastingTracker', initial: false },
    });
  });
});

describe('notification settings groups', () => {
  it('lists every kind exactly once', () => {
    const listed = NOTIFICATION_GROUPS.flatMap((g) => g.kinds);
    expect([...listed].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });
});
