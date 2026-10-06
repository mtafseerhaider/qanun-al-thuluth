import type { ReactNode } from 'react';
import { Text as RNText, type TextStyle } from 'react-native';

import { useUiScript } from '@/hooks/use-ui-script';
import { cn } from '@/theme/cn';
import type { UiScript } from '@/theme/fonts';
import { typeScale, type TextVariant } from '@/theme/tokens';

import type { BaseProps, Tone } from './types';

export interface TextProps extends BaseProps {
  children: ReactNode;
  variant?: TextVariant;
  tone?: Tone | 'muted' | 'subtle' | 'inverse';
  /** 'arabic' forces Amiri + RTL for scripture; 'quran' uses Amiri Quran (08 §4.2). */
  script?: 'ui' | 'arabic' | 'quran';
  /** Logical alignment, never left/right. */
  align?: 'start' | 'center' | 'end';
  numberOfLines?: number;
  selectable?: boolean;
  maxFontSizeMultiplier?: number;
  accessibilityRole?: 'header' | 'text' | 'link';
  accessibilityLabel?: string;
}

// Literal class strings so Tailwind's content scan generates them.
const VARIANT_CLASS: Record<UiScript, Record<TextVariant, string>> = {
  latin: {
    display: 'font-ui-display text-display',
    title: 'font-ui-display text-title',
    heading: 'font-ui-semibold text-heading',
    body: 'font-ui text-body',
    bodyStrong: 'font-ui-semibold text-bodyStrong',
    label: 'font-ui-medium text-label',
    caption: 'font-ui text-caption',
    overline: 'font-ui-semibold text-overline uppercase',
  },
  urdu: {
    display: 'font-urdu-bold text-ur-display',
    title: 'font-urdu-bold text-ur-title',
    heading: 'font-urdu-bold text-ur-heading',
    body: 'font-urdu text-ur-body',
    bodyStrong: 'font-urdu-bold text-ur-bodyStrong',
    label: 'font-urdu text-ur-label',
    caption: 'font-urdu text-ur-caption',
    overline: 'font-urdu-bold text-ur-overline',
  },
};

const TONE_CLASS: Record<NonNullable<TextProps['tone']>, string> = {
  neutral: 'text-ink',
  muted: 'text-ink-muted',
  subtle: 'text-ink-subtle',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  inverse: 'text-on-primary',
};

/**
 * WCAG 1.4.4 / 01 §9.3 (24 S7-04): text under 18 pt must reach 200 percent of its size, so its
 * cap is at least 2. Larger text (headings, titles, display) keeps the 03 §5 cap: it is already
 * large and uncapped growth would push content off small screens.
 */
export const MIN_BODY_FONT_SCALE = 2;
export function fontScaleCap(spec: { size: number; maxMultiplier: number }): number {
  return spec.size < 18 ? Math.max(spec.maxMultiplier, MIN_BODY_FONT_SCALE) : spec.maxMultiplier;
}

export function Text({
  children,
  variant = 'body',
  tone = 'neutral',
  script = 'ui',
  align,
  numberOfLines,
  selectable,
  maxFontSizeMultiplier,
  accessibilityRole,
  accessibilityLabel,
  className,
  testID,
}: TextProps) {
  const uiScript = useUiScript();
  const spec = typeScale[uiScript][variant];
  const scriptClass =
    script === 'arabic'
      ? 'font-arabic text-body'
      : script === 'quran'
        ? 'font-quran text-body'
        : VARIANT_CLASS[uiScript][variant];
  // Nastaliq keeps Android font padding (tall glyphs); Latin removes it (03 §5.3 rule 3).
  const style: TextStyle = {
    includeFontPadding: uiScript === 'urdu' || script !== 'ui',
    ...(script !== 'ui' ? { writingDirection: 'rtl', lineHeight: 40, fontSize: 20 } : {}),
    // React Native swaps 'right' to the left edge in RTL, so 'end' maps to 'right' in both directions.
    ...(align === 'center'
      ? { textAlign: 'center' }
      : align === 'end'
        ? { textAlign: 'right' }
        : {}),
  };
  const lines =
    numberOfLines !== undefined && uiScript === 'urdu' && numberOfLines <= 2
      ? numberOfLines + 1
      : numberOfLines;

  return (
    <RNText
      className={cn(scriptClass, TONE_CLASS[tone], className)}
      style={style}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? fontScaleCap(spec)}
      {...(lines !== undefined ? { numberOfLines: lines } : {})}
      {...(selectable !== undefined ? { selectable } : {})}
      {...(accessibilityRole ? { accessibilityRole } : {})}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      {...(script === 'arabic' || script === 'quran'
        ? { accessibilityLanguage: 'ar' }
        : uiScript === 'urdu'
          ? // iOS VoiceOver picks an Urdu voice even when the device language is English (24 S7-04).
            { accessibilityLanguage: 'ur' }
          : {})}
      {...(testID ? { testID } : {})}
    >
      {children}
    </RNText>
  );
}
