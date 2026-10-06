import { useQuery } from '@tanstack/react-query';

import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';

import { listAllergens } from '../api/intake-api';

/** Seeded allergen catalog (EU-14 + US Big-9); global and slow-changing. */
export function useAllergens() {
  return useQuery({
    queryKey: qk.catalog.allergens(),
    queryFn: listAllergens,
    enabled: isSupabaseConfigured,
    staleTime: 24 * 3600_000,
  });
}
