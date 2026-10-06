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

// Sprint 5 native modules (voice, photo, files): the real packages need native code. Tests that
// exercise them pass their own fakes (`fetchImpl`, injected readers).
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {}, LOW_QUALITY: {} },
  AudioQuality: { MIN: 0, LOW: 32, MEDIUM: 64, HIGH: 96, MAX: 127 },
  IOSOutputFormat: { MPEG4AAC: 'aac ' },
  useAudioRecorder: jest.fn(() => ({
    prepareToRecordAsync: jest.fn(async () => undefined),
    record: jest.fn(),
    stop: jest.fn(async () => undefined),
    uri: null,
    isRecording: false,
  })),
  useAudioRecorderState: jest.fn(() => ({ isRecording: false, durationMillis: 0 })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  ImageManipulator: { manipulate: jest.fn() },
}));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({ uri, size: 0 })),
}));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
