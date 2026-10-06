import { Pressable, View } from 'react-native';

import { cn } from '@/theme/cn';

import { Text } from './text';
import type { BaseProps } from './types';

export interface CheckboxProps extends BaseProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  /** Appended to the label for screen readers, e.g. "required". */
  requiredLabel?: string;
}

/** A labelled checkbox row; the whole row is one 48pt+ target with checkbox semantics (03 §10). */
export function Checkbox({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  required = false,
  requiredLabel,
  className,
  testID,
}: CheckboxProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : () => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={required && requiredLabel ? `${label}, ${requiredLabel}` : label}
      {...(description ? { accessibilityHint: description } : {})}
      className={cn(
        'min-h-control flex-row items-start gap-3 py-2',
        disabled && 'opacity-disabled',
        className,
      )}
      {...(testID ? { testID } : {})}
    >
      <View
        className={cn(
          'mt-0.5 h-6 w-6 items-center justify-center rounded-sm border-2',
          checked ? 'border-primary bg-primary' : 'border-line-strong bg-surface-raised',
        )}
      >
        {checked ? <View className="h-3 w-3 rounded-sm bg-on-primary" /> : null}
      </View>
      <View className="flex-1 gap-1">
        <Text variant="bodyStrong">{required ? `${label} *` : label}</Text>
        {description ? (
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
