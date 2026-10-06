export const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, x-request-id, x-app-version, x-app-build, x-platform, accept-language, idempotency-key, x-region, x-thuluth-client-caps',
  'access-control-allow-methods': 'POST, OPTIONS',
};
