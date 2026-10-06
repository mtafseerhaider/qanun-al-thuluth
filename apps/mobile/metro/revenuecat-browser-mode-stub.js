// Native builds only (metro.config.js, apps/mobile/docs/perf-s7.md): replaces
// @revenuecat/purchases-js-hybrid-mappings, the ~1 MB purchases-js engine that react-native-purchases
// uses only in "browser mode" (Expo Go, Rork sandbox, web). Thuluth ships as a dev client and store
// build with the RNPurchases native module, so browser mode never runs. If it ever does, every call
// fails loudly here instead of silently pretending to sell a subscription.
/* global module */
'use strict';

const message =
  '[thuluth] RevenueCat browser mode is not bundled in native builds. Use a dev client or store build.';

function unavailable() {
  throw new Error(message);
}

const PurchasesCommon = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === 'isConfigured') return () => false;
      return unavailable;
    },
  },
);

module.exports = { PurchasesCommon };
