import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { EvidenceGradeScience } from '@shared';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { cn } from '@/theme/cn';

import { gradeDots, type EvidenceView, type SourceView } from '../utils/knowledge-rules';

/** "Sunni source", "Shia source", "Qur'an" or "Shared source" (13 §5.4, §7.2 rule 3). */
export function traditionLabelKey(s: Pick<SourceView, 'kind' | 'tradition'>): string {
  if (s.kind === 'quran') return 'tradition.quran';
  return `tradition.${s.tradition}`;
}

/** Grade badge always names the grader (13 §5.1): "Sahih (authentic), al-Albani". */
export function GradeBadge({
  source,
  testID,
}: {
  source: Pick<SourceView, 'grade' | 'gradedBy' | 'tradition' | 'kind'>;
  testID?: string;
}) {
  const { t } = useTranslation('knowledge');
  if (!source.grade || source.kind === 'quran') return null;
  const grade = t(`grades.${source.grade}`);
  return (
    <View
      className="self-start rounded-full border border-line-strong px-3 py-1"
      {...(testID ? { testID } : {})}
    >
      <Text variant="caption">
        {source.gradedBy ? t('gradeWithGrader', { grade, grader: source.gradedBy }) : grade}
      </Text>
    </View>
  );
}

export function TraditionLabel({ source }: { source: Pick<SourceView, 'kind' | 'tradition'> }) {
  const { t } = useTranslation('knowledge');
  return (
    <Text variant="caption" tone="muted">
      {t(traditionLabelKey(source))}
    </Text>
  );
}

/** GRADE dots and the matching strength words (13 §5.3); text always accompanies the dots. */
export function EvidenceStrength({
  grade,
  testID,
}: {
  grade: EvidenceGradeScience;
  testID?: string;
}) {
  const { t } = useTranslation('knowledge');
  const dots = gradeDots(grade);
  const label = t(`science.${grade}`);
  return (
    <View
      accessible
      accessibilityLabel={label}
      className="flex-row items-center gap-2"
      {...(testID ? { testID } : {})}
    >
      <View className="flex-row gap-1">
        {Array.from({ length: 4 }, (_, i) => (
          <View
            key={i}
            className={cn(
              'h-2 w-2 rounded-full border border-primary',
              i < dots ? 'bg-primary' : 'bg-transparent',
            )}
          />
        ))}
      </View>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

/** Compact chip for a source inside a card; opens the source detail sheet. */
export function SourceCitationChip({
  source,
  onPress,
  testID,
}: {
  source: SourceView;
  onPress: (id: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation('knowledge');
  const label = `${t(traditionLabelKey(source))} · ${source.citationText}`;
  return (
    <Pressable
      onPress={() => onPress(source.id)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('openSourceHint')}
      className="min-h-control-sm justify-center self-start rounded-full border border-primary px-3 py-1"
      {...(testID ? { testID } : {})}
    >
      <Text variant="caption" tone="primary">
        {label}
      </Text>
    </Pressable>
  );
}

/** Full source card (13 §5.4 `SourceCard`): Arabic, translation, reference, grade, tradition, reviewer. */
export function SourceCard({ source, testID }: { source: SourceView; testID?: string }) {
  const { t } = useTranslation('knowledge');
  return (
    <Card variant="outlined" {...(testID ? { testID } : {})}>
      <TraditionLabel source={source} />
      {source.arabicText ? (
        <Text script={source.kind === 'quran' ? 'quran' : 'arabic'} align="end" selectable>
          {source.arabicText}
        </Text>
      ) : null}
      {source.translation ? <Text>{source.translation}</Text> : null}
      {source.translator ? (
        <Text variant="caption" tone="muted">
          {t('translatedBy', { translator: source.translator })}
        </Text>
      ) : null}
      <Text variant="bodyStrong">{source.citationText}</Text>
      <GradeBadge source={source} {...(testID ? { testID: `${testID}.grade` } : {})} />
      {source.relationship === 'context' ? (
        <Text variant="caption" tone="muted">
          {t('contextOnly')}
        </Text>
      ) : null}
      {source.verifiedBy ? (
        <Text variant="caption" tone="muted" {...(testID ? { testID: `${testID}.verified` } : {})}>
          {t('verifiedBy', { name: source.verifiedBy.name, date: source.verifiedBy.on })}
        </Text>
      ) : null}
    </Card>
  );
}

/** `EvidenceStrength` block with summary and citation (13 §5.4). */
export function EvidenceCard({
  evidence,
  onOpenLink,
  testID,
}: {
  evidence: EvidenceView;
  onOpenLink?: (url: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation('knowledge');
  const url = evidence.doi
    ? `https://doi.org/${evidence.doi}`
    : evidence.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${evidence.pmid}/`
      : null;
  return (
    <Card variant="filled" {...(testID ? { testID } : {})}>
      <Text variant="bodyStrong">{evidence.title}</Text>
      <EvidenceStrength grade={evidence.grade} {...(testID ? { testID: `${testID}.grade` } : {})} />
      <Text variant="caption" tone="muted">
        {t(`studyTypes.${evidence.studyType}`, { defaultValue: evidence.studyType })}
        {evidence.population ? ` · ${evidence.population}` : ''}
      </Text>
      <Text>{evidence.summary}</Text>
      <Text variant="caption" tone="muted">
        {evidence.citation}
      </Text>
      {evidence.relationship === 'caution' ? (
        <Text variant="caption" tone="warning">
          {t('caution')}
        </Text>
      ) : null}
      {url && onOpenLink ? (
        <Button
          label={t('openStudy')}
          variant="link"
          size="sm"
          className="self-start px-0"
          onPress={() => onOpenLink(url)}
          {...(testID ? { testID: `${testID}.link` } : {})}
        />
      ) : null}
    </Card>
  );
}

/** Shown when no verified content exists yet (scholar review pending, 24 S2-13). */
export function KnowledgeEmptyState({ testID = 'knowledge.empty' }: { testID?: string }) {
  const { t } = useTranslation('knowledge');
  return (
    <Card variant="filled" testID={testID}>
      <Text variant="bodyStrong">{t('empty.title')}</Text>
      <Text tone="muted">{t('empty.body')}</Text>
    </Card>
  );
}
