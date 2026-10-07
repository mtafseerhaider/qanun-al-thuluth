import { Hcaptcha } from '@hcaptcha/react-native-hcaptcha';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { isAppError } from '@/lib/supabase/app-error';
import { renderWithProviders } from '@/test/render';

import { captchaOptions, isCaptchaEnabled } from '../captcha';
import { CaptchaHost, type CaptchaMessage } from '../captcha-host';

const SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';
const TOKEN = 'P1_' + 'x'.repeat(60);

/** The `onMessage` the host passed to the (mocked) widget on its latest render. */
async function sendMessage(message: CaptchaMessage) {
  const props = jest.mocked(Hcaptcha).mock.lastCall?.[0] as
    { onMessage: (e: CaptchaMessage) => void } | undefined;
  if (!props) throw new Error('hCaptcha widget is not rendered');
  await act(async () => props.onMessage(message));
}

/** Asks for a token (as a protected auth call does) and lets the host show the challenge. */
async function open(): Promise<{ pending: Promise<{ captchaToken?: string }> }> {
  let pending!: Promise<{ captchaToken?: string }>;
  await act(async () => {
    pending = captchaOptions(SITE_KEY);
  });
  return { pending }; // wrapped: returning the promise itself would wait for the token
}

async function expectCaptchaFailure(promise: Promise<unknown>, reason: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isAppError(error) && error.code).toBe('AUTH_CAPTCHA_FAILED');
  expect(isAppError(error) && error.details.reason).toBe(reason);
}

describe('captchaOptions', () => {
  it('adds nothing when no site key is configured (auth behaves as before)', async () => {
    expect(isCaptchaEnabled(undefined)).toBe(false);
    await expect(captchaOptions(undefined)).resolves.toEqual({});
  });

  it('fails with AUTH_CAPTCHA_FAILED when a site key is set but no host is mounted', async () => {
    await expect(captchaOptions(SITE_KEY)).rejects.toMatchObject({ code: 'AUTH_CAPTCHA_FAILED' });
  });
});

describe('CaptchaHost', () => {
  it('renders nothing and registers no provider without a site key', async () => {
    await renderWithProviders(<CaptchaHost siteKey="" />);
    expect(screen.queryByTestId('captcha.modal')).toBeNull();
    await expect(captchaOptions(SITE_KEY)).rejects.toMatchObject({ code: 'AUTH_CAPTCHA_FAILED' });
  });

  it('shows the challenge and resolves with the token', async () => {
    await renderWithProviders(<CaptchaHost siteKey={SITE_KEY} />, { locale: 'ur' });
    expect(Hcaptcha).not.toHaveBeenCalled();

    const { pending } = await open();
    expect(screen.getByTestId('hcaptcha.widget')).toBeTruthy();
    expect(jest.mocked(Hcaptcha).mock.lastCall?.[0]).toMatchObject({
      siteKey: SITE_KEY,
      size: 'invisible',
      languageCode: 'ur',
    });

    await sendMessage({ nativeEvent: { data: 'open' }, success: true }); // challenge shown: keep waiting
    const markUsed = jest.fn();
    await sendMessage({ nativeEvent: { data: TOKEN }, success: true, markUsed });

    await expect(pending).resolves.toEqual({ captchaToken: TOKEN });
    expect(markUsed).toHaveBeenCalled();
    expect(screen.queryByTestId('hcaptcha.widget')).toBeNull();
  });

  it('resets an expired challenge instead of failing', async () => {
    await renderWithProviders(<CaptchaHost siteKey={SITE_KEY} />);
    const { pending } = await open();
    const reset = jest.fn();
    await sendMessage({ nativeEvent: { data: 'challenge-expired' }, success: false, reset });
    expect(reset).toHaveBeenCalled();
    await sendMessage({ nativeEvent: { data: TOKEN }, success: true });
    await expect(pending).resolves.toEqual({ captchaToken: TOKEN });
  });

  it('is dismissible: the labelled Cancel button rejects with AUTH_CAPTCHA_FAILED', async () => {
    await renderWithProviders(<CaptchaHost siteKey={SITE_KEY} />);
    const { pending } = await open();
    expect(screen.getByRole('header', { name: 'Security check' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await expectCaptchaFailure(pending, 'cancel');
    expect(screen.queryByTestId('hcaptcha.widget')).toBeNull();
  });

  it('rejects when the widget reports an error', async () => {
    await renderWithProviders(<CaptchaHost siteKey={SITE_KEY} />);
    const { pending } = await open();
    const failure = expectCaptchaFailure(pending, 'network-error'); // handle before it rejects
    await sendMessage({ nativeEvent: { data: 'network-error' }, success: false });
    await failure;
  });

  it('localizes the modal in Urdu', async () => {
    await renderWithProviders(<CaptchaHost siteKey={SITE_KEY} />, { locale: 'ur' });
    const { pending } = await open();
    expect(screen.getByRole('header', { name: 'سیکیورٹی چیک' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'منسوخ کریں' }));
    await expectCaptchaFailure(pending, 'cancel');
  });
});
