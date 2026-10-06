import type { ReactNode } from 'react';
import type { AccessibilityRole } from 'react-native';

export type Size = 'sm' | 'md' | 'lg';
export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
export interface BaseProps {
  className?: string | undefined;
  testID?: string | undefined;
}
export type Slot = ReactNode;
export interface A11yOverride {
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
}
