import { Platform } from 'react-native';

import { env } from '@/lib/env';

/**
 * RevenueCat wrapper (24 S5-13, 17 §6). Like the OneSignal wrapper, the SDK is loaded lazily and
 * only when the platform's API key is configured (EXPO_PUBLIC_RC_IOS_KEY / _ANDROID_KEY): without
 * it (local development, tests, builds made before the RevenueCat project exists) every call is a
 * no-op, offerings are unavailable and the paywall shows its "store unavailable" state. The App User
 * ID is `users.id`; purchases are configured only after sign-in (17 §2.2). The client's view of
 * the `premium` entitlement drives UI only; the server (`has_premium`) is the truth.
 */

export const ENTITLEMENT_ID = 'premium';
export const PRODUCT_IDS = {
  monthly: 'thuluth_premium_monthly',
  annual: 'thuluth_premium_annual',
} as const;

/** The subset of `react-native-purchases` this app uses (structural, so tests can fake it). */
interface SdkProduct {
  identifier: string;
  price: number;
  priceString: string;
  currencyCode: string;
  pricePerMonthString?: string | null;
  introPrice?: { priceString: string; periodNumberOfUnits: number; periodUnit: string } | null;
}
interface SdkPackage {
  identifier: string;
  packageType: string;
  product: SdkProduct;
}
interface SdkOffering {
  identifier: string;
  availablePackages: SdkPackage[];
  metadata?: Record<string, unknown>;
}
interface SdkCustomerInfo {
  entitlements: { active: Record<string, { expirationDate?: string | null } | undefined> };
}
export interface PurchasesSdk {
  configure(config: { apiKey: string; appUserID?: string | null }): void;
  logIn(appUserID: string): Promise<{ customerInfo: SdkCustomerInfo }>;
  logOut(): Promise<SdkCustomerInfo>;
  getOfferings(): Promise<{ current: SdkOffering | null }>;
  purchasePackage(pkg: SdkPackage): Promise<{ customerInfo: SdkCustomerInfo }>;
  restorePurchases(): Promise<SdkCustomerInfo>;
  getCustomerInfo(): Promise<SdkCustomerInfo>;
  addCustomerInfoUpdateListener(listener: (info: SdkCustomerInfo) => void): void;
}

export interface StorePackage {
  identifier: string;
  period: 'annual' | 'monthly' | 'other';
  productId: string;
  price: number;
  priceString: string;
  currencyCode: string;
  pricePerMonthString: string | null;
  /** Store-provided intro offer (the 7-day trial on annual, FR-SUB-02). */
  trial: { units: number; unit: string; days: number } | null;
}

export interface StoreOffering {
  id: string;
  packages: StorePackage[];
  metadata: Record<string, unknown>;
}

export type PurchaseOutcome =
  | { kind: 'purchased'; active: boolean }
  | { kind: 'cancelled' }
  | { kind: 'pending' }
  | { kind: 'failed'; code: string };

let sdk: PurchasesSdk | null | undefined;
let configuredFor: string | null = null;
let raw = new Map<string, SdkPackage>();
const listeners = new Set<(premium: boolean) => void>();

export function purchasesApiKey(os: string = Platform.OS): string | undefined {
  return os === 'ios' ? env.REVENUECAT_API_KEY_IOS : env.REVENUECAT_API_KEY_ANDROID;
}

function load(): PurchasesSdk | null {
  if (sdk !== undefined) return sdk;
  if (!purchasesApiKey()) {
    sdk = null;
    return sdk;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases') as { default?: PurchasesSdk };
    sdk = mod.default ?? null;
  } catch {
    // Native module missing (Expo Go or a build without it): purchases stay off.
    sdk = null;
  }
  return sdk;
}

/** Test seam: replaces the SDK (null = unavailable) and resets the configured user. */
export function setPurchasesSdkForTests(next: PurchasesSdk | null | undefined): void {
  sdk = next;
  configuredFor = null;
  raw = new Map();
  listeners.clear();
}

export function isPurchasesAvailable(): boolean {
  return load() !== null;
}

export function hasPremiumEntitlement(info: SdkCustomerInfo | null | undefined): boolean {
  return Boolean(info?.entitlements.active[ENTITLEMENT_ID]);
}

/** Client premium updates (purchase, restore, renewal seen by the SDK). */
export function onClientPremiumChange(listener: (premium: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const emit = (info: SdkCustomerInfo) => listeners.forEach((l) => l(hasPremiumEntitlement(info)));

/** Configures once per user (17 §6); a later user switch calls logIn. Returns client premium. */
export async function initPurchases(userId: string): Promise<boolean> {
  const s = load();
  const apiKey = purchasesApiKey();
  if (!s || !apiKey) return false;
  try {
    if (configuredFor === null) {
      s.configure({ apiKey, appUserID: userId });
      s.addCustomerInfoUpdateListener(emit);
      configuredFor = userId;
      const info = await s.getCustomerInfo();
      emit(info);
      return hasPremiumEntitlement(info);
    }
    if (configuredFor !== userId) {
      const { customerInfo } = await s.logIn(userId);
      configuredFor = userId;
      emit(customerInfo);
      return hasPremiumEntitlement(customerInfo);
    }
    return hasPremiumEntitlement(await s.getCustomerInfo());
  } catch {
    return false;
  }
}

export async function signOutPurchases(): Promise<void> {
  const s = load();
  if (!s || configuredFor === null) return;
  try {
    await s.logOut();
  } catch {
    // Anonymous after logout is fine; nothing to clean up.
  }
  configuredFor = null;
}

export function periodOf(packageType: string, identifier: string): StorePackage['period'] {
  if (packageType === 'ANNUAL' || identifier === '$rc_annual') return 'annual';
  if (packageType === 'MONTHLY' || identifier === '$rc_monthly') return 'monthly';
  return 'other';
}

export function toStoreOffering(o: SdkOffering): StoreOffering {
  return {
    id: o.identifier,
    metadata: o.metadata ?? {},
    packages: o.availablePackages.map((p) => ({
      identifier: p.identifier,
      period: periodOf(p.packageType, p.identifier),
      productId: p.product.identifier,
      price: p.product.price,
      priceString: p.product.priceString,
      currencyCode: p.product.currencyCode,
      pricePerMonthString: p.product.pricePerMonthString ?? null,
      trial: p.product.introPrice
        ? {
            units: p.product.introPrice.periodNumberOfUnits,
            unit: p.product.introPrice.periodUnit,
            days: trialDays(
              p.product.introPrice.periodNumberOfUnits,
              p.product.introPrice.periodUnit,
            ),
          }
        : null,
    })),
  };
}

/** Store trial length in days, for "7 days free" copy. */
export function trialDays(units: number, unit: string): number {
  const per: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };
  return units * (per[unit.toUpperCase()] ?? 1);
}

/** The current offering, or null when the SDK is unavailable (no key) or has none configured. */
export async function getCurrentOffering(): Promise<StoreOffering | null> {
  const s = load();
  if (!s || configuredFor === null) return null;
  const { current } = await s.getOfferings();
  if (!current) return null;
  raw = new Map(current.availablePackages.map((p) => [p.identifier, p]));
  return toStoreOffering(current);
}

interface SdkError {
  userCancelled?: boolean;
  code?: string | number;
}

export async function purchase(packageId: string): Promise<PurchaseOutcome> {
  const s = load();
  const pkg = raw.get(packageId);
  if (!s || !pkg) return { kind: 'failed', code: 'NOT_CONFIGURED' };
  try {
    const { customerInfo } = await s.purchasePackage(pkg);
    emit(customerInfo);
    const active = hasPremiumEntitlement(customerInfo);
    return { kind: 'purchased', active };
  } catch (e) {
    const err = (e ?? {}) as SdkError;
    if (err.userCancelled) return { kind: 'cancelled' };
    // PAYMENT_PENDING_ERROR (Ask to Buy, Play pending payment methods common in Pakistan).
    if (String(err.code) === '20' || String(err.code) === 'PAYMENT_PENDING_ERROR')
      return { kind: 'pending' };
    return { kind: 'failed', code: String(err.code ?? 'UNKNOWN') };
  }
}

export async function restore(): Promise<{ ok: boolean; active: boolean }> {
  const s = load();
  if (!s || configuredFor === null) return { ok: false, active: false };
  try {
    const info = await s.restorePurchases();
    emit(info);
    return { ok: true, active: hasPremiumEntitlement(info) };
  } catch {
    return { ok: false, active: false };
  }
}
