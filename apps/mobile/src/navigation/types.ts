// Route names and param types (docs/02-ux-specification.md §3.3). IDs are UUID strings; dates are
// 'YYYY-MM-DD' in the household time zone. Only Sprint 0 screens are registered; the rest are typed
// ahead so later sprints add screens without touching call sites.
import type {
  CompositeScreenProps,
  NavigatorScreenParams,
  ParamListBase,
} from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { FastKind, MealType } from '@shared';

export type Uuid = string;
export type IsoDate = string; // 'YYYY-MM-DD'

export type PaywallTrigger =
  // Values shared with PaywallSheetProps['trigger'] in 08-component-architecture.md §5.17
  | 'chat_quota'
  | 'voice'
  | 'photo'
  | 'growth_chart'
  | 'exposure_ladder'
  | 'ramadan_plan'
  | 'export'
  | 'settings'
  | 'onboarding'
  // Additional triggers this spec needs; proposed extension of the 08 union
  | 'plan_multi_week'
  | 'plan_adjust'
  | 'grocery_optimize'
  | 'sensory_profile'
  | 'picky_coaching'
  | 'insights'
  | 'household_limit'
  | 'member_limit';

export type ExportKind =
  | 'meal_plan'
  | 'grocery_list'
  | 'nutrition_report'
  | 'growth_report'
  | 'ramadan_pack'
  | 'family_summary';

export type AuthStackParamList = {
  AuthWelcome: undefined;
  Login: { mode?: 'sign_in' | 'sign_up'; inviteToken?: string } | undefined;
  OtpVerify: { email: string; inviteToken?: string };
};

export type IntakeStackParamList = {
  IntakeHousehold: undefined;
  IntakeMembers: undefined;
  IntakeMemberBody: { familyMemberId: Uuid };
  IntakeMemberRoutine: { familyMemberId: Uuid };
  IntakeMemberHealth: { familyMemberId: Uuid };
  IntakeMemberAllergies: { familyMemberId: Uuid };
  IntakeMemberFood: { familyMemberId: Uuid };
  IntakeMemberGoals: { familyMemberId: Uuid };
  IntakeMemberModules: { familyMemberId: Uuid };
  IntakeModulePregnancy: { familyMemberId: Uuid; module: 'pregnancy' | 'breastfeeding' };
  IntakeModuleSensory: { familyMemberId: Uuid }; // autism
  IntakeModulePicky: { familyMemberId: Uuid }; // picky_eater, also used by autism for safe foods
  IntakeModuleAdhd: { familyMemberId: Uuid };
  IntakeBudget: undefined;
  IntakeReview: undefined;
};

export type OnboardingStackParamList = {
  OnboardingWelcome: undefined;
  OnboardingPhilosophy: undefined;
  OnboardingRegion: undefined;
  OnboardingTradition: undefined;
  OnboardingConsents: undefined;
  /** Sprint 1 steps 3 and 4 (24 S1-10, S1-11); fold into IntakeHousehold / IntakeMembers in Sprint 2. */
  OnboardingHousehold: undefined;
  OnboardingMembers: undefined;
  OnboardingNotifications: undefined;
  IntakeWizard: NavigatorScreenParams<IntakeStackParamList> | undefined;
  /** The screen runs `ai-intake-assess` itself (24 S2-15); ids are optional for a re-open. */
  AssessmentSummary: { assessmentIds?: Uuid[] } | undefined;
  /** Step 6 (24 S3-07): the screen starts generation itself; the id resumes a known plan. */
  FirstPlanGeneration: { mealPlanId?: Uuid } | undefined;
};

/**
 * Meal and recipe screens registered in both the Today and Plan stacks (Sprint 3), so the back
 * button returns to the tab the user came from.
 */
export type MealStackParamList = {
  MealDetail: { dailyMealId: Uuid };
  RecipeDetail: { recipeId: Uuid; dailyMealId?: Uuid };
};

export type TodayStackParamList = MealStackParamList & {
  Dashboard: undefined;
  DailyMeals: { date?: IsoDate; familyMemberId?: Uuid };
  DailyReflection: { date?: IsoDate; familyMemberId?: Uuid };
  NotificationsCenter: undefined;
};

export type PlanStackParamList = MealStackParamList & {
  MealPlans: undefined;
  MealPlanDetail: { mealPlanId: Uuid; weekIndex?: number };
  Recipes: { mealType?: MealType; filter?: RecipeFilterPreset; pickForDailyMealId?: Uuid };
  GroceryLists: undefined;
  GroceryListDetail: { groceryListId: Uuid };
};
export type RecipeFilterPreset =
  'kid_friendly' | 'autism_friendly' | 'ramadan_suitable' | 'budget' | 'sunnah_foods';

export type ChatStackParamList = {
  ChatSessions: undefined;
  ChatThread: { sessionId?: Uuid; prefill?: string; mealLogId?: Uuid; familyMemberId?: Uuid };
};

export type FamilyStackParamList = {
  FamilyManagement: undefined;
  MemberProfile: { familyMemberId: Uuid };
  HealthProfile: { familyMemberId: Uuid; section?: HealthSection };
  Caregivers: { householdId: Uuid };
  GrowthDashboard: { familyMemberId: Uuid; indicator?: 'wfa' | 'hfa' | 'bmi' | 'hc' };
  AutismHub: { familyMemberId: Uuid };
  SensoryProfile: { familyMemberId: Uuid };
  SafeFoods: { familyMemberId: Uuid };
  ExposureLadders: { familyMemberId: Uuid };
  ExposureLadderDetail: { ladderId: Uuid };
  FoodChaining: { familyMemberId: Uuid; ladderId?: Uuid };
  PickyEaterHub: { familyMemberId: Uuid };
  DivisionOfResponsibility: undefined;
  ExposureLog: { familyMemberId: Uuid };
  PickyCoachingPlan: { familyMemberId: Uuid };
  AcceptanceAnalytics: { familyMemberId: Uuid };
};
export type HealthSection =
  | 'conditions'
  | 'allergies'
  | 'medications'
  | 'supplements'
  | 'preferences'
  | 'dislikes'
  | 'goals'
  | 'pregnancy';

export type MoreStackParamList = {
  MoreHome: undefined;
  HydrationTracker: { familyMemberId?: Uuid; date?: IsoDate };
  FastingTracker: { familyMemberId?: Uuid };
  MealLog: { familyMemberId?: Uuid; date?: IsoDate };
  NutritionInsights: { familyMemberId?: Uuid; range?: '7d' | '30d' | '90d' };
  RamadanPlanner: { ramadanPlanId?: Uuid };
  BudgetDashboard: { month?: string /* YYYY-MM */ };
  Exports: undefined;
  Settings: undefined;
  SettingsProfile: undefined;
  SettingsLanguage: undefined;
  SettingsFaith: undefined;
  SettingsNotifications: undefined;
  SettingsAccessibility: undefined;
  SettingsPrivacy: undefined;
  SettingsHousehold: { householdId: Uuid };
  Subscription: undefined;
  HelpCenter: { query?: string };
  HelpArticle: { slug: string };
  About: undefined;
  /** Sprint 4 additions: budget settings (FR-GRO-07) and the adult weight log (FR-TRK-06). */
  BudgetSettings: undefined;
  WeightLog: { familyMemberId?: Uuid };
  /** Sprint 3 addition (24 S3-17): internal alpha feedback form. */
  AlphaFeedback: undefined;
  /** Sprint 0 addition: hidden debug tools (development builds or `debug_menu` flag). */
  Debug: undefined;
};

export type MainTabParamList = {
  TodayTab: NavigatorScreenParams<TodayStackParamList>;
  PlanTab: NavigatorScreenParams<PlanStackParamList>;
  ChatTab: NavigatorScreenParams<ChatStackParamList>;
  FamilyTab: NavigatorScreenParams<FamilyStackParamList>;
  MoreTab: NavigatorScreenParams<MoreStackParamList>;
};

export type RamadanSetupStackParamList = {
  RamadanSetupDates: undefined;
  RamadanSetupCity: undefined;
  RamadanSetupMembers: undefined;
  RamadanSetupMeals: undefined;
  RamadanSetupReview: undefined;
};

export type RootStackParamList = {
  Boot: undefined;
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  // Full-screen modals
  PaywallModal: { trigger: PaywallTrigger };
  LogMealModal: { familyMemberId?: Uuid; mealType?: MealType; date?: IsoDate };
  MealPhotoCapture: { familyMemberId?: Uuid; returnTo: 'chat' | 'meal_log'; sessionId?: Uuid };
  MealAnalysisResult: { mealLogId: Uuid; sessionId?: Uuid };
  AddFamilyMemberModal: { householdId: Uuid; source: 'family' | 'intake' };
  AddGrowthMeasurementModal: { familyMemberId: Uuid };
  GrowthAlertModal: { growthTrackingId: Uuid };
  InviteCaregiverModal: { householdId: Uuid };
  AcceptInvite: { token: string };
  PlanGenerationProgress: { mealPlanId: Uuid; pollAfterMs?: number | null };
  AdjustPlanModal: { mealPlanId: Uuid; dailyMealId?: Uuid };
  ShoppingMode: { groceryListId: Uuid };
  RamadanSetup: NavigatorScreenParams<RamadanSetupStackParamList>;
  // Sheets (formSheet)
  LogHydrationSheet: { familyMemberId?: Uuid };
  /** Sprint 4 addition (24 S4-09, FR-HYD-05): dehydration symptom check and red-flag sheet. */
  DehydrationCheckSheet: { familyMemberId?: Uuid };
  AcceptanceSheet: { dailyMealServingId: Uuid };
  SwapMealSheet: { dailyMealId: Uuid };
  FastLogSheet: { familyMemberId?: Uuid; date?: IsoDate; kind?: FastKind };
  CreateExportSheet: {
    kind?: ExportKind;
    mealPlanId?: Uuid;
    groceryListId?: Uuid;
    familyMemberId?: Uuid;
  };
  SourceDetailSheet: {
    recommendationId?: Uuid;
    islamicSourceId?: Uuid;
    scientificEvidenceId?: Uuid;
  };
  HouseholdSwitcherSheet: undefined;
  MemberPickerSheet: {
    purpose: 'filter' | 'log_meal' | 'log_hydration' | 'log_fast';
    multi?: boolean;
  };
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;
export type TodayScreenProps<T extends keyof TodayStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<TodayStackParamList, T>,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList, 'TodayTab'>,
    RootScreenProps<keyof RootStackParamList>
  >
>;
type TabScreenProps<
  TParamList extends ParamListBase,
  T extends Extract<keyof TParamList, string>,
  Tab extends keyof MainTabParamList,
> = CompositeScreenProps<
  NativeStackScreenProps<TParamList, T>,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList, Tab>,
    RootScreenProps<keyof RootStackParamList>
  >
>;
export type PlanScreenProps<T extends keyof PlanStackParamList> = TabScreenProps<
  PlanStackParamList,
  T,
  'PlanTab'
>;
export type ChatScreenProps<T extends keyof ChatStackParamList> = TabScreenProps<
  ChatStackParamList,
  T,
  'ChatTab'
>;
export type FamilyScreenProps<T extends keyof FamilyStackParamList> = TabScreenProps<
  FamilyStackParamList,
  T,
  'FamilyTab'
>;
export type MoreScreenProps<T extends keyof MoreStackParamList> = TabScreenProps<
  MoreStackParamList,
  T,
  'MoreTab'
>;
export type AuthScreenProps<T extends keyof AuthStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<AuthStackParamList, T>,
  RootScreenProps<keyof RootStackParamList>
>;
export type OnboardingScreenProps<T extends keyof OnboardingStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<OnboardingStackParamList, T>,
  RootScreenProps<keyof RootStackParamList>
>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
