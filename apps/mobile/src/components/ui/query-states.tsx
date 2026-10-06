import { ActivityIndicator, View } from 'react-native';

import { cn } from '@/theme/cn';
import { useThemeColors } from '@/theme/use-theme-colors';

import { Button } from './button';
import { InlineMessage } from './inline-message';
import { Text } from './text';
import type { BaseProps } from './types';

export interface LoadingRowProps extends BaseProps {
  /** Visible and announced, e.g. "Loading…". */
  label: string;
}

/**
 * Inline loading state for a section or list (24 S7-09): a spinner with a visible label, exposed as
 * one progress element so screen readers say what is loading instead of an unlabeled spinner.
 */
export function LoadingRow({ label, className, testID }: LoadingRowProps) {
  const colors = useThemeColors();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      className={cn('min-h-touch flex-row items-center gap-3', className)}
      {...(testID ? { testID } : {})}
    >
      <ActivityIndicator color={colors.primary} />
      <Text tone="muted">{label}</Text>
    </View>
  );
}

export interface ErrorRetryProps extends BaseProps {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  /** Disables the button while a retry is in flight. */
  retrying?: boolean;
}

/** Inline error with a retry action (24 S7-09): the alert is announced, the button follows it. */
export function ErrorRetry({
  message,
  retryLabel,
  onRetry,
  retrying = false,
  className,
  testID,
}: ErrorRetryProps) {
  return (
    <View className={cn('gap-2', className)} {...(testID ? { testID } : {})}>
      <InlineMessage tone="danger" message={message} />
      <Button
        label={retryLabel}
        variant="secondary"
        size="sm"
        className="self-start"
        loading={retrying}
        onPress={onRetry}
        {...(testID ? { testID: `${testID}.retry` } : {})}
      />
    </View>
  );
}
