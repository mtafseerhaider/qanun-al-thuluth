import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { createSensitiveStorage, type SensitiveStorage } from './mmkv';

const KEY_NAME = 'thuluth.mmkv-key';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 32 characters from a 64-symbol alphabet (192 bits), the maximum MMKV accepts for AES-256. */
export function encodeKey(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 32), (b) => ALPHABET[b % 64]).join('');
}

let cached: SensitiveStorage | null = null;

/** Reads (or creates on first launch) the MMKV encryption key in SecureStore (09 §6.1). */
export async function getSensitiveStorage(): Promise<SensitiveStorage> {
  if (cached) return cached;
  let key = await SecureStore.getItemAsync(KEY_NAME);
  if (!key) {
    key = encodeKey(await Crypto.getRandomBytesAsync(32));
    await SecureStore.setItemAsync(KEY_NAME, key, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
  cached = createSensitiveStorage(key);
  return cached;
}
