import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { formatCountdown, secondsUntil, useCountdown } from '@/hooks/use-countdown';

import { OtpCodeInput } from '../components/otp-code-input';

function Harness({ onComplete }: { onComplete: (code: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <OtpCodeInput
      value={value}
      onChange={setValue}
      onComplete={onComplete}
      label="Verification code, 6 digits"
      testID="otp"
    />
  );
}

describe('OtpCodeInput', () => {
  it('is a single labelled field configured for OS one-time-code autofill', async () => {
    await render(<Harness onComplete={jest.fn()} />);
    const input = screen.getByTestId('otp');
    expect(input.props.textContentType).toBe('oneTimeCode');
    expect(['one-time-code', 'sms-otp']).toContain(input.props.autoComplete);
    expect(input.props.keyboardType).toBe('number-pad');
    expect(screen.getByLabelText('Verification code, 6 digits')).toBeTruthy();
  });

  it('accepts a pasted message and completes once with the six digits', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByTestId('otp'), 'Your Thuluth code: 482 913');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('482913');
    expect(screen.getByTestId('otp').props.value).toBe('482913');
  });

  it('completes when autofill delivers the whole code at once, including Urdu digits', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByTestId('otp'), '۴۸۲۹۱۳');
    expect(onComplete).toHaveBeenCalledWith('482913');
  });

  it('does not complete on partial typing', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByTestId('otp'), '48');
    await fireEvent.changeText(screen.getByTestId('otp'), '4829');
    expect(onComplete).not.toHaveBeenCalled();
    // The digit cells are hidden from screen readers; the single input carries the value.
    expect(screen.getByText('9', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('otp').props.value).toBe('4829');
  });
});

describe('resend countdown', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('formats and computes remaining seconds', async () => {
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(0)).toBe('0:00');
    expect(secondsUntil(10_500, 10_000)).toBe(1);
    expect(secondsUntil(null, 10_000)).toBe(0);
    expect(secondsUntil(5_000, 10_000)).toBe(0);
  });

  it('ticks down once per second and stops at zero', async () => {
    let now = 0;
    const clock = () => now;
    const { result } = await renderHook(() => useCountdown(3_000, clock));
    expect(result.current).toBe(3);
    for (const expected of [2, 1, 0]) {
      now += 1000;
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(result.current).toBe(expected);
    }
    now += 5000;
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(0);
  });
});
