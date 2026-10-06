import { forwardRef, useState, type ReactNode } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { useUiScript } from '@/hooks/use-ui-script';
import { cn } from '@/theme/cn';
import { useThemeColors } from '@/theme/use-theme-colors';

import { Text } from './text';
import type { BaseProps } from './types';

export interface InputProps
  extends BaseProps, Omit<TextInputProps, 'style' | 'onChange' | 'className' | 'testID'> {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  helperText?: string;
  errorText?: string;
  rightAccessory?: ReactNode;
  /** Suffix like "kg" or "ml", rendered on the logical end side. */
  unit?: string;
  variant?: 'text' | 'numeric' | 'multiline' | 'search';
  required?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    value,
    onChangeText,
    helperText,
    errorText,
    rightAccessory,
    unit,
    variant = 'text',
    required,
    className,
    testID,
    ...rest
  },
  ref,
) {
  const colors = useThemeColors();
  const script = useUiScript();
  const [focused, setFocused] = useState(false);
  const invalid = Boolean(errorText);
  const describedBy = errorText ?? helperText;

  return (
    <View className={cn('gap-1', className)}>
      <Text variant="label" tone="muted">
        {required ? `${label} *` : label}
      </Text>
      <View
        className={cn(
          'flex-row items-center gap-2 rounded-md border bg-surface-sunken px-3',
          script === 'urdu' ? 'min-h-control-lg' : 'min-h-control',
          invalid ? 'border-danger' : focused ? 'border-primary' : 'border-line-strong',
        )}
      >
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          accessibilityLabel={label}
          {...(describedBy ? { accessibilityHint: describedBy } : {})}
          accessibilityState={{ disabled: rest.editable === false }}
          aria-invalid={invalid}
          placeholderTextColor={colors['ink-subtle']}
          keyboardType={variant === 'numeric' ? 'decimal-pad' : rest.keyboardType}
          multiline={variant === 'multiline'}
          className={cn(
            'flex-1 py-2 text-ink',
            script === 'urdu' ? 'font-urdu text-ur-body' : 'font-ui text-body',
          )}
          {...(testID ? { testID } : {})}
          {...rest}
        />
        {unit ? (
          <Text variant="label" tone="muted">
            {unit}
          </Text>
        ) : null}
        {rightAccessory}
      </View>
      {errorText ? (
        <Text
          variant="caption"
          tone="danger"
          accessibilityRole="text"
          {...(testID ? { testID: `${testID}.error` } : {})}
        >
          {errorText}
        </Text>
      ) : helperText ? (
        <Text variant="caption" tone="muted">
          {helperText}
        </Text>
      ) : null}
    </View>
  );
});
