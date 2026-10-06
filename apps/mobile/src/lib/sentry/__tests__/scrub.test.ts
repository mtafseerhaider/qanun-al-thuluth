import type { ErrorEvent } from '@sentry/react-native';

import { easUpdateTags } from '../init';
import { REDACTED, scrubBreadcrumb, scrubEvent, scrubString } from '../scrub';

const baseEvent = (overrides: Partial<ErrorEvent>): ErrorEvent =>
  ({ type: undefined, ...overrides }) as ErrorEvent;

describe('Sentry PII scrubber', () => {
  it('masks email addresses in free text', () => {
    expect(scrubString('login failed for amina@example.com today')).toBe(
      'login failed for [email] today',
    );
  });

  it('keeps only the user id', () => {
    const out = scrubEvent(
      baseEvent({ user: { id: 'u-1', email: 'a@b.co', username: 'amina', ip_address: '1.2.3.4' } }),
    );
    expect(out.user).toEqual({ id: 'u-1' });
  });

  it('drops request bodies, cookies and auth headers', () => {
    const out = scrubEvent(
      baseEvent({
        request: {
          url: 'https://x.supabase.co/functions/v1/ai-chat?email=a@b.co',
          method: 'POST',
          data: { prompt: 'my son has a peanut allergy' },
          cookies: { sid: 'secret' },
          headers: {
            authorization: 'Bearer abc',
            apikey: 'anon',
            'content-type': 'application/json',
          },
        },
      }),
    );
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.headers).toEqual({ 'content-type': 'application/json' });
    expect(out.request?.url).not.toContain('a@b.co');
  });

  it('redacts names and health fields anywhere in extra and contexts', () => {
    const out = scrubEvent(
      baseEvent({
        extra: {
          member: {
            display_name: 'Amina',
            weight_kg: 31.2,
            allergies: ['peanut'],
            life_stage: 'child',
          },
          medications: ['metformin'],
          screen: 'Dashboard',
        },
        contexts: {
          os: { name: 'iOS', version: '18' },
          family: { first_name: 'Ali', height_cm: 120 },
        },
      }),
    );
    expect(out.extra).toEqual({
      member: {
        display_name: REDACTED,
        weight_kg: REDACTED,
        allergies: REDACTED,
        life_stage: 'child',
      },
      medications: REDACTED,
      screen: 'Dashboard',
    });
    expect(out.contexts?.os).toEqual({ name: 'iOS', version: '18' });
    expect(out.contexts?.family).toEqual({ first_name: REDACTED, height_cm: REDACTED });
  });

  it('scrubs exception messages and breadcrumbs', () => {
    const out = scrubEvent(
      baseEvent({
        exception: { values: [{ type: 'Error', value: 'no user amina@example.com' }] },
        breadcrumbs: [
          { message: 'sent to x@y.org', data: { body: '{"notes":"..."}', status_code: 500 } },
        ],
      }),
    );
    expect(out.exception?.values?.[0]?.value).toBe('no user [email]');
    expect(out.breadcrumbs?.[0]?.message).toBe('sent to [email]');
    expect(out.breadcrumbs?.[0]?.data).toEqual({ status_code: 500 });
  });

  it('removes request and response bodies from network breadcrumbs', () => {
    const crumb = scrubBreadcrumb({
      category: 'fetch',
      data: { url: '/rest/v1/x', request_body: '{}', response_body: '{}' },
    });
    expect(crumb.data).toEqual({ url: '/rest/v1/x' });
  });
});

describe('EAS Update tags (S7)', () => {
  it('tags the OTA update id and channel, or embedded / none', () => {
    expect(easUpdateTags({ updateId: 'u-1', channel: 'production' })).toEqual({
      eas_update_id: 'u-1',
      eas_channel: 'production',
    });
    expect(easUpdateTags({ updateId: null, channel: null, isEmbeddedLaunch: true })).toEqual({
      eas_update_id: 'embedded',
      eas_channel: 'none',
    });
    expect(easUpdateTags({})).toEqual({ eas_update_id: 'none', eas_channel: 'none' });
  });
});
