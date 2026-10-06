import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

import type { ChatProposal } from '../utils/chat-stream';
import { canConfirm, type ProposalAction } from '../utils/proposal-rules';

/**
 * Tool confirmation card (FR-CHAT-06): describes exactly what will be written and does nothing
 * until the user taps Confirm. "Not now" dismisses it. Viewers see the card without buttons.
 */
export function ToolProposalCard({
  proposal,
  action,
  memberName,
  canEdit,
  online,
  onConfirm,
  onDismiss,
  onReview,
  testID,
}: {
  proposal: ChatProposal;
  action: ProposalAction;
  memberName: string;
  canEdit: boolean;
  online: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  /** Ladder proposals: open the editor to change steps before saving. */
  onReview?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation(['chat', 'mealLog', 'fasting']);
  const summary = (() => {
    switch (action.kind) {
      case 'hydration':
        return t('chat:proposal.hydration', { name: memberName, ml: action.volumeMl });
      case 'meal_log':
        return t('chat:proposal.mealLog', {
          name: memberName,
          meal: t(`mealLog:mealTypes.${action.mealType}`),
          description: action.description,
        });
      case 'fast':
        return action.practice
          ? t('chat:proposal.practiceFast', { name: memberName, date: action.fastDate })
          : t('chat:proposal.fast', { name: memberName, date: action.fastDate });
      case 'ladder':
        return t(
          action.strategy === 'food_chaining' ? 'chat:proposal.chain' : 'chat:proposal.ladder',
          { name: memberName, food: action.targetFood, count: action.steps.length },
        );
      case 'plan_adjust':
        return t('chat:proposal.planAdjust', {
          summary: action.scopeSummary || action.changeRequest,
        });
      case 'unsupported':
        return action.reason === 'not_available'
          ? t('chat:proposal.notAvailable')
          : t('chat:proposal.invalid');
    }
  })();
  const title =
    action.kind === 'plan_adjust'
      ? t('chat:proposal.planTitle')
      : action.kind === 'ladder'
        ? t('chat:proposal.ladderTitle')
        : t('chat:proposal.logTitle');
  const canReview =
    action.kind === 'ladder' && proposal.status === 'pending' && canEdit && Boolean(onReview);
  const needsNetwork = action.kind === 'plan_adjust';
  const showButtons = canConfirm(proposal, action, canEdit);

  return (
    <Card variant="outlined" testID={testID}>
      <Text variant="overline" tone="muted">
        {title}
      </Text>
      <Text>{summary}</Text>
      {proposal.status === 'pending' ? (
        <Text variant="caption" tone="muted">
          {t('chat:proposal.nothingYet')}
        </Text>
      ) : null}
      {action.kind === 'ladder' && proposal.status === 'pending' ? (
        <View className="gap-0.5">
          {action.steps.slice(0, 4).map((s) => (
            <Text key={s.stepNo} variant="caption" tone="muted">
              {t('chat:proposal.ladderStep', {
                n: s.stepNo,
                food: s.foodLabel,
                criteria: s.criteria,
              })}
            </Text>
          ))}
          {action.targetIngredientId === null ? (
            <Text variant="caption" tone="muted">
              {t('chat:proposal.ladderPickFood')}
            </Text>
          ) : null}
        </View>
      ) : null}
      {canReview ? (
        <Button
          label={t('chat:proposal.review')}
          size="sm"
          variant="secondary"
          className="self-start"
          onPress={() => onReview?.()}
          {...(testID ? { testID: `${testID}.review` } : {})}
        />
      ) : null}
      {showButtons ? (
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={t('chat:proposal.confirm')}
            size="sm"
            disabled={needsNetwork && !online}
            onPress={onConfirm}
            {...(testID ? { testID: `${testID}.confirm` } : {})}
          />
          <Button
            label={t('chat:proposal.dismiss')}
            size="sm"
            variant="ghost"
            onPress={onDismiss}
            {...(testID ? { testID: `${testID}.dismiss` } : {})}
          />
        </View>
      ) : null}
      {proposal.status === 'applying' ? (
        <Text variant="caption" tone="muted">
          {t('chat:proposal.applying')}
        </Text>
      ) : null}
      {proposal.status === 'applied' ? (
        <Text variant="caption" tone="success" {...(testID ? { testID: `${testID}.applied` } : {})}>
          {action.kind === 'plan_adjust'
            ? t('chat:proposal.planApplied')
            : action.kind === 'ladder'
              ? t('chat:proposal.ladderSaved')
              : t('chat:proposal.logged')}
        </Text>
      ) : null}
      {proposal.status === 'dismissed' ? (
        <Text variant="caption" tone="muted">
          {t('chat:proposal.dismissed')}
        </Text>
      ) : null}
      {proposal.status === 'failed' ? (
        <Text variant="caption" tone="danger">
          {t('chat:proposal.failed', { code: proposal.errorCode ?? 'UNKNOWN' })}
        </Text>
      ) : null}
    </Card>
  );
}
