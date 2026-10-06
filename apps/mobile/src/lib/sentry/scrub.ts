import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

/**
 * PII scrubber for Sentry (docs/16 security, 07 §4). Health data, names, emails and request bodies
 * never leave the device: sensitive keys are redacted wherever they appear, email addresses are
 * masked in free text, and request bodies, cookies and auth headers are dropped.
 */
export const REDACTED = '[redacted]';

const SENSITIVE_KEY =
  /(e-?mail|^name$|_name$|name_|display_?name|first_?name|last_?name|full_?name|phone|address|password|token|secret|authorization|cookie|dob|date_of_birth|birth|weight|height|bmi|z_?score|percentile|allerg|condition|diagnos|medic|supplement|pregnan|breastfeed|blood|sensory|symptom|health|notes?$|journal|prompt|^content$|transcript|description|body$)/i;

/** SDK-generated contexts with no user data (their `name` fields are OS/device model names). */
const SAFE_CONTEXTS = new Set(['os', 'app', 'runtime', 'trace', 'react_native_context', 'expo']);

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function scrubString(value: string): string {
  return value.replace(EMAIL, '[email]');
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function scrubEvent<T extends ErrorEvent>(event: T): T {
  const e = { ...event };
  if (e.user) e.user = e.user.id !== undefined ? { id: e.user.id } : {};
  if (e.request) {
    const { data: _data, cookies: _cookies, headers, ...rest } = e.request;
    e.request = { ...rest, ...(rest.url ? { url: scrubString(rest.url) } : {}) };
    if (headers) {
      const safe: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers))
        if (!SENSITIVE_KEY.test(k) && !/apikey/i.test(k)) safe[k] = v;
      e.request.headers = safe;
    }
  }
  if (e.message) e.message = scrubString(e.message);
  if (e.exception?.values) {
    e.exception = {
      ...e.exception,
      values: e.exception.values.map((ex) => ({
        ...ex,
        ...(ex.value ? { value: scrubString(ex.value) } : {}),
      })),
    };
  }
  if (e.extra) e.extra = scrubValue(e.extra) as typeof e.extra;
  if (e.contexts) {
    const contexts: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e.contexts))
      contexts[k] = SAFE_CONTEXTS.has(k) ? v : scrubValue(v);
    e.contexts = contexts as typeof e.contexts;
  }
  if (e.tags) e.tags = scrubValue(e.tags) as typeof e.tags;
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map(scrubBreadcrumb);
  return e;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const c: Breadcrumb = { ...crumb };
  if (c.message) c.message = scrubString(c.message);
  if (c.data) {
    const data = scrubValue(c.data) as Record<string, unknown>;
    // Network breadcrumbs: keep method, status and URL path only.
    delete data.request_body;
    delete data.response_body;
    delete data.body;
    c.data = data;
  }
  return c;
}
