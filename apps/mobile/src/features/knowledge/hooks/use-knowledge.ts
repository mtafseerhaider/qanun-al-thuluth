import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { SourceTradition } from '@shared';

import { useProfile } from '@/hooks/use-profile';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';

import {
  fetchEvidence,
  fetchPublicSources,
  fetchRecommendation,
  fetchRecommendationIdsForSources,
  fetchVerifiedRecommendationIds,
} from '../api/knowledge-api';

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

/**
 * Verified Islamic sources by id (recipe Sunnah badge, 24 S3-09). Unverified ids simply do not come
 * back (RLS on `islamic_sources_public`), so an empty result means "show nothing".
 */
export function usePublicSources(ids: readonly string[]) {
  const { i18n } = useTranslation();
  const sorted = [...new Set(ids)].sort();
  return useQuery({
    queryKey: qk.knowledge.sources(sorted, i18n.language),
    queryFn: () =>
      fetchPublicSources(
        sorted.map((id) => ({ id, relationship: 'supports' as const })),
        i18n.language,
      ),
    enabled: sorted.length > 0 && isSupabaseConfigured,
    staleTime: STALE_MS,
  });
}

export function useRecommendationIdsForSources(sourceIds: readonly string[]) {
  const sorted = [...new Set(sourceIds)].sort();
  return useQuery({
    queryKey: qk.knowledge.recommendationsForSources(sorted),
    queryFn: () => fetchRecommendationIdsForSources(sorted),
    enabled: sorted.length > 0 && isSupabaseConfigured,
    staleTime: STALE_MS,
  });
}

/** Verified recommendation ids (cached and persisted, so the tip of the day works offline). */
export function useVerifiedRecommendationIds() {
  return useQuery({
    queryKey: qk.knowledge.verifiedRecommendations(),
    queryFn: () => fetchVerifiedRecommendationIds(),
    enabled: isSupabaseConfigured,
    staleTime: STALE_MS,
  });
}
