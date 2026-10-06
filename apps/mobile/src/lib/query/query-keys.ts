/** Query key factory (09 §3). Sprint 3 subset; later sprints extend it in place. */
type Id = string;

export const qk = {
  me: () => ['me'] as const,
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
    };
  },
  catalog: {
    allergens: () => ['catalog', 'allergens'] as const,
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
