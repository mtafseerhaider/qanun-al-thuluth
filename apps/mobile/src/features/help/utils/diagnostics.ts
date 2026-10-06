/**
 * Support diagnostic bundle (S6-12). Only technical context the user can read before sending: no
 * name, email, health data or household names. The user id is hashed so support can find logs
 * without the raw id being in an email.
 */
export interface Diagnostics {
  appVersion: string;
  platform: string;
  osVersion: string;
  locale: string;
  role: string | null;
  userRef: string | null;
  pendingSync: number;
  failedSync: number;
}

export function diagnosticsText(d: Diagnostics): string {
  return [
    `app: ${d.appVersion}`,
    `platform: ${d.platform} ${d.osVersion}`,
    `locale: ${d.locale}`,
    `role: ${d.role ?? 'none'}`,
    `user ref: ${d.userRef ?? 'signed out'}`,
    `pending sync: ${d.pendingSync}, failed sync: ${d.failedSync}`,
  ].join('\n');
}

export const SUPPORT_EMAIL = 'support@thuluth.app';

export function supportMailto(
  subject: string,
  message: string,
  diagnostics: string | null,
): string {
  const body = diagnostics ? `${message}\n\n---\n${diagnostics}` : message;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
