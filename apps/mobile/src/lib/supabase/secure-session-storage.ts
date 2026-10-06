import * as SecureStore from 'expo-secure-store';

/**
 * Chunked expo-secure-store adapter for the Supabase session (11 §7). SecureStore values are limited
 * to about 2 KB on some platforms, and a session JSON can exceed that.
 */
const CHUNK_SIZE = 1800;
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');
const countKey = (key: string) => `${safeKey(key)}.chunks`;
const chunkKey = (key: string, i: number) => `${safeKey(key)}.${i}`;

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = Number(await SecureStore.getItemAsync(countKey(key), OPTIONS));
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i), OPTIONS);
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    await secureSessionStorage.removeItem(key);
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(
        chunkKey(key, i),
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        OPTIONS,
      );
    }
    await SecureStore.setItemAsync(countKey(key), String(count), OPTIONS);
  },
  async removeItem(key: string): Promise<void> {
    const count = Number(await SecureStore.getItemAsync(countKey(key), OPTIONS));
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
    await SecureStore.deleteItemAsync(countKey(key), OPTIONS);
  },
};
