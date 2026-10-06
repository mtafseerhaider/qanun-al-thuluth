/** Query key factory (09 §3). Sprint 4 subset; later sprints extend it in place. */
type Id = string;

export const qk = {
  me: () => ['me'] as const,
  notifications: () => [...qk.me(), 'notifications'] as const,
  notificationPreferences: () => [...qk.me(), 'notification-preferences'] as const,
  profile: () => [...qk.me(), 'profile'] as const,
  consents: () => [...qk.me(), 'consents'] as const,
  subscription: () => [...qk.me(), 'subscription'] as const,
  households: () => [...qk.me(), 'households'] as const,
  featureFlags: () => ['feature-flags'] as const,
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
    };
  },
  catalog: {
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
  debug: {
    aiSmoke: () => ['debug', 'ai-smoke'] as const,
  },
} as const;
