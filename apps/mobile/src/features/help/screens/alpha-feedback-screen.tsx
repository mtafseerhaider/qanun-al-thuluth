import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics/track';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import {
  buildFeedback,
  FEEDBACK_CATEGORIES,
  FEEDBACK_MAX_LENGTH,
  submitAlphaFeedback,
  type FeedbackCategory,
} from '../api/alpha-feedback-api';

/**
 * Alpha feedback form (24 S3-17): a category and a message. Saved on the device through the outbox
 * (see alpha-feedback-api.ts); the copy says so honestly. No health data is asked for.
 */
export function AlphaFeedbackScreen() {
  const { t, i18n } = useTranslation('help');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const trimmed = message.trim();

  const submit = () => {
    if (!trimmed) return;
    submitAlphaFeedback(
      buildFeedback({
        category,
        message: trimmed,
        screen: null,
        householdId,
        locale: i18n.language,
      }),
    );
    track('alpha_feedback_sent', { category, has_screen: false });
    setMessage('');
    setSent(true);
  };

  return (
    <Screen testID="alpha-feedback.screen">
      <Text variant="title" accessibilityRole="header">
        {t('feedback.title')}
      </Text>
      <Text tone="muted">{t('feedback.body')}</Text>
      {sent ? (
        <InlineMessage
          tone="success"
          title={t('feedback.thanksTitle')}
          message={t('feedback.thanksBody')}
          testID="alpha-feedback.sent"
        />
      ) : null}
      <ChipGroup
        label={t('feedback.category')}
        single
        options={FEEDBACK_CATEGORIES.map((c) => ({
          value: c,
          label: t(`feedback.categories.${c}`),
        }))}
        selected={[category]}
        onToggle={(c) => {
          setCategory(c);
          setSent(false);
        }}
        testID="alpha-feedback.category"
      />
      <Input
        label={t('feedback.message')}
        helperText={t('feedback.messageHint')}
        value={message}
        onChangeText={(v) => {
          setMessage(v.slice(0, FEEDBACK_MAX_LENGTH));
          setSent(false);
        }}
        variant="multiline"
        testID="alpha-feedback.message"
      />
      <Button
        label={t('feedback.send')}
        size="lg"
        fullWidth
        disabled={!trimmed}
        onPress={submit}
        testID="alpha-feedback.send"
      />
      <Text variant="caption" tone="muted">
        {t('feedback.privacy')}
      </Text>
    </Screen>
  );
}
