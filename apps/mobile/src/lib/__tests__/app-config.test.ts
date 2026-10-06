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
