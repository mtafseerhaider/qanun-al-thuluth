import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { fetchFeatureFlags } from '@/lib/feature-flags/feature-flags-api';
import { qk } from '@/lib/query/query-keys';
import {
  selectFlag,
  useFeatureFlagStore,
  type FeatureFlagKey,
} from '@/stores/use-feature-flag-store';

/** Reads a feature flag. Safe default is disabled until the server says otherwise (09 §5.10). */
export function useFeatureFlag(key: FeatureFlagKey): boolean {
  const setFlags = useFeatureFlagStore((s) => s.setFlags);
  const query = useQuery({
    queryKey: qk.featureFlags(),
    queryFn: fetchFeatureFlags,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (query.data && Object.keys(query.data).length > 0) setFlags(query.data);
  }, [query.data, setFlags]);

  return useFeatureFlagStore(selectFlag(key));
}
