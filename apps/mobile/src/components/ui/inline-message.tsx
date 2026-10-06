import { View } from 'react-native';

import { cn } from '@/theme/cn';

import { Text } from './text';
import type { BaseProps } from './types';

export interface InlineMessageProps extends BaseProps {
  message: string;
  title?: string;
  tone?: 'danger' | 'info' | 'success' | 'warning';
}

const CONTAINER = {
  danger: 'bg-danger-soft border-danger',
  info: 'bg-info-soft border-info',
  success: 'bg-success-soft border-success',
  warning: 'bg-warning-soft border-warning',
} as const;

/** Inline status or error, announced politely to screen readers (02 §7.1.3 accessibility). */
export function InlineMessage({
  message,
  title,
  tone = 'info',
  className,
  testID,
}: InlineMessageProps) {
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
      accessible
      className={cn('gap-1 rounded-md border-hairline p-3', CONTAINER[tone], className)}
      {...(testID ? { testID } : {})}
    >
      {title ? <Text variant="bodyStrong">{title}</Text> : null}
      <Text variant="caption">{message}</Text>
    </View>
  );
}
