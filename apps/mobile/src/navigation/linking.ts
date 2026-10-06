import {
  getStateFromPath as defaultGetStateFromPath,
  type LinkingOptions,
} from '@react-navigation/native';
import { Linking } from 'react-native';

import { handleInviteUrl } from '@/lib/auth/pending-invite';
import { selectFlag, useFeatureFlagStore } from '@/stores/use-feature-flag-store';

import type { RootStackParamList } from './types';

/**
 * Deep links (02 §3.4, 07 §9.6). Invite links (`/invite/:token`) are intercepted here and never
 * reach the router: the token is parked (11 §12.2) and AcceptInvite opens once the user is signed
 * in, whichever branch was mounted when the link arrived.
 */
export function filterInviteUrl(url: string | null): string | null {
  if (!url) return null;
  return handleInviteUrl(url) ? null : url;
}

/**
 * The legacy `ramadan` link (Sprint 4: fasting tracker) opens the Ramadan planner once the
 * `ramadan_planner` flag is on (Sprint 6 leftover). Pure, tested.
 */
export function rewriteRamadanPath(path: string, plannerOn: boolean): string {
  if (!plannerOn) return path;
  return path.replace(/^(\/?)ramadan(?=$|[?#/])/, '$1ramadan-planner');
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['thuluth://', 'https://thuluth.app'],
  async getInitialURL() {
    return filterInviteUrl(await Linking.getInitialURL());
  },
  subscribe(listener) {
    const sub = Linking.addEventListener('url', ({ url }) => {
      const forward = filterInviteUrl(url);
      if (forward) listener(forward);
    });
    return () => sub.remove();
  },
  getStateFromPath(path, options) {
    const plannerOn = selectFlag('ramadan_planner')(useFeatureFlagStore.getState());
    return defaultGetStateFromPath(rewriteRamadanPath(path, plannerOn), options);
  },
  config: {
    screens: {
      Main: {
        screens: {
          TodayTab: {
            screens: {
              Dashboard: 'today',
              MealDetail: 'meal/:dailyMealId',
              NotificationsCenter: 'notifications',
              DailyReflection: 'journal',
            },
          },
          PlanTab: {
            screens: {
              MealPlans: 'plans',
              MealPlanDetail: 'plan/:mealPlanId',
              RecipeDetail: 'recipe/:recipeId',
              GroceryLists: 'grocery',
              GroceryListDetail: 'grocery/:groceryListId',
            },
          },
          ChatTab: { screens: { ChatSessions: 'chats', ChatThread: 'chat/:sessionId?' } },
          FamilyTab: {
            screens: {
              FamilyManagement: 'family',
              // Sprint 6: growth (growth_measure_due, growth_alert).
              GrowthDashboard: 'growth/:familyMemberId',
            },
          },
          MoreTab: {
            screens: {
              MoreHome: 'more',
              Debug: 'debug',
              Settings: 'settings',
              AlphaFeedback: 'feedback',
              // Sprint 4 notification targets (the dispatcher's `routeFor`, FR-NOT-04).
              HydrationTracker: 'hydration',
              FastingTracker: { path: 'fasting', alias: ['ramadan'] },
              BudgetDashboard: 'budget',
              SettingsNotifications: 'settings/notifications',
              // Sprint 5: Ramadan planner, Premium and AI memory.
              RamadanPlanner: 'ramadan-planner',
              Subscription: 'premium',
              SettingsMemory: 'settings/memory',
              // Sprint 6: exports (export_ready), help, insights and privacy.
              Exports: 'exports',
              HelpCenter: 'help',
              HelpArticle: 'help/:slug',
              NutritionInsights: 'insights',
              SettingsPrivacy: 'settings/privacy',
            },
          },
        },
      },
    },
  },
};
