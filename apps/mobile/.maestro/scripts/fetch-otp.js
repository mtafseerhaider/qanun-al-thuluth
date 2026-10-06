/* global output, http, json, EMAIL, INBOX_URL, OTP */
// Reads the newest 6-digit sign-in code for EMAIL from a Mailpit-compatible test inbox
// (local Supabase serves one at http://127.0.0.1:54324). Sets output.otp for the calling flow.
// When OTP is provided (a fixed code from a test-inbox service), it is used as-is.
if (typeof OTP !== 'undefined' && OTP) {
  output.otp = OTP;
} else {
  const base = INBOX_URL.replace(/\/$/, '');
  const query = encodeURIComponent('to:"' + EMAIL + '"');
  const list = json(http.get(base + '/api/v1/search?query=' + query + '&limit=1').body);
  if (!list.messages || list.messages.length === 0) throw new Error('No email for ' + EMAIL);
  const message = json(http.get(base + '/api/v1/message/' + list.messages[0].ID).body);
  const match = /\b(\d{6})\b/.exec(message.Text || message.Snippet || '');
  if (!match) throw new Error('No 6-digit code in the latest email for ' + EMAIL);
  output.otp = match[1];
}
