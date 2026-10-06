import { useNavigation } from '@react-navigation/native';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { SourceTradition } from '@shared';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';

import { fetchRecommendation } from '../api/knowledge-api';
import { useRecommendation, useTraditionPreference } from '../hooks/use-knowledge';
import {
  evidenceForDisplay,
  sourcesForDisplay,
  type RecommendationView,
} from '../utils/knowledge-rules';
import { EvidenceStrength, KnowledgeEmptyState, SourceCitationChip } from './knowledge-parts';

/**
 * `RecommendationCard` (13 §6, 24 S2-14): What to do (always first), From the tradition (source
 * chips filtered to the user's tradition, with grade labels), What research says (GRADE strength),
 * and the fixed footer line.
 */
export function RecommendationCard({
  recommendation,
  tradition,
  onOpenDetail,
  onOpenSource,
  testID = `recommendation.${recommendation.code}`,
}: {
  recommendation: RecommendationView;
  tradition: SourceTradition;
  onOpenDetail: (recommendationId: string) => void;
  onOpenSource: (islamicSourceId: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation('knowledge');
  const sources = sourcesForDisplay(recommendation.sources, tradition);
  const evidence = evidenceForDisplay(recommendation.evidence);
  const caution = evidence.find((e) => e.relationship === 'caution');
  return (
    <Card variant="elevated" testID={testID}>
      <Text variant="heading">{recommendation.title}</Text>
      <View className="gap-1">
        <Text variant="overline" tone="muted">
          {t('card.whatToDo')}
        </Text>
        <Text>{recommendation.practical}</Text>
        {caution ? (
          <Text variant="caption" tone="warning">
            {t('caution')}
          </Text>
        ) : null}
      </View>
      {sources.length > 0 ? (
        <View className="gap-2" testID={`${testID}.sources`}>
          <Text variant="overline" tone="muted">
            {t('card.fromTradition')}
          </Text>
          {sources.map((s) => (
            <View key={s.id} className="gap-1">
              <SourceCitationChip
                source={s}
                onPress={onOpenSource}
                testID={`${testID}.source.${s.id}`}
              />
              {s.grade ? (
                <Text variant="caption" tone="muted">
                  {s.gradedBy
                    ? t('gradeWithGrader', { grade: t(`grades.${s.grade}`), grader: s.gradedBy })
                    : t(`grades.${s.grade}`)}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {evidence.length > 0 ? (
        <View className="gap-2" testID={`${testID}.evidence`}>
          <Text variant="overline" tone="muted">
            {t('card.research')}
          </Text>
          {evidence.map((e) => (
            <View key={e.id} className="gap-1">
              <EvidenceStrength grade={e.grade} />
              <Text variant="caption">{e.title}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Button
        label={t('card.seeSources')}
        variant="link"
        size="sm"
        className="self-start px-0"
        onPress={() => onOpenDetail(recommendation.id)}
        testID={`${testID}.details`}
      />
      <Text variant="caption" tone="muted">
        {t('footer')}
      </Text>
    </Card>
  );
}

/** Fetches a recommendation by id and renders it; renders nothing when it is not published. */
export function RecommendationById({ id, testID }: { id: string; testID?: string }) {
  const navigation = useNavigation();
  const tradition = useTraditionPreference();
  const rec = useRecommendation(id);
  if (!rec.data) return null;
  return (
    <RecommendationCard
      recommendation={rec.data}
      tradition={tradition}
      onOpenDetail={(recommendationId) =>
        navigation.navigate('SourceDetailSheet', { recommendationId })
      }
      onOpenSource={(islamicSourceId) =>
        navigation.navigate('SourceDetailSheet', { islamicSourceId })
      }
      {...(testID ? { testID } : {})}
    />
  );
}

/**
 * Up to `max` recommendations by id (assessment "3 key recommendations", 02 §7.4.1). Only published
 * (verified) recommendations come back; with none (scholar review still pending) the empty state
 * explains why instead of an empty gap.
 */
export function RecommendationList({
  ids,
  max = 3,
  testID = 'recommendations',
}: {
  ids: readonly string[];
  max?: number;
  testID?: string;
}) {
  const navigation = useNavigation();
  const tradition = useTraditionPreference();
  const { i18n } = useTranslation();
  const unique = [...new Set(ids)].slice(0, max);
  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: qk.knowledge.recommendation(id, i18n.language),
      queryFn: () => fetchRecommendation(id, i18n.language),
      enabled: isSupabaseConfigured,
      staleTime: 5 * 60_000,
    })),
  });
  const loaded = results.flatMap((r) => (r.data ? [r.data] : []));
  const settled = results.every((r) => !r.isLoading);
  if (settled && loaded.length === 0) return <KnowledgeEmptyState testID={`${testID}.empty`} />;
  return (
    <View className="gap-3" testID={testID}>
      {loaded.map((rec, i) => (
        <RecommendationCard
          key={rec.id}
          recommendation={rec}
          tradition={tradition}
          onOpenDetail={(recommendationId) =>
            navigation.navigate('SourceDetailSheet', { recommendationId })
          }
          onOpenSource={(islamicSourceId) =>
            navigation.navigate('SourceDetailSheet', { islamicSourceId })
          }
          testID={`${testID}.item-${i}`}
        />
      ))}
    </View>
  );
}
