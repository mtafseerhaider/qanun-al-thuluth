import { Pressable, View } from 'react-native';

import { cn } from '@/theme/cn';

import { Text } from './text';
import type { BaseProps } from './types';

export interface RadioCardOption<T extends string> {
  value: T;
  title: string;
  description?: string;
  disabled?: boolean;
}

export interface RadioCardGroupProps<T extends string> extends BaseProps {
  label: string;
  hint?: string;
  options: readonly RadioCardOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Lay options out in a row (short labels) instead of stacked cards. */
  inline?: boolean;
}

/** Single choice with radio semantics; each card reads its title then its description (02 §7.2.4). */
export function RadioCardGroup<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  inline = false,
  className,
  testID,
}: RadioCardGroupProps<T>) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className={cn('gap-2', className)}
      {...(testID ? { testID } : {})}
    >
      <Text variant="label" tone="muted">
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
      <View className={inline ? 'flex-row flex-wrap gap-2' : 'gap-2'}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={o.disabled ? undefined : () => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected, disabled: Boolean(o.disabled) }}
              accessibilityLabel={o.title}
              {...(o.description ? { accessibilityHint: o.description } : {})}
              className={cn(
                'min-h-control justify-center gap-1 rounded-md border px-4 py-2',
                selected
                  ? 'border-2 border-primary bg-primary-soft'
                  : 'border-line-strong bg-surface-raised',
                o.disabled && 'opacity-disabled',
                inline && 'flex-grow',
              )}
              {...(testID ? { testID: `${testID}.${o.value}` } : {})}
            >
              <Text variant="bodyStrong" tone={selected ? 'primary' : 'neutral'}>
                {o.title}
              </Text>
              {o.description ? (
                <Text variant="caption" tone="muted">
                  {o.description}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
