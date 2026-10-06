import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { AppError } from '@/lib/supabase/app-error';

/** Safe file name for a downloaded export: letters, digits, dash and underscore only. */
export function exportFileName(base: string, ext = 'pdf'): string {
  const clean = base
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${clean || 'export'}.${ext}`;
}

/**
 * Downloads a signed URL to the cache and opens the native share sheet (WhatsApp, Files, email,
 * print). The signed URL itself is never shared: it expires in 24 h and carries a token.
 */
export async function downloadAndShare(
  url: string,
  fileName: string,
  opts: { dialogTitle?: string; mimeType?: string } = {},
): Promise<void> {
  if (!(await Sharing.isAvailableAsync()))
    throw new AppError('FEATURE_DISABLED', 'Sharing is not available on this device.');
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, fileName);
  let file: File;
  try {
    file = await File.downloadFileAsync(url, target, { idempotent: true });
  } catch (error) {
    throw new AppError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Download failed.',
    );
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: opts.mimeType ?? 'application/pdf',
    UTI: 'com.adobe.pdf',
    ...(opts.dialogTitle ? { dialogTitle: opts.dialogTitle } : {}),
  });
}
