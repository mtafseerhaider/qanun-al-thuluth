import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';

import {
  activeToolDisplay,
  type ChatCitation,
  type ChatProposal,
  type ChatTurn,
} from '../utils/chat-stream';
import { stripUnverifiedMarkers } from '../utils/citation-rules';
import type { ProposalAction } from '../utils/proposal-rules';

import {
  CitationChips,
  FeedbackButtons,
  FollowUpChips,
  SafetyBanner,
  useVerifiedCitations,
} from './chat-parts';
import { ToolProposalCard } from './tool-proposal-card';

/** User bubble: end-aligned (02 §7.7.2 region 2). */
export function UserBubble({ text, testID }: { text: string; testID?: string }) {
  return (
    <View
      className="max-w-[85%] self-end rounded-lg bg-primary-soft px-4 py-3"
      {...(testID ? { testID } : {})}
    >
      <Text selectable>{text}</Text>
    </View>
  );
}

/** Assistant history message (no live parts): markers without chips are removed. */
export function AssistantText({ text, testID }: { text: string; testID?: string }) {
  return (
    <View className="gap-2" {...(testID ? { testID } : {})}>
      <Text selectable>{stripUnverifiedMarkers(text, new Set())}</Text>
    </View>
  );
}

/**
 * A live assistant answer, in the order 02 §7.7.2 asks: safety first, then the streamed text with a
 * soft caret, the tool status line, confirmation cards, verified citation chips, the disclaimer,
 * follow-up chips and feedback. Errors keep partial text with Retry; Stop keeps it marked Stopped.
 */
export function AssistantTurn({
  turn,
  countryCode,
  canEdit,
  online,
  actionFor,
  memberName,
  onConfirm,
  onDismiss,
  onReview,
  onRetry,
  onOpenCitation,
  onFollowUp,
  onPaywall,
  busy,
  testID,
}: {
  turn: ChatTurn;
  countryCode: string | null;
  canEdit: boolean;
  online: boolean;
  actionFor: (p: ChatProposal) => ProposalAction;
  memberName: (id: string) => string;
  onConfirm: (p: ChatProposal) => void;
  onDismiss: (p: ChatProposal) => void;
  onReview?: (p: ChatProposal) => void;
  onRetry: () => void;
  onOpenCitation: (c: ChatCitation) => void;
  onFollowUp: (text: string) => void;
  onPaywall: () => void;
  busy: boolean;
  testID: string;
}) {
  const { t } = useTranslation(['chat', 'errors']);
  const chips = useVerifiedCitations(turn.citations);
  const shown = new Set(chips.map((c) => c.marker));
  const text = stripUnverifiedMarkers(turn.text, shown);
  const tool = activeToolDisplay(turn);
  const streaming = turn.status === 'sending' || turn.status === 'streaming';
  const done = turn.status === 'done';

  return (
    <View className="gap-3" testID={testID}>
      {turn.safety?.action === 'escalate' ? (
        <SafetyBanner safety={turn.safety} countryCode={countryCode} testID={`${testID}.safety`} />
      ) : null}

      {text ? (
        <Text selectable testID={`${testID}.text`}>
          {text}
          {streaming ? t('chat:caret') : ''}
        </Text>
      ) : streaming && !tool ? (
        <Text tone="muted" testID={`${testID}.thinking`}>
          {t('chat:thinking')}
        </Text>
      ) : null}

      {tool ? (
        <Text variant="caption" tone="muted" testID={`${testID}.tool`}>
          {tool}
        </Text>
      ) : null}

      {turn.proposals.map((p, i) => (
        <ToolProposalCard
          key={p.id}
          proposal={p}
          action={actionFor(p)}
          memberName={(() => {
            const a = actionFor(p);
            return 'memberId' in a ? memberName(a.memberId) : '';
          })()}
          canEdit={canEdit}
          online={online}
          onConfirm={() => onConfirm(p)}
          onDismiss={() => onDismiss(p)}
          {...(onReview ? { onReview: () => onReview(p) } : {})}
          testID={`${testID}.proposal-${i}`}
        />
      ))}

      <CitationChips citations={chips} onOpen={onOpenCitation} testID={`${testID}.citations`} />

      {turn.safety?.action === 'notice' ? (
        <SafetyBanner safety={turn.safety} countryCode={countryCode} testID={`${testID}.safety`} />
      ) : null}

      {turn.status === 'stopped' ? (
        <Text variant="caption" tone="muted" testID={`${testID}.stopped`}>
          {t('chat:stopped')}
        </Text>
      ) : null}

      {turn.status === 'error' && turn.error ? (
        turn.error.code === 'PREMIUM_REQUIRED' ? (
          <View className="gap-2">
            <InlineMessage tone="info" message={t('chat:premiumNeeded')} />
            <Button label={t('chat:quota.seePremium')} size="sm" onPress={onPaywall} />
          </View>
        ) : turn.error.code === 'QUOTA_EXCEEDED' ? null : (
          <View className="gap-2" testID={`${testID}.error`}>
            <InlineMessage
              tone="danger"
              message={t('chat:errorRetry', { code: turn.error.code })}
            />
            {turn.error.retryable ? (
              <Button
                label={t('chat:retry')}
                size="sm"
                variant="secondary"
                className="self-start"
                disabled={!online || busy}
                onPress={onRetry}
                testID={`${testID}.retry`}
              />
            ) : null}
          </View>
        )
      ) : null}

      {done && text ? (
        <Text variant="caption" tone="muted">
          {t('chat:disclaimer')}
        </Text>
      ) : null}

      {done ? (
        <FollowUpChips
          suggestions={turn.followUps}
          onPick={onFollowUp}
          disabled={busy || !online}
        />
      ) : null}
      {done && turn.assistantMessageId ? <FeedbackButtons testID={`${testID}.feedback`} /> : null}
    </View>
  );
}
