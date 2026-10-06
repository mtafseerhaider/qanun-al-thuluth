import { useSessionStore } from '@/stores/use-session-store';

import { filterInviteUrl } from '../linking';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  setItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const TOKEN = 'Abc_123-xyz'.padEnd(43, 'Q');
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => useSessionStore.setState({ pendingInviteToken: null }));

describe('linking filter', () => {
  it('swallows invite links (parking the token) and forwards everything else to the router', async () => {
    expect(filterInviteUrl(`https://thuluth.app/invite/${TOKEN}`)).toBeNull();
    await flush();
    expect(useSessionStore.getState().pendingInviteToken).toBe(TOKEN);
    expect(filterInviteUrl('thuluth://settings')).toBe('thuluth://settings');
    expect(filterInviteUrl(null)).toBeNull();
  });
});
