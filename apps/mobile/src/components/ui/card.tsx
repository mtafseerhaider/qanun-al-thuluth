import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { cn } from '@/theme/cn';

import type { BaseProps } from './types';

interface CardBaseProps extends BaseProps {
  children: ReactNode;
  variant?: 'elevated' | 'outlined' | 'filled';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  header?: ReactNode;
  footer?: ReactNode;
}

/** A pressable card is one button target and must carry an accessibility label (08 §4.4). */
export type CardProps = CardBaseProps &
  (
    | { onPress?: undefined; accessibilityLabel?: string }
    | { onPress: () => void; accessibilityLabel: string }
  );

const VARIANT: Record<NonNullable<CardBaseProps['variant']>, string> = {
  elevated: 'bg-surface-raised border border-line shadow-sm',
  outlined: 'bg-surface border border-line-strong',
  filled: 'bg-surface-sunken',
};

const PADDING: Record<NonNullable<CardBaseProps['padding']>, string> = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

export function Card({
  children,
  variant = 'elevated',
  padding = 'md',
  header,
  footer,
  onPress,
  accessibilityLabel,
  className,
  testID,
}: CardProps) {
  const classes = cn('rounded-lg gap-3', VARIANT[variant], PADDING[padding], className);
  const content = (
    <>
      {header}
      {children}
      {footer}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        className={cn(classes, 'active:opacity-disabled')}
        {...(testID ? { testID } : {})}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View
      className={classes}
      {...(accessibilityLabel ? { accessible: true, accessibilityLabel } : {})}
      {...(testID ? { testID } : {})}
    >
      {content}
    </View>
  );
}
