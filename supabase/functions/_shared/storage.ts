import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Storage API access for the account-rights functions (10 §6.3): objects are always removed through
 * `storage.from(bucket).remove()`, never by deleting `storage.objects` rows, so files are freed.
 */

export interface StoredObject {
  /** Full object path inside the bucket. */
  path: string;
  created_at: string | null;
  size: number | null;
}

export interface StorageAdmin {
  /** Every object under `prefix` (recursive, folders expanded, at most `max`). */
  listAll(bucket: string, prefix: string, max?: number): Promise<StoredObject[]>;
  remove(bucket: string, paths: string[]): Promise<void>;
  download(bucket: string, path: string): Promise<Uint8Array>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  signedUrl(bucket: string, path: string, ttlSeconds: number): Promise<string>;
}

/** Removes every object under `prefix`; returns how many were removed. */
export async function removePrefix(
  storage: StorageAdmin,
  bucket: string,
  prefix: string,
): Promise<number> {
  let removed = 0;
  // Pages of up to 1000 until the prefix is empty (10 §6.3).
  for (let round = 0; round < 100; round++) {
    const objects = await storage.listAll(bucket, prefix, 1000);
    if (!objects.length) break;
    await storage.remove(
      bucket,
      objects.map((o) => o.path),
    );
    removed += objects.length;
    if (objects.length < 1000) break;
  }
  return removed;
}

export function supabaseStorageAdmin(admin: SupabaseClient): StorageAdmin {
  return {
    async listAll(bucket, prefix, max = 5000) {
      const out: StoredObject[] = [];
      const folders = [prefix.replace(/\/+$/, '')];
      while (folders.length && out.length < max) {
        const folder = folders.shift()!;
        for (let offset = 0; out.length < max; offset += 1000) {
          const { data, error } = await admin.storage
            .from(bucket)
            .list(folder, { limit: 1000, offset });
          if (error) {
            // A bucket that does not exist (yet) has nothing to remove.
            if (/not found/i.test(error.message)) return out;
            throw error;
          }
          for (const e of data ?? []) {
            const path = folder ? `${folder}/${e.name}` : e.name;
            if (e.id === null) folders.push(path);
            else
              out.push({
                path,
                created_at: e.created_at ?? null,
                size: typeof e.metadata?.size === 'number' ? e.metadata.size : null,
              });
          }
          if ((data?.length ?? 0) < 1000) break;
        }
      }
      return out.slice(0, max);
    },
    async remove(bucket, paths) {
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) throw error;
      }
    },
    async download(bucket, path) {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) throw error ?? new Error('download failed');
      return new Uint8Array(await data.arrayBuffer());
    },
    async upload(bucket, path, bytes, contentType) {
      const { error } = await admin.storage
        .from(bucket)
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw error;
    },
    async signedUrl(bucket, path, ttl) {
      const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, ttl);
      if (error || !data?.signedUrl) throw error ?? new Error('no signed url');
      return data.signedUrl;
    },
  };
}
