import { forwardRef } from 'react';
import { ActivityIndicator, Pressable, View, type View as RNView } from 'react-native';

import { cn } from '@/theme/cn';
import { useThemeColors } from '@/theme/use-theme-colors';

import { Text } from './text';
import type { A11yOverride, BaseProps, Size } from './types';

export interface ButtonProps extends BaseProps, A11yOverride {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link';
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
}

const CONTAINER: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-primary active:bg-primary-pressed',
  secondary: 'bg-surface-raised border border-line-strong active:bg-surface-sunken',
  ghost: 'bg-transparent active:bg-surface-sunken',
  destructive: 'bg-danger active:opacity-disabled',
  link: 'bg-transparent',
};

const LABEL_TONE = {
  primary: 'inverse',
  secondary: 'primary',
  ghost: 'primary',
  destructive: 'inverse',
  link: 'primary',
} as const;

const SIZE: Record<Size, string> = {
  sm: 'min-h-control-sm px-3',
  md: 'min-h-control px-4',
  lg: 'min-h-control-lg px-5',
};

export const Button = forwardRef<RNView, ButtonProps>(function Button(
  {
    label,
    onPress,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    fullWidth = false,
    accessibilityLabel,
    accessibilityHint,
    accessibilityRole,
    className,
    testID,
  },
  ref,
) {
  const colors = useThemeColors();
  const inactive = disabled || loading;
  const spinnerColor =
    variant === 'primary'
      ? colors['on-primary']
      : variant === 'destructive'
        ? colors['on-danger']
        : colors.primary;

  return (
    <Pressable
      ref={ref}
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole={accessibilityRole ?? (variant === 'link' ? 'link' : 'button')}
      accessibilityLabel={accessibilityLabel ?? label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={size === 'sm' ? 6 : undefined}
      className={cn(
        'flex-row items-center justify-center gap-2 rounded-md py-2',
        SIZE[size],
        CONTAINER[variant],
        fullWidth && 'self-stretch',
        disabled && 'opacity-disabled',
        className,
      )}
      {...(testID ? { testID } : {})}
    >
      {loading ? (
        <ActivityIndicator
          color={spinnerColor}
          {...(testID ? { testID: `${testID}.spinner` } : {})}
        />
      ) : null}
      <View className={cn(loading && 'opacity-scrim')}>
        <Text
          variant="label"
          tone={LABEL_TONE[variant]}
          align="center"
          className={variant === 'link' ? 'underline' : undefined}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
});
