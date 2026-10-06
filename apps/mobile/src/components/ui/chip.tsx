import { Pressable, View } from 'react-native';

import { cn } from '@/theme/cn';

import { Text } from './text';
import type { BaseProps } from './types';

export interface ChipProps extends BaseProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** 'avoid' marks a negative pick (textures avoided): outline and strike, never red (02 §7.3.11). */
  tone?: 'default' | 'avoid';
  /** Radio semantics inside a single-choice group; checkbox otherwise. */
  role?: 'checkbox' | 'radio';
  disabled?: boolean;
  accessibilityHint?: string;
}

/** Toggle chip (08 §4.6): 48pt target, selection exposed to assistive tech. */
export function Chip({
  label,
  selected,
  onPress,
  tone = 'default',
  role = 'checkbox',
  disabled = false,
  accessibilityHint,
  className,
  testID,
}: ChipProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, selected, disabled }}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      hitSlop={4}
      className={cn(
        'min-h-control-sm flex-row items-center justify-center rounded-full border px-4 py-1',
        selected && tone === 'default' && 'border-primary bg-primary-soft',
        selected && tone === 'avoid' && 'border-2 border-ink-muted bg-surface-sunken',
        !selected && 'border-line-strong bg-surface-raised',
        disabled && 'opacity-disabled',
        className,
      )}
      {...(testID ? { testID } : {})}
    >
      <Text
        variant="label"
        tone={selected && tone === 'default' ? 'primary' : 'neutral'}
        className={selected && tone === 'avoid' ? 'line-through' : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface ChipGroupProps<T extends string> extends BaseProps {
  label: string;
  hint?: string;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  selected: readonly T[];
  onToggle: (value: T) => void;
  tone?: 'default' | 'avoid';
  /** Single choice: radio semantics. */
  single?: boolean;
}

/** A labelled, wrapping set of chips. testIDs are `${testID}.${value}`. */
export function ChipGroup<T extends string>({
  label,
  hint,
  options,
  selected,
  onToggle,
  tone = 'default',
  single = false,
  className,
  testID,
}: ChipGroupProps<T>) {
  return (
    <View
      accessibilityRole={single ? 'radiogroup' : undefined}
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
      <View className="flex-row flex-wrap gap-2">
        {options.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={selected.includes(o.value)}
            onPress={() => onToggle(o.value)}
            tone={tone}
            role={single ? 'radio' : 'checkbox'}
            {...(o.disabled ? { disabled: true } : {})}
            {...(testID ? { testID: `${testID}.${o.value}` } : {})}
          />
        ))}
      </View>
    </View>
  );
}
