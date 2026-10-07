import type { ConfigContext, ExpoConfig } from 'expo/config';

// app.config.ts sits outside src, which has no path alias.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = (require('../../../app.config') as { default: (c: ConfigContext) => ExpoConfig })
  .default;

describe('app.config plugins', () => {
  it('turns off the expo-secure-store Face ID purpose string (biometrics are not used)', () => {
    const config = appConfig({ config: {} } as ConfigContext);
    const entry = (config.plugins ?? []).find(
      (p) => (Array.isArray(p) ? p[0] : p) === 'expo-secure-store',
    );
    expect(entry).toEqual(['expo-secure-store', { faceIDPermission: false }]);
    expect(config.ios?.infoPlist?.NSFaceIDUsageDescription).toBeUndefined();
  });
});

describe('app.config push and CAPTCHA', () => {
  it('declares the time-sensitive notifications entitlement (suhoor and iftar reminders)', () => {
    const config = appConfig({ config: {} } as ConfigContext);
    expect(config.ios?.entitlements?.['com.apple.developer.usernotifications.time-sensitive']).toBe(
      true,
    );
  });

  it('exposes the public hCaptcha site key in extra', () => {
    const before = process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY;
    process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY = 'site-key-1';
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fresh = (require('../../../app.config') as { default: typeof appConfig }).default;
        expect(fresh({ config: {} } as ConfigContext).extra?.HCAPTCHA_SITE_KEY).toBe('site-key-1');
      });
    } finally {
      if (before === undefined) delete process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY;
      else process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY = before;
    }
  });
});
