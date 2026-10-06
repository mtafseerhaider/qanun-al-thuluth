import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { StepProgress } from '@/components/ui/step-progress';
import { Text } from '@/components/ui/text';

/**
 * `OnboardingScaffold` (02 §7.2): progress, header-role title, scrollable content, one primary
 * action and Back. Each step saves on Continue and stays put with an inline error on failure.
 */
export function OnboardingScaffold({
  step,
  total,
  title,
  subtitle,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  primaryLoading = false,
  onBack,
  error,
  testID,
}: {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  onBack?: () => void;
  error?: string | null;
  testID: string;
}) {
  const { t } = useTranslation('onboarding');
  return (
    <Screen edges={['top', 'bottom']} testID={testID}>
      <View className="gap-3">
        {onBack ? (
          <Button
            label={t('common.back')}
            variant="link"
            size="sm"
            className="self-start px-0"
            onPress={onBack}
            testID={`${testID}.back`}
          />
        ) : null}
        <StepProgress
          current={step}
          total={total}
          label={t('common.progress', { current: step, total })}
        />
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text tone="muted">{subtitle}</Text> : null}
      </View>
      {children}
      {error ? <InlineMessage tone="danger" message={error} testID={`${testID}.error`} /> : null}
      <Button
        label={primaryLabel}
        onPress={onPrimary}
        disabled={primaryDisabled}
        loading={primaryLoading}
        size="lg"
        fullWidth
        testID={`${testID}.continue`}
      />
    </Screen>
  );
}
