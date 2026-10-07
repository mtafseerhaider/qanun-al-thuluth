import * as SecureStore from 'expo-secure-store';

import { useSessionStore } from '@/stores/use-session-store';

import {
  clearParkedInviteToken,
  handleInviteUrl,
  INVITE_TOKEN_KEY,
  parkInviteToken,
  parseInviteUrl,
  restoreParkedInviteToken,
} from '../pending-invite';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  };
});

const TOKEN = 'Abc_123-xyz'.padEnd(43, 'Q');

beforeEach(() => {
  (SecureStore as unknown as { __store: Map<string, string> }).__store.clear();
  useSessionStore.setState({ pendingInviteToken: null });
});

describe('parseInviteUrl', () => {
  it.each([
    `https://thuluth.app/invite/${TOKEN}`,
    `https://www.thuluth.app/invite/${TOKEN}/`,
    `https://thuluth.app/invite/${TOKEN}?utm_source=whatsapp`,
    `https://thuluth.app/invite?token=${TOKEN}`,
  ])('reads the token from %s', (url) => {
    expect(parseInviteUrl(url)).toBe(TOKEN);
  });

  it.each([
    null,
    '',
    'thuluth://today',
    // S7-SEC-11: the custom scheme is never accepted for invites.
    `thuluth://invite/${TOKEN}`,
    `thuluth://invite?token=${TOKEN}`,
    `http://thuluth.app/invite/${TOKEN}`,
    'https://thuluth.app/invite/short',
    `https://evil.example/invite/${TOKEN}`,
    `https://thuluth.app.evil.example/invite/${TOKEN}`,
    `https://thuluth.app/invite/${TOKEN}<script>`,
  ])('rejects %s', (url) => {
    expect(parseInviteUrl(url)).toBeNull();
  });
});

describe('handleInviteUrl', () => {
  it('swallows custom-scheme invite links without parking the token (S7-SEC-11)', () => {
    expect(handleInviteUrl(`thuluth://invite/${TOKEN}`)).toBe(true);
    expect(handleInviteUrl(`thuluth://invite?token=${TOKEN}`)).toBe(true);
    expect(useSessionStore.getState().pendingInviteToken).toBeNull();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(handleInviteUrl('thuluth://invitations')).toBe(false);
  });

  it('parks the token from a universal link', () => {
    expect(handleInviteUrl(`https://thuluth.app/invite/${TOKEN}`)).toBe(true);
    expect(useSessionStore.getState().pendingInviteToken).toBe(TOKEN);
  });
});

describe('parking', () => {
  it('parks the token in SecureStore and the session store, and restores it after a restart', async () => {
    await parkInviteToken(TOKEN);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      INVITE_TOKEN_KEY,
      TOKEN,
      expect.objectContaining({ keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY' }),
    );
    expect(useSessionStore.getState().pendingInviteToken).toBe(TOKEN);

    useSessionStore.setState({ pendingInviteToken: null });
    await expect(restoreParkedInviteToken()).resolves.toBe(TOKEN);
    expect(useSessionStore.getState().pendingInviteToken).toBe(TOKEN);

    await clearParkedInviteToken();
    expect(useSessionStore.getState().pendingInviteToken).toBeNull();
    await expect(restoreParkedInviteToken()).resolves.toBeNull();
  });

  it('ignores malformed tokens', async () => {
    await parkInviteToken('nope');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(useSessionStore.getState().pendingInviteToken).toBeNull();
  });
});
