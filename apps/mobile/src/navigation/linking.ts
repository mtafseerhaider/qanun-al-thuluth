import type { LinkingOptions } from '@react-navigation/native';
import { Linking } from 'react-native';

import { handleInviteUrl } from '@/lib/auth/pending-invite';

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
  config: {
    screens: {
      Main: {
        screens: {
          TodayTab: { screens: { Dashboard: 'today', MealDetail: 'meal/:dailyMealId' } },
          PlanTab: {
            screens: {
              MealPlans: 'plans',
              MealPlanDetail: 'plan/:mealPlanId',
              RecipeDetail: 'recipe/:recipeId',
            },
          },
          ChatTab: { screens: { ChatThread: 'chat/:sessionId?' } },
          FamilyTab: { screens: { FamilyManagement: 'family' } },
          MoreTab: {
            screens: {
              MoreHome: 'more',
              Debug: 'debug',
              Settings: 'settings',
              AlphaFeedback: 'feedback',
            },
          },
        },
      },
    },
  },
};
