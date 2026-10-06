import {
  getCurrentOffering,
  initPurchases,
  onClientPremiumChange,
  purchase,
  restore,
  setPurchasesSdkForTests,
  signOutPurchases,
  type PurchasesSdk,
} from '../purchases';

// A configured build: the key value is a placeholder, never a real key.
jest.mock('@/lib/env', () => ({
  env: { REVENUECAT_API_KEY_IOS: 'placeholder', REVENUECAT_API_KEY_ANDROID: 'placeholder' },
}));

const active = { entitlements: { active: { premium: {} } } };
const none = { entitlements: { active: {} } };

function fakeSdk(overrides: Partial<PurchasesSdk> = {}): PurchasesSdk {
  return {
    configure: jest.fn(),
    logIn: jest.fn(async () => ({ customerInfo: none })),
    logOut: jest.fn(async () => none),
    getOfferings: jest.fn(async () => ({
      current: {
        identifier: 'default',
        availablePackages: [
          {
            identifier: '$rc_annual',
            packageType: 'ANNUAL',
            product: {
              identifier: 'thuluth_premium_annual',
              price: 4999,
              priceString: 'Rs 4,999',
              currencyCode: 'PKR',
              introPrice: { priceString: 'Free', periodNumberOfUnits: 7, periodUnit: 'DAY' },
            },
          },
          {
            identifier: '$rc_monthly',
            packageType: 'MONTHLY',
            product: {
              identifier: 'thuluth_premium_monthly',
              price: 699,
              priceString: 'Rs 699',
              currencyCode: 'PKR',
            },
          },
        ],
      },
    })),
    purchasePackage: jest.fn(async () => ({ customerInfo: active })),
    restorePurchases: jest.fn(async () => none),
    getCustomerInfo: jest.fn(async () => none),
    addCustomerInfoUpdateListener: jest.fn(),
    ...overrides,
  };
}

describe('purchases wrapper with an SDK', () => {
  afterEach(() => setPurchasesSdkForTests(undefined));

  it('configures once with the user id and switches users with logIn', async () => {
    const sdk = fakeSdk();
    setPurchasesSdkForTests(sdk);
    expect(await initPurchases('u1')).toBe(false);
    expect(await initPurchases('u1')).toBe(false);
    expect(sdk.configure).toHaveBeenCalledTimes(1);
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: 'placeholder', appUserID: 'u1' });
    await initPurchases('u2');
    expect(sdk.logIn).toHaveBeenCalledWith('u2');
  });

  it('maps the offering, buys a package and reports the entitlement', async () => {
    const sdk = fakeSdk();
    setPurchasesSdkForTests(sdk);
    const changes: boolean[] = [];
    onClientPremiumChange((p) => changes.push(p));
    await initPurchases('u1');
    const offering = await getCurrentOffering();
    expect(offering?.packages.map((p) => [p.period, p.trial?.days ?? null])).toEqual([
      ['annual', 7],
      ['monthly', null],
    ]);
    expect(await purchase('$rc_annual')).toEqual({ kind: 'purchased', active: true });
    expect(changes.at(-1)).toBe(true);
  });

  it('reports cancellations and pending payments without failing', async () => {
    setPurchasesSdkForTests(
      fakeSdk({
        purchasePackage: jest
          .fn()
          .mockRejectedValueOnce({ userCancelled: true })
          .mockRejectedValueOnce({ code: 'PAYMENT_PENDING_ERROR' })
          .mockRejectedValueOnce({ code: 'STORE_PROBLEM_ERROR' }),
      }),
    );
    await initPurchases('u1');
    await getCurrentOffering();
    expect(await purchase('$rc_monthly')).toEqual({ kind: 'cancelled' });
    expect(await purchase('$rc_monthly')).toEqual({ kind: 'pending' });
    expect(await purchase('$rc_monthly')).toEqual({ kind: 'failed', code: 'STORE_PROBLEM_ERROR' });
  });

  it('restores and signs out', async () => {
    const sdk = fakeSdk({ restorePurchases: jest.fn(async () => active) });
    setPurchasesSdkForTests(sdk);
    await initPurchases('u1');
    expect(await restore()).toEqual({ ok: true, active: true });
    await signOutPurchases();
    expect(sdk.logOut).toHaveBeenCalled();
    expect(await restore()).toEqual({ ok: false, active: false });
  });
});
