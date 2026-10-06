import {
  getPushPermission,
  getPushSubscriptionId,
  initPush,
  isPushAvailable,
  loginPush,
  permissionFromNative,
  requestPushPermission,
  setPushSdkForTests,
  type PushSdk,
} from '../push';

function fakeSdk() {
  let click:
    ((e: { notification: { additionalData?: object; launchURL?: string } }) => void) | null = null;
  const sdk: PushSdk = {
    initialize: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    Notifications: {
      requestPermission: jest.fn(async () => true),
      getPermissionAsync: jest.fn(async () => false),
      permissionNative: jest.fn(async () => 0),
      addEventListener: jest.fn((_e, l) => {
        click = l;
      }),
    },
    User: {
      pushSubscription: {
        getIdAsync: jest.fn(async () => 'sub-1'),
        addEventListener: jest.fn(),
      },
    },
  };
  return { sdk, tap: (data: object) => click?.({ notification: { additionalData: data } }) };
}

afterEach(() => setPushSdkForTests(undefined));

describe('OneSignal wrapper (24 S4-12)', () => {
  it('is a clean no-op without an app id', async () => {
    setPushSdkForTests(undefined);
    expect(isPushAvailable()).toBe(false);
    expect(initPush(jest.fn())).toBe(false);
    expect(await getPushPermission()).toBe('unavailable');
    expect(await requestPushPermission()).toBe(false);
    expect(await getPushSubscriptionId()).toBeNull();
    expect(() => loginPush('u-1')).not.toThrow();
  });

  it('initialises once, logs in with the user id and forwards taps', async () => {
    const { sdk, tap } = fakeSdk();
    setPushSdkForTests(sdk);
    const onOpen = jest.fn();
    expect(initPush(onOpen, 'app-id')).toBe(true);
    expect(initPush(onOpen, 'app-id')).toBe(true);
    expect(sdk.initialize).toHaveBeenCalledTimes(1);
    loginPush('u-1');
    expect(sdk.login).toHaveBeenCalledWith('u-1');
    expect(await getPushPermission()).toBe('undetermined');
    expect(await getPushSubscriptionId()).toBe('sub-1');
    tap({ kind: 'hydration_reminder', route: 'thuluth://hydration', notification_id: 'n-1' });
    expect(onOpen).toHaveBeenCalledWith({
      kind: 'hydration_reminder',
      route: 'thuluth://hydration',
      notification_id: 'n-1',
    });
  });

  it('maps native permission states', () => {
    expect(permissionFromNative(0)).toBe('undetermined');
    expect(permissionFromNative(1)).toBe('denied');
    expect(permissionFromNative(2)).toBe('granted');
    expect(permissionFromNative(3)).toBe('granted');
  });
});
