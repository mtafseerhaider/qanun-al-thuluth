import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics/track';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { RootStackParamList } from '@/navigation/types';

import { EvidenceCard, KnowledgeEmptyState, SourceCard } from '../components/knowledge-parts';
import {
  useIslamicSource,
  useRecommendation,
  useScientificEvidence,
  useTraditionPreference,
} from '../hooks/use-knowledge';
import { evidenceForDisplay, sourcesForDisplay, visibleTraditions } from '../utils/knowledge-rules';

type Props = NativeStackScreenProps<RootStackParamList, 'SourceDetailSheet'>;

const openLink = (url: string) => {
  track('evidence_link_opened', {});
  void Linking.openURL(url);
};

/**
 * X19 Source Detail (02 §7.7.5, 13 §5.4, 24 S2-14): a recommendation's three parts in full, or a
 * single source or study. Only verified sources from `islamic_sources_public` render; a source that
 * is not (or no longer) verified shows "withdrawn for review", and with no verified content at all
 * the empty state explains that scholars are still reviewing.
 */
export function SourceDetailSheet({ route, navigation }: Props) {
  const { recommendationId, islamicSourceId, scientificEvidenceId } = route.params;
  const { t } = useTranslation(['knowledge', 'errors']);
  const tradition = useTraditionPreference();
  const rec = useRecommendation(recommendationId);
  const source = useIslamicSource(recommendationId ? undefined : islamicSourceId);
  const evidence = useScientificEvidence(
    recommendationId || islamicSourceId ? undefined : scientificEvidenceId,
  );
  const active = recommendationId ? rec : islamicSourceId ? source : evidence;
  const sources = rec.data ? sourcesForDisplay(rec.data.sources, tradition) : [];
  const studies = rec.data ? evidenceForDisplay(rec.data.evidence) : [];
  const singleSource =
    source.data && visibleTraditions(tradition).includes(source.data.tradition)
      ? source.data
      : null;

  useEffect(() => {
    if (!active.data) return;
    track('source_detail_viewed', {
      kind: recommendationId ? 'recommendation' : islamicSourceId ? 'islamic_source' : 'evidence',
      tradition,
      has_science: recommendationId ? studies.length > 0 : Boolean(evidence.data),
    });
    // Fire once per loaded item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.data]);

  return (
    <Screen testID="sheet.source-detail">
      {active.isLoading ? (
        <Text tone="muted" testID="sheet.source-detail.loading">
          {t('knowledge:loading')}
        </Text>
      ) : active.isError ? (
        <View className="gap-2" testID="sheet.source-detail.error">
          <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(active.error)}`)} />
          <Button
            label={t('knowledge:retry')}
            variant="secondary"
            onPress={() => void active.refetch()}
          />
        </View>
      ) : recommendationId ? (
        rec.data ? (
          <View className="gap-4">
            <Text variant="title" accessibilityRole="header">
              {rec.data.title}
            </Text>
            <View className="gap-1">
              <Text variant="overline" tone="muted">
                {t('knowledge:card.whatToDo')}
              </Text>
              <Text>{rec.data.practical}</Text>
            </View>
            <Text variant="heading" accessibilityRole="header">
              {t('knowledge:card.fromTradition')}
            </Text>
            {sources.length > 0 ? (
              sources.map((s) => (
                <SourceCard key={s.id} source={s} testID={`sheet.source-detail.source.${s.id}`} />
              ))
            ) : (
              <Text tone="muted" testID="sheet.source-detail.no-tradition-source">
                {t('knowledge:noSourceForTradition')}
              </Text>
            )}
            <Text variant="heading" accessibilityRole="header">
              {t('knowledge:card.research')}
            </Text>
            {studies.map((e) => (
              <EvidenceCard
                key={e.id}
                evidence={e}
                onOpenLink={openLink}
                testID={`sheet.source-detail.evidence.${e.id}`}
              />
            ))}
          </View>
        ) : (
          <KnowledgeEmptyState testID="sheet.source-detail.empty" />
        )
      ) : islamicSourceId ? (
        singleSource ? (
          <SourceCard source={singleSource} testID="sheet.source-detail.source" />
        ) : (
          <Text tone="muted" testID="sheet.source-detail.withdrawn">
            {t('knowledge:withdrawn')}
          </Text>
        )
      ) : evidence.data ? (
        <EvidenceCard
          evidence={evidence.data}
          onOpenLink={openLink}
          testID="sheet.source-detail.evidence"
        />
      ) : (
        <KnowledgeEmptyState testID="sheet.source-detail.empty" />
      )}
      <Text variant="caption" tone="muted">
        {t('knowledge:scholarNotice')}
      </Text>
      <Text variant="caption" tone="muted">
        {t('knowledge:guidanceNotCure')}
      </Text>
      <Button
        label={t('knowledge:close')}
        variant="secondary"
        onPress={() => navigation.goBack()}
        testID="sheet.source-detail.close"
      />
    </Screen>
  );
}
