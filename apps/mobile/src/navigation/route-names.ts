/** Const route name map (07 §4). Values match the ParamList keys in types.ts. */
export const ROUTES = {
  Boot: 'Boot',
  Auth: 'Auth',
  Onboarding: 'Onboarding',
  Main: 'Main',
  AuthWelcome: 'AuthWelcome',
  Login: 'Login',
  OtpVerify: 'OtpVerify',
  OnboardingWelcome: 'OnboardingWelcome',
  TodayTab: 'TodayTab',
  PlanTab: 'PlanTab',
  ChatTab: 'ChatTab',
  FamilyTab: 'FamilyTab',
  MoreTab: 'MoreTab',
  Dashboard: 'Dashboard',
  MealPlans: 'MealPlans',
  ChatThread: 'ChatThread',
  FamilyManagement: 'FamilyManagement',
  MoreHome: 'MoreHome',
  Debug: 'Debug',
} as const;

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];
