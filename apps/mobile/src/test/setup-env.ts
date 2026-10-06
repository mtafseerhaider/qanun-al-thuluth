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
jest.mock('expo-file-system', () => {
  const File = Object.assign(
    jest.fn().mockImplementation((...parts: unknown[]) => ({
      uri: parts.map(String).join('/'),
      size: 0,
      exists: false,
      delete: jest.fn(),
    })),
    { downloadFileAsync: jest.fn(async (_url: string, dest: { uri: string }) => dest) },
  );
  const Directory = jest.fn().mockImplementation(() => ({ exists: true, create: jest.fn() }));
  return { File, Directory, Paths: { cache: 'cache', document: 'document' } };
});
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

// FlashList (24 S7-01): Jest has no layout, so give the list a fixed 400 x 900 viewport and
// 100 pt rows (as @shopify/flash-list/jestSetup does; its FlashList alias targets an export 2.0.2
// does not have). Rows then mount in tests the way they do on a phone.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const box = (width: number, height: number) => jest.fn(() => ({ x: 0, y: 0, width, height }));
  return {
    ...actual,
    measureParentSize: box(400, 900),
    measureFirstChildLayout: box(400, 900),
    measureItemLayout: box(400, 100),
  };
});
