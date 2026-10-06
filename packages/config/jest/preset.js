// Shared Jest preset for Expo apps (docs/07 §3.3, §8.1; docs/21 §2). Spread into apps/mobile/jest.config.js.
const preset = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@locales/(.*)$': '<rootDir>/locales/$1',
    '^@assets/(.*)$': '<rootDir>/assets/$1',
  },
  // jest-expo's list (prefix match, no trailing slash) plus NativeWind and css-interop.
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|nativewind|react-native-css-interop|@thuluth))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.maestro/', '/android/', '/ios/'],
  clearMocks: true,
};

export default preset;
