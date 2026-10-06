import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { cn } from '@/theme/cn';

import { fetchVerifiedCitationRefs } from '../api/chat-api';
import type { ChatCitation, ChatSafety } from '../utils/chat-stream';
import { citationIds, visibleCitations } from '../utils/citation-rules';
import type { QuotaDisplay } from '../utils/quota-rules';
import { emergencyNumbersFor, isUrgent, telUrl } from '../utils/safety-rules';

/** Verified chips for a turn's citations; unverified ones render nothing (FR-CHAT-09). */
export function useVerifiedCitations(citations: readonly ChatCitation[]) {
  const ids = citationIds(citations);
  const key = [...ids.islamicSources, '|', ...ids.recommendations, '|', ...ids.evidence].join(',');
  const query = useQuery({
    queryKey: ['knowledge', 'verified-citations', key],
    queryFn: () => fetchVerifiedCitationRefs(ids),
    enabled: citations.length > 0 && isSupabaseConfigured,
    staleTime: 5 * 60_000,
  });
  const v = query.data;
  return visibleCitations(citations, {
    islamicSources: new Set(v?.islamicSources ?? []),
    recommendations: new Set(v?.recommendations ?? []),
    evidence: new Set(v?.evidence ?? []),
  });
}

export function CitationChips({
  citations,
  onOpen,
  testID,
}: {
  citations: readonly ChatCitation[];
  onOpen: (c: ChatCitation) => void;
  testID?: string;
}) {
  const { t } = useTranslation(['chat', 'knowledge']);
  if (citations.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-2" {...(testID ? { testID } : {})}>
      {citations.map((c) => {
        const parts = [
          `[${c.marker}] ${c.label}`,
          c.hadith_grade ? t(`knowledge:grades.${c.hadith_grade}`) : null,
          c.science_grade ? t(`knowledge:science.${c.science_grade}`) : null,
          c.tradition ? t(`knowledge:tradition.${c.tradition}`) : null,
        ].filter(Boolean);
        const label = parts.join(' · ');
        return (
          <Pressable
            key={`${c.kind}:${c.ref_id}`}
            onPress={() => {
              track('chat_citation_opened', { kind: c.kind });
              onOpen(c);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('chat:citationA11y', { label })}
            hitSlop={4}
            className="min-h-control-sm justify-center rounded-full border border-primary px-3 py-1"
            {...(testID ? { testID: `${testID}.${c.marker}` } : {})}
          >
            <Text variant="caption" tone="primary">
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Safety rendering (FR-CHAT-10, 02 §7.7.2): an escalation shows first, in danger tone, with the
 * clinician recommendation and the country's emergency numbers as call buttons. A notice is a
 * calm info line. Never behind a paywall (P1).
 */
export function SafetyBanner({
  safety,
  countryCode,
  testID = 'chat.safety',
}: {
  safety: ChatSafety;
  countryCode: string | null;
  testID?: string;
}) {
  const { t } = useTranslation('chat');
  if (safety.action === 'notice')
    return (
      <InlineMessage
        tone="info"
        message={t(`safety.notice.${(safety.notice_key ?? '').replace(/^safety\.notice\./, '')}`, {
          defaultValue: t('safety.notice.default'),
        })}
        testID={`${testID}.notice`}
      />
    );
  const esc = safety.escalation;
  const numbers = emergencyNumbersFor(countryCode);
  return (
    <Card variant="outlined" className="border-danger bg-danger-soft" testID={`${testID}.escalate`}>
      <Text variant="bodyStrong" tone="danger" accessibilityRole="header">
        {t('safety.title')}
      </Text>
      {esc ? <Text>{esc.message}</Text> : null}
      <Text>{t(`safety.recommend.${esc?.recommend ?? 'see_gp'}`)}</Text>
      {isUrgent(esc?.recommend) || numbers.length > 0 ? (
        <Text variant="bodyStrong">{t('safety.emergencyLead')}</Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2" testID={`${testID}.numbers`}>
        {numbers.map((n) => (
          <Button
            key={n.number}
            label={t('safety.call', {
              service: t(`safety.service.${n.service}`),
              number: n.number,
            })}
            variant="destructive"
            size="sm"
            onPress={() => void Linking.openURL(telUrl(n.number))}
            testID={`${testID}.call.${n.number}`}
          />
        ))}
      </View>
      {numbers.length === 0 ? <Text>{t('safety.localServices')}</Text> : null}
    </Card>
  );
}

export function FollowUpChips({
  suggestions,
  onPick,
  disabled,
}: {
  suggestions: readonly string[];
  onPick: (s: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('chat');
  if (suggestions.length === 0) return null;
  return (
    <View className="gap-2" testID="chat.follow-ups">
      <Text variant="caption" tone="muted">
        {t('followUps')}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {suggestions.map((s, i) => (
          <Pressable
            key={s}
            disabled={disabled}
            onPress={() => {
              track('chat_follow_up_tapped', {});
              onPick(s);
            }}
            accessibilityRole="button"
            accessibilityLabel={s}
            hitSlop={4}
            className={cn(
              'min-h-control-sm justify-center rounded-full border border-line-strong bg-surface-raised px-3 py-1',
              disabled && 'opacity-disabled',
            )}
            testID={`chat.follow-up.${i}`}
          >
            <Text variant="caption">{s}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const REASONS = ['inaccurate', 'unsafe', 'not_helpful', 'too_long', 'other'] as const;

/** Thumbs up/down with an optional reason (FR-CHAT-12); writes `analytics_events` only. */
export function FeedbackButtons({ testID }: { testID?: string }) {
  const { t } = useTranslation('chat');
  const [value, setValue] = useState<'up' | 'down' | null>(null);
  const [reasonSent, setReasonSent] = useState(false);
  return (
    <View className="gap-2" {...(testID ? { testID } : {})}>
      <View className="flex-row gap-2">
        {(['up', 'down'] as const).map((v) => (
          <Button
            key={v}
            label={t(`feedback.${v}`)}
            variant={value === v ? 'secondary' : 'ghost'}
            size="sm"
            selected={value === v}
            disabled={value !== null}
            onPress={() => {
              setValue(v);
              if (v === 'up') track('chat_feedback', { value: 'up' });
            }}
            {...(testID ? { testID: `${testID}.${v}` } : {})}
          />
        ))}
      </View>
      {value === 'down' && !reasonSent ? (
        <View className="flex-row flex-wrap gap-2">
          {REASONS.map((r) => (
            <Button
              key={r}
              label={t(`feedback.reasons.${r}`)}
              variant="secondary"
              size="sm"
              onPress={() => {
                track('chat_feedback', { value: 'down', reason: r });
                setReasonSent(true);
              }}
              {...(testID ? { testID: `${testID}.reason.${r}` } : {})}
            />
          ))}
        </View>
      ) : null}
      {value !== null && (value === 'up' || reasonSent) ? (
        <Text variant="caption" tone="muted">
          {t('feedback.thanks')}
        </Text>
      ) : null}
    </View>
  );
}

/** "5 messages left today" from 5 down on the free tier (02 §5.6). */
export function QuotaIndicator({ display }: { display: QuotaDisplay }) {
  const { t } = useTranslation('chat');
  if (display.kind !== 'counter') return null;
  return (
    <Text variant="caption" tone="muted" testID="chat.quota-counter">
      {t('quota.left', { count: display.remaining })}
    </Text>
  );
}

/** Replaces the composer when today's messages are used up (02 §7.7.2 `QuotaReachedCard`). */
export function QuotaReachedCard({
  premium,
  onSeePremium,
}: {
  premium: boolean;
  onSeePremium: () => void;
}) {
  const { t } = useTranslation('chat');
  return (
    <Card variant="filled" testID="chat.quota-reached">
      <Text variant="bodyStrong">{premium ? t('quota.premiumTitle') : t('quota.freeTitle')}</Text>
      <Text tone="muted">{premium ? t('quota.premiumBody') : t('quota.freeBody')}</Text>
      {!premium ? (
        <Button
          label={t('quota.seePremium')}
          size="sm"
          className="self-start"
          onPress={onSeePremium}
          testID="chat.quota-reached.see-premium"
        />
      ) : null}
    </Card>
  );
}
