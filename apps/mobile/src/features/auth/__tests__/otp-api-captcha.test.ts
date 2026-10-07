import { captchaOptions } from '@/lib/auth/captcha';
import { supabase } from '@/lib/supabase/client';

import { requestEmailOtp, signInReviewer, verifyEmailOtp } from '../api/otp-api';

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithOtp: jest.fn(async () => ({ error: null })),
      signInWithPassword: jest.fn(async () => ({ error: null })),
      verifyOtp: jest.fn(async () => ({ error: null })),
    },
  },
}));
jest.mock('@/lib/auth/captcha', () => ({ captchaOptions: jest.fn(async () => ({})) }));

const auth = supabase!.auth as unknown as Record<string, jest.Mock>;

describe('otp-api CAPTCHA plumbing', () => {
  it('sends no captchaToken when CAPTCHA is off (unchanged request)', async () => {
    await requestEmailOtp('Amina@Example.com ', 'ur');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'amina@example.com',
      options: { shouldCreateUser: true, data: { locale: 'ur' } },
    });
  });

  it('passes the hCaptcha token to signInWithOtp and reviewer password sign-in', async () => {
    jest.mocked(captchaOptions).mockResolvedValue({ captchaToken: 'tok-1' });
    await requestEmailOtp('amina@example.com', 'en');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'amina@example.com',
      options: { shouldCreateUser: true, data: { locale: 'en' }, captchaToken: 'tok-1' },
    });
    await signInReviewer('reviewer@thuluth.app', 'pw');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'reviewer@thuluth.app',
      password: 'pw',
      options: { captchaToken: 'tok-1' },
    });
  });

  it('does not ask for a token to verify a code (not CAPTCHA-protected)', async () => {
    await verifyEmailOtp('amina@example.com', '123456');
    expect(captchaOptions).not.toHaveBeenCalled();
  });

  it('does not send the code when the security check fails', async () => {
    jest
      .mocked(captchaOptions)
      .mockRejectedValue(Object.assign(new Error('x'), { code: 'AUTH_CAPTCHA_FAILED' }));
    await expect(requestEmailOtp('amina@example.com', 'en')).rejects.toMatchObject({
      code: 'AUTH_CAPTCHA_FAILED',
    });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });
});
