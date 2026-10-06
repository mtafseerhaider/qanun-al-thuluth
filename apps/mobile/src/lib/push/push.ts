import { env } from '@/lib/env';

/**
 * OneSignal wrapper (24 S4-12, 06 §4.15). The SDK is loaded lazily and only when ONESIGNAL_APP_ID
 * is configured: without it (local development, tests, builds made before the OneSignal app
 * exists) every call is a no-op and the app behaves as if push were unavailable. The OneSignal
 * external id is the Thuluth user id, so the server targets users, never raw device tokens.
 */

/** The subset of `react-native-onesignal` this app uses. */
export interface PushSdk {
  initialize(appId: string): void;
  login(externalId: string): void;
  logout(): void;
  Notifications: {
    requestPermission(fallbackToSettings: boolean): Promise<boolean>;
    getPermissionAsync(): Promise<boolean>;
    permissionNative(): Promise<number>;
    addEventListener(
      event: 'click',
      listener: (e: { notification: { additionalData?: object; launchURL?: string } }) => void,
    ): void;
  };
  User: {
    pushSubscription: {
      getIdAsync(): Promise<string | null>;
      addEventListener(
        event: 'change',
        listener: (e: { current: { id?: string | null; optedIn?: boolean } }) => void,
      ): void;
    };
  };
}

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** Data carried by a tapped push (`data` of the OneSignal message). */
export interface PushOpen {
  kind?: string;
  route?: string;
  notification_id?: string;
}

let sdk: PushSdk | null | undefined;
let initialised = false;

function load(): PushSdk | null {
  if (sdk !== undefined) return sdk;
  if (!env.ONESIGNAL_APP_ID) {
    sdk = null;
    return sdk;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-onesignal') as { OneSignal?: PushSdk };
    sdk = mod.OneSignal ?? null;
  } catch {
    // Native module missing (Expo Go or a build without the plugin): push stays off.
    sdk = null;
  }
  return sdk;
}

/** Test seam: replaces the SDK (null = unavailable) and resets the init state. */
export function setPushSdkForTests(next: PushSdk | null | undefined): void {
  sdk = next;
  initialised = false;
}

export function isPushAvailable(): boolean {
  return load() !== null;
}

/** Initialises OneSignal once; `onOpen` receives the data of a tapped notification. */
export function initPush(onOpen: (data: PushOpen) => void, appId = env.ONESIGNAL_APP_ID): boolean {
  const s = load();
  if (!s || !appId || initialised) return initialised;
  try {
    s.initialize(appId);
    s.Notifications.addEventListener('click', (e) => {
      const data = (e.notification.additionalData ?? {}) as PushOpen;
      onOpen({
        ...data,
        ...(!data.route && e.notification.launchURL ? { route: e.notification.launchURL } : {}),
      });
    });
    initialised = true;
  } catch {
    initialised = false;
  }
  return initialised;
}

/** Links this install to the user (external id = `users.id`). */
export function loginPush(userId: string): void {
  if (!initialised) return;
  try {
    load()?.login(userId);
  } catch {
    // Best effort; the device row is still registered.
  }
}

export function logoutPush(): void {
  if (!initialised) return;
  try {
    load()?.logout();
  } catch {
    // Best effort.
  }
}

/** OSNotificationPermission: 0 not determined, 1 denied, 2 authorised, 3 provisional, 4 ephemeral. */
export function permissionFromNative(value: number): PushPermission {
  if (value === 0) return 'undetermined';
  if (value === 1) return 'denied';
  return 'granted';
}

export async function getPushPermission(): Promise<PushPermission> {
  const s = load();
  if (!s || !initialised) return 'unavailable';
  try {
    return permissionFromNative(await s.Notifications.permissionNative());
  } catch {
    return 'unavailable';
  }
}

/** The OS prompt; only after the in-app pre-prompt (02 §7.2.6). */
export async function requestPushPermission(): Promise<boolean> {
  const s = load();
  if (!s || !initialised) return false;
  try {
    return await s.Notifications.requestPermission(false);
  } catch {
    return false;
  }
}

export async function getPushSubscriptionId(): Promise<string | null> {
  const s = load();
  if (!s || !initialised) return null;
  try {
    return (await s.User.pushSubscription.getIdAsync()) ?? null;
  } catch {
    return null;
  }
}

/** Calls `listener` when OneSignal assigns or changes this install's subscription id. */
export function onPushSubscriptionChange(listener: (id: string | null) => void): void {
  const s = load();
  if (!s || !initialised) return;
  try {
    s.User.pushSubscription.addEventListener('change', (e) => listener(e.current.id ?? null));
  } catch {
    // Ignore: the id is read again on the next registration.
  }
}
