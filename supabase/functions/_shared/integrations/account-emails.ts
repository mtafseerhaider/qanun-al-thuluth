/**
 * Transactional account emails (06 §4.12 "Your data is ready", §4.13 deletion confirmation;
 * 16 §7.4 to §7.5). Rendered here in `en` and `ur` and sent through Postmark's plain `/email` API,
 * so no Postmark template has to be created by hand and the copy is tested with the code.
 *
 * Privacy rules: no health data, no household or member names, no download links (the export is
 * fetched in the app after sign-in, 16 §7.4) and no tokens. Each email says what happened, when,
 * and what to do if it was not you.
 *
 * Until the owner sets POSTMARK_SERVER_TOKEN every send is a logged no-op (`not_configured`), like
 * the invite sender in `email.ts`. Urdu copy is a draft pending native review (S7-05).
 */

export type AccountEmailKind =
  'deletion_requested' | 'deletion_cancelled' | 'deletion_completed' | 'export_ready';

export type EmailLocale = 'en' | 'ur';

export interface AccountEmail {
  kind: AccountEmailKind;
  to: string;
  locale: EmailLocale;
  /** IANA zone for dates in the body (users.timezone); UTC when unknown. */
  timezone?: string;
  /** deletion_requested: when erasure runs. export_ready: when the download expires. */
  at?: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export type AccountEmailSender = (
  email: AccountEmail,
) => Promise<{ sent: boolean; reason?: 'not_configured' | 'no_address' }>;

export const SUPPORT_ADDRESS = 'support@thuluth.app';
export const PRIVACY_ADDRESS = 'privacy@thuluth.app';

/** Normalises any stored locale to a supported email locale. */
export function emailLocale(locale: string | null | undefined): EmailLocale {
  return locale === 'ur' ? 'ur' : 'en';
}

function formatDate(iso: string | undefined, locale: EmailLocale, timezone?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions = { dateStyle: 'long', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-GB', {
      ...opts,
      timeZone: timezone || 'UTC',
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(d);
  }
}

interface Copy {
  subject: string;
  paragraphs: string[];
}

const COPY: Record<EmailLocale, Record<AccountEmailKind, (date: string) => Copy>> = {
  en: {
    deletion_requested: (date) => ({
      subject: 'Your Thuluth account is scheduled for deletion',
      paragraphs: [
        'We received a request to delete your Thuluth account.',
        `Your account and your data will be permanently deleted on ${date}. Until then you can cancel from Settings > Privacy > Delete my account.`,
        'For your security we have signed you out on your other devices.',
        'If you have an App Store or Google Play subscription, cancel it in the store as well. Deleting your account does not stop store billing.',
        `If you did not ask for this, sign in and cancel the deletion, then contact ${SUPPORT_ADDRESS}.`,
      ],
    }),
    deletion_cancelled: () => ({
      subject: 'Your Thuluth account deletion was cancelled',
      paragraphs: [
        'Your account deletion has been cancelled. Your account and data stay as they were.',
        `If you did not cancel it, contact ${SUPPORT_ADDRESS}.`,
      ],
    }),
    deletion_completed: () => ({
      subject: 'Your Thuluth account has been deleted',
      paragraphs: [
        'Your Thuluth account and the data linked to it have been deleted, as you asked.',
        'Backups that may still contain your data expire within 35 days and are not restored.',
        `Questions about your data: ${PRIVACY_ADDRESS}. Thank you for using Thuluth.`,
      ],
    }),
    export_ready: (date) => ({
      subject: 'Your Thuluth data is ready to download',
      paragraphs: [
        'The copy of your data you asked for is ready.',
        `Open Thuluth and go to Settings > Privacy > Download my data to save it. The download is available until ${date}.`,
        `If you did not ask for this, change how you sign in and contact ${SUPPORT_ADDRESS}.`,
      ],
    }),
  },
  ur: {
    deletion_requested: (date) => ({
      subject: 'آپ کا ثلث اکاؤنٹ حذف کرنے کے لیے طے کر دیا گیا ہے',
      paragraphs: [
        'ہمیں آپ کا ثلث اکاؤنٹ حذف کرنے کی درخواست ملی ہے۔',
        `آپ کا اکاؤنٹ اور ڈیٹا ${date} کو مستقل طور پر حذف کر دیا جائے گا۔ اس سے پہلے آپ ترتیبات > رازداری > میرا اکاؤنٹ حذف کریں میں جا کر اسے منسوخ کر سکتے ہیں۔`,
        'آپ کی حفاظت کے لیے ہم نے آپ کو دوسرے آلات سے سائن آؤٹ کر دیا ہے۔',
        'اگر آپ کی App Store یا Google Play پر سبسکرپشن ہے تو اسے اسٹور میں بھی منسوخ کریں۔ اکاؤنٹ حذف کرنے سے اسٹور کی ادائیگی بند نہیں ہوتی۔',
        `اگر یہ درخواست آپ نے نہیں کی تو سائن اِن کر کے حذف کرنا منسوخ کریں اور ${SUPPORT_ADDRESS} سے رابطہ کریں۔`,
      ],
    }),
    deletion_cancelled: () => ({
      subject: 'آپ کا ثلث اکاؤنٹ حذف کرنا منسوخ کر دیا گیا',
      paragraphs: [
        'آپ کا اکاؤنٹ حذف کرنا منسوخ کر دیا گیا ہے۔ آپ کا اکاؤنٹ اور ڈیٹا پہلے جیسا ہے۔',
        `اگر آپ نے منسوخ نہیں کیا تو ${SUPPORT_ADDRESS} سے رابطہ کریں۔`,
      ],
    }),
    deletion_completed: () => ({
      subject: 'آپ کا ثلث اکاؤنٹ حذف کر دیا گیا ہے',
      paragraphs: [
        'آپ کی درخواست کے مطابق آپ کا ثلث اکاؤنٹ اور اس سے منسلک ڈیٹا حذف کر دیا گیا ہے۔',
        'بیک اپ جن میں آپ کا ڈیٹا ہو سکتا ہے، 35 دن میں ختم ہو جاتے ہیں اور بحال نہیں کیے جاتے۔',
        `اپنے ڈیٹا کے بارے میں سوالات: ${PRIVACY_ADDRESS}۔ ثلث استعمال کرنے کا شکریہ۔`,
      ],
    }),
    export_ready: (date) => ({
      subject: 'آپ کا ثلث ڈیٹا ڈاؤن لوڈ کے لیے تیار ہے',
      paragraphs: [
        'آپ کے ڈیٹا کی جو کاپی آپ نے مانگی تھی وہ تیار ہے۔',
        `اسے محفوظ کرنے کے لیے ثلث کھولیں اور ترتیبات > رازداری > میرا ڈیٹا ڈاؤن لوڈ کریں میں جائیں۔ ڈاؤن لوڈ ${date} تک دستیاب ہے۔`,
        `اگر یہ درخواست آپ نے نہیں کی تو اپنا سائن اِن طریقہ بدلیں اور ${SUPPORT_ADDRESS} سے رابطہ کریں۔`,
      ],
    }),
  },
};

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderAccountEmail(email: AccountEmail): RenderedEmail {
  const date = formatDate(email.at, email.locale, email.timezone);
  const copy = COPY[email.locale][email.kind](date);
  const footer =
    email.locale === 'ur'
      ? 'یہ ایک خودکار سروس پیغام ہے۔ ثلث، thuluth.app'
      : 'This is an automated service message. Thuluth, thuluth.app';
  const dir = email.locale === 'ur' ? 'rtl' : 'ltr';
  const html = [
    `<!doctype html><html lang="${email.locale}" dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(copy.subject)}</title></head>`,
    `<body style="font-family:-apple-system,Segoe UI,Roboto,'Noto Nastaliq Urdu',sans-serif;line-height:1.6;color:#1f2933;max-width:560px;margin:0 auto;padding:24px" dir="${dir}">`,
    ...copy.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    `<p style="color:#6b7280;font-size:12px">${escapeHtml(footer)}</p>`,
    '</body></html>',
  ].join('');
  return { subject: copy.subject, text: [...copy.paragraphs, '', footer].join('\n\n'), html };
}

/** Postmark sender for account emails; a no-op until POSTMARK_SERVER_TOKEN is set. */
export function postmarkAccountEmailSender(
  token: string | undefined,
  opts: { from?: string; fetchImpl?: typeof fetch } = {},
): AccountEmailSender {
  const from = opts.from ?? 'Thuluth <hello@thuluth.app>';
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (email) => {
    if (!email.to) return { sent: false, reason: 'no_address' };
    if (!token) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          scope: 'account-email',
          msg: 'POSTMARK_SERVER_TOKEN not set; email skipped',
          kind: email.kind,
        }),
      );
      return { sent: false, reason: 'not_configured' };
    }
    const r = renderAccountEmail(email);
    const res = await fetchImpl('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-postmark-server-token': token,
      },
      body: JSON.stringify({
        From: from,
        To: email.to,
        Subject: r.subject,
        HtmlBody: r.html,
        TextBody: r.text,
        Tag: email.kind,
        MessageStream: 'outbound',
        TrackOpens: false,
        TrackLinks: 'None',
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Postmark ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await res.body?.cancel();
    return { sent: true };
  };
}
