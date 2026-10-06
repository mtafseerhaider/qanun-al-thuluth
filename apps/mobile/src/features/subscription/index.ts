export { PaywallScreen } from './screens/paywall-screen';
export { SubscriptionScreen } from './screens/subscription-screen';
export { DowngradeBanner, PremiumBadge, UpsellCard } from './components/upsell-card';
export {
  useEntitlements,
  useOffering,
  usePaywall,
  usePremium,
  usePurchase,
  useRestorePurchases,
} from './hooks/use-subscription';
export {
  downgradeNotice,
  gate,
  isReadOnlyPremiumArea,
  type GateDecision,
  type PremiumFeature,
} from './utils/paywall-rules';
export type { EntitlementsView } from './api/entitlements-api';
