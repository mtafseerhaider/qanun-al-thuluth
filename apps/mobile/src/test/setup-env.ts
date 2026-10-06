// Runs before each test file's framework setup.
// react-native-mmkv v4 swaps in an in-memory mock under Jest, but importing it still loads the Nitro
// bridge, which has no native module here.
jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => ({})),
    box: jest.fn(),
  },
}));

// Importing the real Sentry SDK starts a timer that outlives the test worker; tests only need the API surface.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  setUser: jest.fn(),
  wrap: <T>(component: T) => component,
  reactNavigationIntegration: jest.fn(() => ({ registerNavigationContainer: jest.fn() })),
}));
