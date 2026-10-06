import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/theme/cn';

import { OTP_LENGTH, sanitizeOtp } from '../utils/otp-flow';

export interface OtpCodeInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Fires once when the sixth digit arrives (typed, pasted or autofilled). */
  onComplete: (code: string) => void;
  /** Screen reader label, e.g. "Verification code, 6 digits". */
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  testID?: string;
}

export interface OtpCodeInputHandle {
  focus(): void;
  clear(): void;
}

/**
 * `Input variant="otp"` (02 §7.1.4): one real TextInput under six visual cells, so screen readers
 * see a single field, paste and OS one-time-code autofill work (iOS `oneTimeCode`, Android
 * `sms-otp`), and nothing asks the user to transcribe digit by digit (WCAG 3.3.8).
 * Digits are always laid out left to right, also in Urdu.
 */
export const OtpCodeInput = forwardRef<OtpCodeInputHandle, OtpCodeInputProps>(function OtpCodeInput(
  { value, onChange, onComplete, label, disabled = false, invalid = false, autoFocus, testID },
  ref,
) {
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => {
      onChange('');
      inputRef.current?.focus();
    },
  }));

  const handleChange = (text: string) => {
    const code = sanitizeOtp(text);
    onChange(code);
    if (code.length === OTP_LENGTH && code !== value) onComplete(code);
  };

  const activeIndex = Math.min(value.length, OTP_LENGTH - 1);

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      accessible={false}
      className={cn(disabled && 'opacity-disabled')}
    >
      <View
        style={{ flexDirection: 'row', direction: 'ltr' }}
        className="justify-center gap-2"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <View
            key={i}
            className={cn(
              'min-h-control-lg min-w-touch flex-1 items-center justify-center rounded-md border-2 bg-surface-sunken',
              invalid
                ? 'border-danger'
                : i === activeIndex && !disabled
                  ? 'border-primary'
                  : 'border-line-strong',
            )}
          >
            <Text variant="title" align="center">
              {value[i] ?? ''}
            </Text>
          </View>
        ))}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        importantForAutofill="yes"
        maxLength={OTP_LENGTH * 4}
        caretHidden
        contextMenuHidden={false}
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        aria-invalid={invalid}
        className="absolute inset-0 text-transparent opacity-0"
        {...(testID ? { testID } : {})}
      />
    </Pressable>
  );
});
