import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { cn } from '@/theme/cn';

import { Text } from './text';
import type { BaseProps } from './types';

export interface ScreenProps extends BaseProps {
  children: ReactNode;
  title?: string;
  scroll?: boolean;
  /** Safe-area edges to pad. Defaults to none at the top because native headers already handle it. */
  edges?: readonly Edge[];
  headerRight?: ReactNode;
  contentClassName?: string;
}

/** Screen shell: safe area, surface background, keyboard avoidance and a header-role title (08 §4.13). */
export function Screen({
  children,
  title,
  scroll = true,
  edges = ['bottom'],
  headerRight,
  className,
  contentClassName,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: edges.includes('top') ? insets.top : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
    paddingStart: edges.includes('left') ? insets.left : 0,
    paddingEnd: edges.includes('right') ? insets.right : 0,
  };

  const header = title ? (
    <View className="flex-row items-center justify-between gap-3">
      <Text variant="title" accessibilityRole="header" className="flex-1">
        {title}
      </Text>
      {headerRight}
    </View>
  ) : null;

  const body = (
    <>
      {header}
      {children}
    </>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className={cn('flex-1 bg-surface', className)}
      style={padding}
      {...(testID ? { testID } : {})}
    >
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={cn('gap-6 px-4 py-6', contentClassName)}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View className={cn('flex-1 gap-6 px-4 py-6', contentClassName)}>{body}</View>
      )}
    </KeyboardAvoidingView>
  );
}
