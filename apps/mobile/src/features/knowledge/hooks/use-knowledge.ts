import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { SourceTradition } from '@shared';

import { useProfile } from '@/hooks/use-profile';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';

import { fetchEvidence, fetchPublicSources, fetchRecommendation } from '../api/knowledge-api';

/** Content changes rarely, but a retraction must show within minutes (13 §12 criterion 8). */
const STALE_MS = 5 * 60_000;

export function useTraditionPreference(): SourceTradition {
  const profile = useProfile();
  return (profile.data?.tradition_preference as SourceTradition | undefined) ?? 'shared';
}

export function useRecommendation(id: string | undefined) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: qk.knowledge.recommendation(id ?? 'none', i18n.language),
    queryFn: () => fetchRecommendation(id as string, i18n.language),
    enabled: Boolean(id) && isSupabaseConfigured,
    staleTime: STALE_MS,
  });
}

export function useIslamicSource(id: string | undefined) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: [...qk.knowledge.source(id ?? 'none'), i18n.language],
    queryFn: async () =>
      (
        await fetchPublicSources([{ id: id as string, relationship: 'supports' }], i18n.language)
      )[0] ?? null,
    enabled: Boolean(id) && isSupabaseConfigured,
    staleTime: STALE_MS,
  });
}

export function useScientificEvidence(id: string | undefined) {
  return useQuery({
    queryKey: qk.knowledge.evidence(id ?? 'none'),
    queryFn: async () =>
      (await fetchEvidence([{ id: id as string, relationship: 'supports' }]))[0] ?? null,
    enabled: Boolean(id) && isSupabaseConfigured,
    staleTime: STALE_MS,
  });
}
