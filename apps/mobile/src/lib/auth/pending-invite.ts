import * as SecureStore from 'expo-secure-store';

import { useSessionStore } from '@/stores/use-session-store';

/**
 * Invitation deep links (11 §12, 02 §3.4): `https://thuluth.app/invite/<token>`,
 * `thuluth://invite/<token>` and the legacy `thuluth://invite?token=<token>` (FR-AUTH-08).
 * The token is parked in SecureStore (Keychain / Keystore, never MMKV or logs) and mirrored in
 * `useSessionStore.pendingInviteToken` until a signed-in user accepts or dismisses it.
 */
export const INVITE_TOKEN_KEY = 'thuluth.invite-token';
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export function isInviteToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

/** Returns the token for an invite link, or null for any other URL. */
export function parseInviteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match =
    /^(?:thuluth:\/\/|https:\/\/(?:www\.)?thuluth\.app\/)invite(?:\/([^/?#]+))?\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(
      url.trim(),
    );
  if (!match) return null;
  let token = match[1] ? decodeURIComponent(match[1]) : null;
  if (!token && match[2]) {
    const param = match[2].split('&').find((p) => p.startsWith('token='));
    token = param ? decodeURIComponent(param.slice('token='.length)) : null;
  }
  return isInviteToken(token) ? token : null;
}

export async function parkInviteToken(token: string): Promise<void> {
  if (!isInviteToken(token)) return;
  useSessionStore.getState().setPendingInviteToken(token);
  try {
    await SecureStore.setItemAsync(INVITE_TOKEN_KEY, token, OPTIONS);
  } catch {
    // The in-memory copy still lets the current session accept it.
  }
}

/** Restores a token parked before the app was killed (e.g. while the user fetched the OTP email). */
export async function restoreParkedInviteToken(): Promise<string | null> {
  try {
    const token = await SecureStore.getItemAsync(INVITE_TOKEN_KEY, OPTIONS);
    if (!isInviteToken(token)) return null;
    useSessionStore.getState().setPendingInviteToken(token);
    return token;
  } catch {
    return null;
  }
}

export async function clearParkedInviteToken(): Promise<void> {
  useSessionStore.getState().setPendingInviteToken(null);
  await SecureStore.deleteItemAsync(INVITE_TOKEN_KEY, OPTIONS).catch(() => undefined);
}

/** Parks the token when `url` is an invite link; returns true when it was handled. */
export function handleInviteUrl(url: string | null | undefined): boolean {
  const token = parseInviteUrl(url);
  if (!token) return false;
  void parkInviteToken(token);
  return true;
}
