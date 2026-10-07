/** Query key factory (09 §3). Later sprints extend it in place. */
type Id = string;

export const qk = {
  me: () => ['me'] as const,
  notifications: () => [...qk.me(), 'notifications'] as const,
  notificationPreferences: () => [...qk.me(), 'notification-preferences'] as const,
  profile: () => [...qk.me(), 'profile'] as const,
  consents: () => [...qk.me(), 'consents'] as const,
  subscription: () => [...qk.me(), 'subscription'] as const,
  /** Sprint 5: server entitlements per household context (17 §6) and the store offering. */
  entitlements: (hid: Id | null) => [...qk.me(), 'entitlements', hid ?? 'none'] as const,
  offering: () => [...qk.me(), 'offering'] as const,
  memoryEnabled: () => [...qk.me(), 'ai-memory-enabled'] as const,
  households: () => [...qk.me(), 'households'] as const,
  featureFlags: () => ['feature-flags'] as const,
  minSupportedVersion: (uid: Id | null) => ['feature-flags', 'min-supported-version', uid] as const,
  household: (hid: Id) => {
    const base = ['household', hid] as const;
    return {
      all: () => base,
      detail: () => [...base, 'detail'] as const,
      members: () => [...base, 'household-members'] as const,
      invitations: () => [...base, 'invitations'] as const,
      familyMembers: () => [...base, 'family-members'] as const,
      budgetProfile: () => [...base, 'budget-profile'] as const,
      assessment: () => [...base, 'assessment'] as const,
      premium: () => [...base, 'premium'] as const,
      mealPlans: () => [...base, 'meal-plans'] as const,
      activePlan: () => [...base, 'meal-plans', 'active'] as const,
      mealPlan: (planId: Id) => [...base, 'meal-plans', planId] as const,
      planRecommendations: (planId: Id) =>
        [...base, 'meal-plans', planId, 'recommendations'] as const,
      /** Every planned-meal read; invalidate this after a serving write or a swap. */
      dailyMeals: () => [...base, 'daily-meals'] as const,
      dailyMealsRange: (planId: Id, from: string, to: string) =>
        [...base, 'daily-meals', planId, from, to] as const,
      dailyMeal: (dailyMealId: Id) => [...base, 'daily-meals', 'one', dailyMealId] as const,
      /** Sprint 4: grocery, budget and trackers. */
      groceryLists: () => [...base, 'grocery-lists'] as const,
      groceryList: (listId: Id) => [...base, 'grocery-lists', listId] as const,
      priceProfile: () => [...base, 'price-profile'] as const,
      budgetEntries: (month: string) => [...base, 'budget-entries', month] as const,
      hydrationTargets: () => [...base, 'hydration-targets'] as const,
      hydrationLogs: (from: string) => [...base, 'hydration-logs', from] as const,
      fastingLogs: () => [...base, 'fasting-logs'] as const,
      fastingSafety: () => [...base, 'fasting-safety'] as const,
      qadaBalance: () => [...base, 'qada-balance'] as const,
      weightLogs: (memberId: Id) => [...base, 'weight-logs', memberId] as const,
      journal: (memberId: Id) => [...base, 'journal', memberId] as const,
      /** Sprint 5: chat (private to the user by RLS), memories, meal logs and Ramadan. */
      chatSessions: () => [...base, 'chat-sessions'] as const,
      chatMessages: (sessionId: Id) => [...base, 'chat-sessions', sessionId, 'messages'] as const,
      memories: () => [...base, 'ai-memories'] as const,
      mealLogs: () => [...base, 'meal-logs'] as const,
      ramadanPlan: (hijriYear: number) => [...base, 'ramadan-plan', hijriYear] as const,
      /** Sprint 6: growth, exposures and ladders, safe foods, sensory profile, exports, insights. */
      growth: (memberId: Id) => [...base, 'growth', memberId] as const,
      exposures: (memberId: Id) => [...base, 'food-exposures', memberId] as const,
      ladders: (memberId: Id) => [...base, 'exposure-ladders', memberId] as const,
      ladder: (ladderId: Id) => [...base, 'exposure-ladders', 'one', ladderId] as const,
      safeFoods: (memberId: Id) => [...base, 'safe-foods', memberId] as const,
      sensoryProfile: (memberId: Id) => [...base, 'sensory-profile', memberId] as const,
      pickySummary: (memberId: Id, days: number) =>
        [...base, 'picky-summary', memberId, days] as const,
      exposurePairs: () => [...base, 'exposure-pairs'] as const,
      exports: () => [...base, 'exports'] as const,
      insights: (weeks: number) => [...base, 'insights', weeks] as const,
    };
  },
  /** Sprint 6: account privacy state (deletion countdown, analytics opt-out). */
  account: () => [...qk.me(), 'account'] as const,
  catalog: {
    growthLms: (reference: string, indicator: string, sex: string) =>
      ['catalog', 'growth-lms', reference, indicator, sex] as const,
    ingredientSearch: (q: string) => ['catalog', 'ingredient-search', q] as const,
    ingredients: (ids: readonly Id[]) =>
      ['catalog', 'ingredients', [...ids].sort().join(',')] as const,
    coachingTips: (module: string) => ['catalog', 'coaching-tips', module] as const,
    allergens: () => ['catalog', 'allergens'] as const,
    budgetCategories: () => ['catalog', 'budget-categories'] as const,
    mealAlternatives: (mealId: Id) => ['catalog', 'meal-alternatives', mealId] as const,
    recipe: (recipeId: Id) => ['catalog', 'recipe', recipeId] as const,
    mealRecipes: (mealId: Id) => ['catalog', 'meal-recipes', mealId] as const,
    sunnahSources: (ingredientIds: readonly Id[], locale: string) =>
      ['catalog', 'sunnah-sources', [...ingredientIds].sort().join(','), locale] as const,
  },
  knowledge: {
    recommendation: (id: Id, locale: string) =>
      ['knowledge', 'recommendation', id, locale] as const,
    source: (id: Id) => ['knowledge', 'source', id] as const,
    recommendationsForSources: (sourceIds: readonly Id[]) =>
      ['knowledge', 'recommendations-for-sources', [...sourceIds].sort().join(',')] as const,
    verifiedRecommendations: () => ['knowledge', 'recommendations', 'verified'] as const,
    sources: (ids: readonly Id[], locale: string) =>
      ['knowledge', 'sources', [...ids].sort().join(','), locale] as const,
    evidence: (id: Id) => ['knowledge', 'evidence', id] as const,
  },
} as const;
