import {
  getCurrentOffering,
  initPurchases,
  isPurchasesAvailable,
  purchase,
  restore,
  setPurchasesSdkForTests,
  trialDays,
  type StorePackage,
} from '@/lib/purchases/purchases';

import { parseEntitlements } from '../api/entitlements-api';
import {
  annualSavingPercent,
  benefitsFor,
  downgradeNotice,
  effectivePremium,
  gate,
  headlineKey,
  isReadOnlyPremiumArea,
  OPTIMISTIC_WINDOW_MS,
  paywallPackages,
  statusKey,
} from '../utils/paywall-rules';

const pkg = (period: StorePackage['period'], price: number): StorePackage => ({
  identifier: `$rc_${period}`,
  period,
  productId: `thuluth_premium_${period}`,
  price,
  priceString: `PKR ${price}`,
  currencyCode: 'PKR',
  pricePerMonthString: null,
  trial: null,
});

describe('paywall gating', () => {
  it('sends free users to the paywall and lets premium through', () => {
    expect(gate({ premium: false })).toBe('paywall');
    expect(gate({ premium: true })).toBe('allowed');
  });

  it('never shows a paywall for a feature switched off by its flag', () => {
    expect(gate({ premium: false, flagEnabled: false })).toBe('disabled');
  });

  it('trusts the server when it says PREMIUM_REQUIRED', () => {
    expect(gate({ premium: true, serverSaidPremiumRequired: true })).toBe('paywall');
  });

  it('uses the store entitlement only briefly after a purchase while the webhook lands', () => {
    const now = 1_000_000_000;
    expect(
      effectivePremium({ server: false, clientPremium: true, purchasedAt: now - 1000, now }),
    ).toBe(true);
    expect(
      effectivePremium({
        server: false,
        clientPremium: true,
        purchasedAt: now - OPTIMISTIC_WINDOW_MS - 1,
        now,
      }),
    ).toBe(false);
    expect(effectivePremium({ server: true, clientPremium: false, purchasedAt: null, now })).toBe(
      true,
    );
    expect(effectivePremium({ server: null, clientPremium: false, purchasedAt: null, now })).toBe(
      false,
    );
  });

  it('keeps premium areas readable after a downgrade', () => {
    expect(isReadOnlyPremiumArea(false, true)).toBe(true);
    expect(isReadOnlyPremiumArea(false, false)).toBe(false);
    expect(isReadOnlyPremiumArea(true, true)).toBe(false);
  });
});

describe('paywall content', () => {
  it('preselects annual and computes the saving from store prices', () => {
    const offering = {
      id: 'default',
      metadata: {},
      packages: [pkg('monthly', 699), pkg('annual', 4999)],
    };
    const { annual, monthly } = paywallPackages(offering);
    expect(annual?.period).toBe('annual');
    expect(monthly?.period).toBe('monthly');
    expect(annualSavingPercent(annual, monthly)).toBe(40);
    expect(annualSavingPercent(annual, { price: 5, currencyCode: 'USD' })).toBeNull();
    expect(paywallPackages(null)).toEqual({ annual: null, monthly: null });
  });

  it('leads with the benefit of the trigger', () => {
    expect(benefitsFor('ramadan_plan')[0]).toBe('ramadan');
    expect(benefitsFor('photo')[0]).toBe('chat');
    expect(headlineKey('photo')).toBe('paywall.headline.photo');
    expect(headlineKey('export')).toBe('paywall.headline.default');
  });

  it('maps subscription states to status copy and downgrade banners', () => {
    expect(statusKey(null, true)).toBe('status.shared');
    expect(statusKey(null, false)).toBe('status.free');
    const base = parseEntitlements({ premium: true, status: 'in_grace' });
    expect(downgradeNotice(base)).toBe('billing_issue');
    expect(downgradeNotice(parseEntitlements({ premium: true, status: 'cancelled' }))).toBe(
      'ends_soon',
    );
    expect(downgradeNotice(parseEntitlements({ premium: false, status: 'expired' }))).toBe(
      'expired_read_only',
    );
    expect(downgradeNotice(parseEntitlements({ premium: false, householdReadOnly: true }))).toBe(
      'expired_read_only',
    );
    expect(downgradeNotice(parseEntitlements({ premium: true, status: 'active' }))).toBeNull();
  });

  it('parses entitlements leniently', () => {
    expect(
      parseEntitlements({ premium: true, status: 'something_new', periodType: 'trial' }),
    ).toMatchObject({
      premium: true,
      status: null,
      trial: true,
    });
    expect(parseEntitlements(null).premium).toBe(false);
  });
});

describe('RevenueCat wrapper', () => {
  afterEach(() => setPurchasesSdkForTests(undefined));

  it('is a no-op without an API key', async () => {
    setPurchasesSdkForTests(undefined);
    expect(isPurchasesAvailable()).toBe(false);
    expect(await initPurchases('u1')).toBe(false);
    expect(await getCurrentOffering()).toBeNull();
    expect(await purchase('$rc_annual')).toEqual({ kind: 'failed', code: 'NOT_CONFIGURED' });
    expect(await restore()).toEqual({ ok: false, active: false });
  });

  it('converts trial periods to days', () => {
    expect(trialDays(7, 'DAY')).toBe(7);
    expect(trialDays(1, 'WEEK')).toBe(7);
    expect(trialDays(1, 'MONTH')).toBe(30);
  });
});
