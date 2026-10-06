import type { LinkingOptions } from '@react-navigation/native';

import type { RootStackParamList } from './types';

/**
 * Deep links (02 §3.4, 07 §9.6). Sprint 0 maps only the registered tab roots; detail routes are
 * added with their screens. Links into Main while signed out resolve once Main is mounted.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['thuluth://', 'https://thuluth.app'],
  config: {
    screens: {
      Main: {
        screens: {
          TodayTab: { screens: { Dashboard: 'today' } },
          PlanTab: { screens: { MealPlans: 'plans' } },
          ChatTab: { screens: { ChatThread: 'chat/:sessionId?' } },
          FamilyTab: { screens: { FamilyManagement: 'family' } },
          MoreTab: { screens: { MoreHome: 'more', Debug: 'debug' } },
        },
      },
    },
  },
};
