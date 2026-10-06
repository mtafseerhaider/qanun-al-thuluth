/**
 * Where a notification opens (02 §3.4, FR-NOT-04). Pushes and inbox rows carry `data.route` (or
 * `data.deeplink`), a `thuluth://` link from the dispatcher's `routeFor`; when it is missing or
 * unknown the kind decides. Pure, so the mapping is tested without a navigator.
 */

export type NotificationTarget =
  | { tab: 'TodayTab'; screen: 'Dashboard' }
  | { tab: 'TodayTab'; screen: 'MealDetail'; params: { dailyMealId: string } }
  | { tab: 'TodayTab'; screen: 'NotificationsCenter' }
  | { tab: 'TodayTab'; screen: 'DailyReflection' }
  | { tab: 'PlanTab'; screen: 'MealPlans' }
  | { tab: 'PlanTab'; screen: 'MealPlanDetail'; params: { mealPlanId: string } }
  | { tab: 'PlanTab'; screen: 'GroceryLists' }
  | { tab: 'PlanTab'; screen: 'GroceryListDetail'; params: { groceryListId: string } }
  | { tab: 'MoreTab'; screen: 'HydrationTracker' }
  | { tab: 'MoreTab'; screen: 'FastingTracker' }
  | { tab: 'MoreTab'; screen: 'BudgetDashboard' }
  | { tab: 'MoreTab'; screen: 'SettingsNotifications' }
  // Sprint 6 targets.
  | { tab: 'MoreTab'; screen: 'RamadanPlanner' }
  | { tab: 'MoreTab'; screen: 'Exports' }
  | { tab: 'MoreTab'; screen: 'HelpCenter' }
  | { tab: 'MoreTab'; screen: 'NutritionInsights' }
  | { tab: 'MoreTab'; screen: 'SettingsPrivacy' }
  | { tab: 'FamilyTab'; screen: 'FamilyManagement' }
  | { tab: 'FamilyTab'; screen: 'GrowthDashboard'; params: { familyMemberId: string } };

/** Routing switches read from feature flags at open time (kept out of this pure module). */
export interface RoutingOptions {
  /** `ramadan_planner` flag: the 'ramadan' link opens the planner instead of the fasting tracker. */
  ramadanPlanner?: boolean;
}

export const NOTIFICATION_KINDS = [
  'daily_plan',
  'meal_reminder',
  'hydration_reminder',
  'meal_log_prompt',
  'journal_prompt',
  'grocery_day',
  'weekly_review',
  'plan_ready',
  'plan_failed',
  'suhoor_reminder',
  'iftar_reminder',
  'fasting_sunnah_reminder',
  'growth_measure_due',
  'growth_alert',
  'allergy_warning',
  'exposure_nudge',
  'coaching_tip',
  'invite_received',
  'invite_accepted',
  'export_ready',
  'trial_ending',
  'billing_issue',
  'marketing',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXES = ['thuluth://', 'https://thuluth.app/', 'https://www.thuluth.app/'];

const TODAY: NotificationTarget = { tab: 'TodayTab', screen: 'Dashboard' };

/** The target of a `thuluth://` route, or null when the route is not one the app knows. */
export function targetForRoute(
  route: string | null | undefined,
  opts: RoutingOptions = {},
): NotificationTarget | null {
  if (!route) return null;
  const prefix = PREFIXES.find((p) => route.startsWith(p));
  if (!prefix) return null;
  const path = (route.slice(prefix.length).split(/[?#]/)[0] ?? '').replace(/\/+$/, '');
  const [head, id, ...rest] = path.split('/');
  if (rest.length > 0) return null;
  if (head === 'settings' && id === 'privacy') return { tab: 'MoreTab', screen: 'SettingsPrivacy' };
  const withId = (f: (id: string) => NotificationTarget): NotificationTarget | null =>
    id && UUID.test(id) ? f(id) : null;
  if (id === undefined) {
    switch (head) {
      case 'today':
        return TODAY;
      case 'hydration':
        return { tab: 'MoreTab', screen: 'HydrationTracker' };
      case 'fasting':
        return { tab: 'MoreTab', screen: 'FastingTracker' };
      case 'ramadan':
        return opts.ramadanPlanner
          ? { tab: 'MoreTab', screen: 'RamadanPlanner' }
          : { tab: 'MoreTab', screen: 'FastingTracker' };
      case 'ramadan-planner':
        return { tab: 'MoreTab', screen: 'RamadanPlanner' };
      case 'exports':
        return { tab: 'MoreTab', screen: 'Exports' };
      case 'help':
        return { tab: 'MoreTab', screen: 'HelpCenter' };
      case 'insights':
        return { tab: 'MoreTab', screen: 'NutritionInsights' };
      case 'family':
        return { tab: 'FamilyTab', screen: 'FamilyManagement' };
      case 'plans':
        return { tab: 'PlanTab', screen: 'MealPlans' };
      case 'grocery':
        return { tab: 'PlanTab', screen: 'GroceryLists' };
      case 'budget':
        return { tab: 'MoreTab', screen: 'BudgetDashboard' };
      case 'notifications':
        return { tab: 'TodayTab', screen: 'NotificationsCenter' };
      case 'journal':
        return { tab: 'TodayTab', screen: 'DailyReflection' };
      default:
        return null;
    }
  }
  switch (head) {
    case 'meal':
      return withId((dailyMealId) => ({
        tab: 'TodayTab',
        screen: 'MealDetail',
        params: { dailyMealId },
      }));
    case 'plan':
      return withId((mealPlanId) => ({
        tab: 'PlanTab',
        screen: 'MealPlanDetail',
        params: { mealPlanId },
      }));
    case 'growth':
      return withId((familyMemberId) => ({
        tab: 'FamilyTab',
        screen: 'GrowthDashboard',
        params: { familyMemberId },
      }));
    case 'grocery':
      return withId((groceryListId) => ({
        tab: 'PlanTab',
        screen: 'GroceryListDetail',
        params: { groceryListId },
      }));
    default:
      return null;
  }
}

/** The fallback screen of a kind when a notification has no usable route. */
export function targetForKind(
  kind: string | null | undefined,
  data: Record<string, unknown> = {},
): NotificationTarget {
  const memberId =
    typeof data.family_member_id === 'string' && UUID.test(data.family_member_id)
      ? data.family_member_id
      : null;
  switch (kind) {
    case 'growth_measure_due':
    case 'growth_alert':
      return memberId
        ? { tab: 'FamilyTab', screen: 'GrowthDashboard', params: { familyMemberId: memberId } }
        : { tab: 'FamilyTab', screen: 'FamilyManagement' };
    case 'exposure_nudge':
    case 'coaching_tip':
      return { tab: 'FamilyTab', screen: 'FamilyManagement' };
    case 'export_ready':
      return { tab: 'MoreTab', screen: 'Exports' };
    case 'hydration_reminder':
      return { tab: 'MoreTab', screen: 'HydrationTracker' };
    case 'suhoor_reminder':
    case 'iftar_reminder':
    case 'fasting_sunnah_reminder':
      return { tab: 'MoreTab', screen: 'FastingTracker' };
    case 'plan_ready':
    case 'plan_failed':
      return { tab: 'PlanTab', screen: 'MealPlans' };
    case 'grocery_day':
      return { tab: 'PlanTab', screen: 'GroceryLists' };
    case 'journal_prompt':
      return { tab: 'TodayTab', screen: 'DailyReflection' };
    case 'daily_plan':
    case 'meal_reminder':
    case 'meal_log_prompt':
    case 'weekly_review':
      return TODAY;
    default:
      return { tab: 'TodayTab', screen: 'NotificationsCenter' };
  }
}

export function targetForNotification(
  n: {
    kind?: string | null;
    data?: unknown;
  },
  opts: RoutingOptions = {},
): NotificationTarget {
  const data = (n.data && typeof n.data === 'object' ? n.data : {}) as Record<string, unknown>;
  const route =
    typeof data.route === 'string'
      ? data.route
      : typeof data.deeplink === 'string'
        ? data.deeplink
        : null;
  return targetForRoute(route, opts) ?? targetForKind(n.kind ?? null, data);
}

/** Inbox row as stored (05 §13.2) with what the dispatcher recorded in `data.dispatch`. */
export interface InboxRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: unknown;
  status: string;
  channel: string;
  scheduledFor: string;
  readAt: string | null;
}

export type InboxDelivery = 'pushed' | 'quiet' | 'in_app';

/**
 * Which rows the inbox shows and how they were delivered (02 §7.13.1): sent pushes, in-app rows,
 * and pushes held back by quiet hours or the daily cap (they arrive silently, still openable).
 * Rows the user switched off, stale ones and pending ones are not shown.
 */
export function inboxDelivery(row: InboxRow, now: Date = new Date()): InboxDelivery | null {
  if (Date.parse(row.scheduledFor) > now.getTime()) return null;
  if (row.channel === 'in_app') return row.status === 'cancelled' ? null : 'in_app';
  if (row.status === 'sent') return 'pushed';
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as {
    dispatch?: { reason?: unknown };
  };
  const reason = typeof data.dispatch?.reason === 'string' ? data.dispatch.reason : null;
  if (row.status === 'cancelled' && (reason === 'quiet_hours' || reason === 'daily_cap'))
    return 'quiet';
  if (row.status === 'failed' && (reason === 'not_configured' || reason === 'no_subscribers'))
    return 'in_app';
  return null;
}
