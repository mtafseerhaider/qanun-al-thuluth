# Sprint 7 performance pass (S7-01)

Code-level pass against the budgets in `01-product-requirements.md` §9.1. Nothing here was measured
on a phone: this environment has no device or simulator. What could be measured offline (bundle
size, the modules evaluated before the first render) is measured below; the rest is a checklist
for the reference devices.

## Results that were measured here

Measured with `npx expo export` (production, minified) on 2026-10-06, before and after this pass.

| Metric | Before | After | Change | Budget |
| --- | --- | --- | --- | --- |
| Android Hermes bytecode (`.hbc`) | 9,695,271 B (9.7 MB) | 8,035,284 B (8.0 MB) | -1.66 MB (-17.1%) | under 6 MB: **still over** |
| iOS Hermes bytecode | not measured | 8,033,060 B (8.0 MB) | | under 6 MB: **still over** |
| Android minified JS (before Hermes) | 6,633,942 B | 5,428,296 B | -1.21 MB (-18.2%) | |
| App modules evaluated before the first render | 493 | 322 | -35% | |
| Screen modules evaluated before the first render | 88 | 0 | -100% | |
| App source evaluated before the first render | 1,605 KB | 775 KB | -52% | |
| App modules for a cold start to Today | 493 | 326 (322 + the Today screen) | -34% | |

The "after" bundle includes FlashList (+80 KB minified), which was added in this pass.

### Launch follow-up: Sentry replay and web feedback stubbed

Measured the same way (`npx expo export`, production, Android unless noted) on 2026-10-06, right
before and after the stub, on the same tree (which already had the Sensory-calm suggestion sheet,
about 5 KB). Sizes of the stubbed packages come from the minified bundle's source map.

| Metric | Before stub | After stub | Change |
| --- | --- | --- | --- |
| Android Hermes bytecode (`.hbc`, plain export as above) | 8,041,629 B | 7,730,952 B | -310,677 B (-3.9%) |
| iOS Hermes bytecode (plain export) | not re-measured | 7,729,732 B | about -303 KB against S7's 8,033,060 B |
| Android minified JS (`--no-bytecode`) | 5,433,720 B | 5,248,269 B | -185,451 B (-3.4%) |
| Android `.hbc` exported with `--source-maps` | 6,589,952 B | 6,332,104 B | -257,848 B |
| `@sentry-internal/replay` + `replay-canvas` + `feedback` (minified) | 185,468 B | 0 (stub under 1 KB) | |

Note on the measurement: a plain `expo export` embeds Hermes debug info in the `.hbc`. Exporting
with `--source-maps` moves it to the `.map`, and the bytecode is then about 1.4 MB smaller
(6.33 MB instead of 7.73 MB). The numbers in this file use the plain export so they compare with
S7. Which of the two matches what ships (the APK/IPA bundle and EAS Update) still has to be read
from a store build's size report; if it is the stripped one, the bundle is near the 6 MB budget
already (see the on-device checklist).

How the module counts were taken: a static import graph from `index.ts` over `apps/mobile/src` and
`packages/shared` (type-only imports excluded; JSON locale files counted as modules but not as
source size). "Before the first render" means everything reachable through eager imports. After
this pass, `./screens/*` re-exports in feature barrels are lazy and navigators use
`getComponent`, so those edges are not followed. Third-party packages are counted as one node
each (43 before, 39 after) and their size is in the bundle numbers above.

## What changed

### Cold start

1. **Lazy screens.** Every feature barrel re-exports its screens, and `bootstrap.ts` imports the
   barrels for outbox handlers, so all 88 screen modules (and everything only they import) were
   evaluated before the first frame. `babel.config.js` now runs Babel's CommonJS transform with
   `lazyImports` for `./screens/*` specifiers: the barrel's screen exports become getters that
   require the module on first access. All navigators pass screens through
   `getComponent={() => X}`, so a screen's module runs when the screen is first shown. Screen
   modules have no import-time side effects, so this is safe; stores, outbox handlers and SDK
   adapters stay eager. The production bundle was checked: the barrel getters call the lazy
   require (`get:function(){return t().BudgetDashboardScreen}`).
   - Trade-off: Babel instead of Metro now does the ESM to CommonJS transform
     (`disableImportExportTransform: false`), which is how Expo worked before SDK 50. Expo's
     experimental tree shaking is not used here, so nothing is lost. Jest uses the same config, so
     the test suite runs through the same transform.
2. **Deferred init.** `bootstrap()` keeps only what the first screen needs: Sentry, i18n, query
   managers, outbox handler registration, push (so a notification tap that launched the app is
   not missed) and the RevenueCat listener (a Set add). The first outbox replay (network) and the
   analytics flush timer now run in `whenIdle()` (`requestIdleCallback`, 1.5 s deadline).
3. **RevenueCat browser engine removed from native bundles.** `react-native-purchases` imports
   `@revenuecat/purchases-js-hybrid-mappings` (1,041 KB minified) at module load, but uses it only
   in Expo Go, the Rork sandbox and on web. `metro.config.js` resolves it to
   `metro/revenuecat-browser-mode-stub.js` on iOS and Android; every call through the stub throws
   a clear error. This was the largest single item in the bundle and was also evaluated at
   startup.

4. **Sentry session replay and web feedback removed from native bundles (launch follow-up).**
   `@sentry/react-native` imports `@sentry/browser`, which re-exports `@sentry-internal/replay`,
   `@sentry-internal/replay-canvas` and `@sentry-internal/feedback` (185 KB minified together).
   The app enables neither: `lib/sentry/init.ts` adds only the navigation integration, and nothing
   imports a replay or feedback API. The stub list moved to `metro/native-stubs.js` (shared by
   `metro.config.js` and a test); these three resolve to `metro/sentry-browser-extras-stub.js` on
   iOS and Android, whose integrations throw if anyone enables them. React Native's own feedback
   widget (`@sentry/react-native` `dist/js/feedback`, used by `Sentry.wrap`) is untouched, and so
   is react-native-reanimated (NativeWind depends on it). The test reads the built files of
   `@sentry/browser`, `@sentry/react`, `@sentry/react-native` and `react-native-purchases` and
   fails if a stub misses a name they import, so an SDK upgrade cannot silently break it. Check
   on a device that Sentry still reports a test error from a production build.

### Startup timing marks

`src/lib/perf/startup.ts` records `js_start` (first app module, imported first by `index.ts`),
`bootstrap_done`, `fonts_ready`, `nav_ready` and `today_interactive` (Today has rendered from the
cache or the network). When Today is interactive, the report goes to Sentry as a `perf.startup`
breadcrumb (numbers only) and to the console in development. React Native's
`performance.rnStartupTiming`, when present, adds the native process start to `js_start`. The
Debug screen (More > Developer) shows the marks for the current launch.

### Lists

`ListScreen` (`src/components/ui/list-screen.tsx`) is the `Screen` shell with FlashList 2.0.2
(the version bundled with SDK 57; pure JS on the New Architecture, no native rebuild needed).
Converted:

| Screen | Rows (server limit) |
| --- | --- |
| Notifications inbox | 100 |
| Chat sessions | 100 |
| AI memory | 200 |
| Chat thread history (FlashList directly, with load-earlier as the header) | paged, unbounded |

Not converted, on purpose: help center (30 bundled articles), weight log (shows 30 rows), grocery
list detail (50 lists, items grouped by aisle with inline editors; revisit if beta lists exceed
about 80 items), recipe and plan screens (one week of meals).

### Images

The app shows no remote images: recipes have no photos in v1, and the only images are the meal
photo the user just took or picked. Adding `expo-image` would add a native module and a native
build for no caching benefit, so it is deferred until recipe imagery exists (record this decision
with lead). The two photo previews now set `resizeMethod="resize"`, so Android decodes a
12-megapixel photo at view size instead of full size (memory budget: 300 MB during chat with
images).

### Memoization

`ListScreen` wraps `renderItem` in `useCallback`, rows re-render through `extraData` only when the
state they read changes, and the notifications row renderer is memoized on language. The chat
thread's rows are built in one `useMemo` from history and live turns.

## Why the bundle is still over 6 MB, and the options

Largest remaining packages (minified JS): react-native-reanimated 721 KB, react-native 524 KB,
Sentry (core, react-native, replay, feedback, browser) about 650 KB, supabase-js about 230 KB,
react-native-worklets 88 KB, FlashList 80 KB, app code about 800 KB.

| Option | Saves (JS, approx.) | Cost and risk |
| --- | --- | --- |
| Drop reanimated and worklets: the app has no animations, and NativeWind only `require`s reanimated for `animate-*` / `transition-*` classes, which the app does not use | 800 KB | Native dependency removal, so a new native build. NativeWind lists reanimated as a peer; needs a check that `nativewind/babel` works without the worklets plugin |
| ~~Sentry: drop session replay and the feedback widget from the bundle~~ **Done (launch follow-up):** see "What changed", item 4 | 185 KB | A Sentry upgrade that imports a new name from those packages is caught by `src/lib/__tests__/native-stubs.test.ts` |
| Locale JSON loaded per language (only `en` or `ur` in memory) | about 200 KB of evaluation | i18n change; low risk |

Hermes bytecode is larger than minified JS for the same code, so 6 MB of bytecode means about
4.2 MB of minified JS. Getting there needs the first two options. Decision for lead and PO: keep
the 6 MB budget and take them in Sprint 7, or move the budget to 8.5 MB for v1.0 and plan them for
1.0.x.

## On-device checklist against §9.1

Run on the reference devices (Samsung Galaxy A14 class, Android 13, 4 GB; iPhone 11) with a
production build (`eas build --profile production`), Sentry performance on and the Debug screen
enabled through the `debug_menu` flag.

| Budget (p75) | How to measure | Result |
| --- | --- | --- |
| Cold start to interactive Today (cached): 2.5 s Android, 1.5 s iPhone 11 | Kill the app, open it 10 times with a cached plan; read `today_interactive` plus native start from the Debug screen, or the `perf.startup` breadcrumb and Sentry app start | |
| Warm start 0.8 s | Background for 1 min, reopen; Sentry warm app start | |
| Screen transition under 300 ms | Sentry navigation spans (TTID) for Today to meal detail, More to Hydration, Plan to recipe | |
| 60 fps on lists of 100 items | Seed 100 notifications and 100 chat sessions; scroll with the Perf Monitor on; FlashList `useBenchmark` can be wired into a debug build | |
| Optimistic log visible under 100 ms | Tap "Everyone ate" and log water; screen recording at 60 fps, count frames | |
| PostgREST read p95 under 400 ms from Pakistan | Sentry HTTP spans on a Pakistani mobile network | |
| JS bundle under 6 MB; install size under 60 MB | `npx expo export`; Play Console and App Store Connect size reports | 7.73 MB plain export, 6.33 MB with debug info split out (see above) |
| Memory under 300 MB during chat with images | Android Studio profiler: chat, attach 3 photos, scroll the thread | |

Also check on a device: no crash or blank screen when a screen is opened for the first time
(the lazy `getComponent` path), deep links into a lazy screen (invite, notification tap) on a cold
start, that RevenueCat purchases still work in a store build (the browser engine is stubbed), and that
Sentry still receives errors and navigation spans (replay and web feedback are stubbed).
