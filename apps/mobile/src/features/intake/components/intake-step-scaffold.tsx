import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { StepProgress } from '@/components/ui/step-progress';
import { Text } from '@/components/ui/text';
import { errorKeyFor } from '@/lib/supabase/error-mapping';

/**
 * `IntakeStep` shell (08 §5.20, 02 §7.3): Back, progress over the member's visible steps, the
 * member's name and completeness, a header-role title, the form, Next and "Finish later".
 */
export function IntakeStepScaffold({
  memberName,
  index,
  total,
  score,
  title,
  subtitle,
  children,
  onNext,
  onBack,
  onFinishLater,
  nextLabel,
  nextDisabled = false,
  saving = false,
  error,
  testID,
}: {
  memberName?: string;
  index: number;
  total: number;
  score?: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onNext: () => void;
  onBack?: () => void;
  onFinishLater?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  saving?: boolean;
  error?: unknown;
  testID: string;
}) {
  const { t } = useTranslation(['intake', 'errors']);
  return (
    <Screen edges={['top', 'bottom']} testID={testID}>
      <View className="gap-3">
        {onBack ? (
          <Button
            label={t('intake:common.back')}
            variant="link"
            size="sm"
            className="self-start px-0"
            onPress={onBack}
            testID={`${testID}.back`}
          />
        ) : null}
        <StepProgress
          current={index}
          total={total}
          label={
            memberName
              ? t('intake:common.memberProgress', { name: memberName, current: index, total })
              : t('intake:common.progress', { current: index, total })
          }
        />
        {score !== undefined ? (
          <Text variant="caption" tone="muted" testID={`${testID}.completeness`}>
            {t('intake:common.completeness', { score })}
          </Text>
        ) : null}
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text tone="muted">{subtitle}</Text> : null}
      </View>
      {children}
      {error ? (
        <InlineMessage
          tone="danger"
          message={t(`errors:${errorKeyFor(error)}`)}
          testID={`${testID}.error`}
        />
      ) : null}
      <View className="gap-2">
        <Button
          label={nextLabel ?? t('intake:common.next')}
          onPress={onNext}
          disabled={nextDisabled}
          loading={saving}
          size="lg"
          fullWidth
          testID={`${testID}.next`}
        />
        {onFinishLater ? (
          <Button
            label={t('intake:common.finishLater')}
            variant="ghost"
            onPress={onFinishLater}
            fullWidth
            testID={`${testID}.finish-later`}
          />
        ) : null}
      </View>
    </Screen>
  );
}
