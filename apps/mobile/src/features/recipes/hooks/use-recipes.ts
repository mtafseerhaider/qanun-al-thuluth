import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';

import { fetchRecipe, fetchSunnahSourceIds } from '../api/recipes-api';

const STALE_MS = 10 * 60_000;

export function useRecipe(recipeId: string) {
  return useQuery({
    queryKey: qk.catalog.recipe(recipeId),
    queryFn: () => fetchRecipe(recipeId),
    enabled: isSupabaseConfigured,
    staleTime: STALE_MS,
  });
}

/** Verified Islamic sources that name one of the recipe's Sunnah ingredients. */
export function useSunnahSourceIds(ingredientIds: readonly string[]) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: qk.catalog.sunnahSources(ingredientIds, i18n.language),
    queryFn: () => fetchSunnahSourceIds(ingredientIds),
    enabled: ingredientIds.length > 0 && isSupabaseConfigured,
    staleTime: STALE_MS,
  });
}
