import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { cn } from '@/theme/cn';

import { Text } from './text';
import type { BaseProps } from './types';

export interface DisclosureProps extends BaseProps {
  title: string;
  children: ReactNode;
  /** Collapsed by default (02 Q-08: children's guidance for parents is collapsed). */
  defaultOpen?: boolean;
  /** Already-translated "Show" / "Hide" hints for screen readers. */
  showHint?: string;
  hideHint?: string;
}

/** Expandable section; the header is one button with expanded state for assistive tech. */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  showHint,
  hideHint,
  className,
  testID,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hint = open ? hideHint : showHint;
  return (
    <View className={cn('gap-2', className)} {...(testID ? { testID } : {})}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        {...(hint ? { accessibilityHint: hint } : {})}
        className="min-h-control flex-row items-center justify-between gap-3"
        {...(testID ? { testID: `${testID}.toggle` } : {})}
      >
        <Text variant="bodyStrong" className="flex-1">
          {title}
        </Text>
        <Text variant="label" tone="primary">
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? <View {...(testID ? { testID: `${testID}.content` } : {})}>{children}</View> : null}
    </View>
  );
}
