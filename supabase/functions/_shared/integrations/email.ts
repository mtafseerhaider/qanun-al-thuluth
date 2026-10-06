export interface InviteEmail {
  to: string;
  locale: 'en' | 'ur';
  inviterName: string;
  householdName: string;
  role: 'caregiver' | 'viewer';
  shareUrl: string;
  message?: string;
}

export type InviteEmailSender = (email: InviteEmail) => Promise<{ sent: boolean }>;

/**
 * Postmark transactional email (06 §4.11, template `household-invite-{locale}`). Until the owner
 * connects Postmark (POSTMARK_SERVER_TOKEN), invites are not emailed and the app shares the link
 * instead, which the contract already returns as `share_url`.
 */
export function postmarkSender(
  token: string | undefined,
  from = 'Thuluth <hello@thuluth.app>',
): InviteEmailSender {
  return async (email) => {
    if (!token) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'POSTMARK_SERVER_TOKEN not set; invite email skipped',
        }),
      );
      return { sent: false };
    }
    const res = await fetch('https://api.postmarkapp.com/email/withTemplate', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-postmark-server-token': token,
      },
      body: JSON.stringify({
        From: from,
        To: email.to,
        TemplateAlias: `household-invite-${email.locale}`,
        TemplateModel: {
          inviter_name: email.inviterName,
          household_name: email.householdName,
          role: email.role,
          action_url: email.shareUrl,
          message: email.message ?? '',
        },
        MessageStream: 'outbound',
      }),
    });
    if (!res.ok) throw new Error(`Postmark ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { sent: true };
  };
}
