# OneSignal and Firebase (push notifications): configuration runbook

> **Environments:** dev / staging / prod · **Time:** ~30 min for Firebase, ~30 min per OneSignal app · **Needs:** a Google account for Firebase, a OneSignal account, the APNs key from [apple-app-store.md](apple-app-store.md) step 3, the Supabase CLI, 1Password vault "Thuluth Platform" · **Related:** [apple-app-store.md](apple-app-store.md), [google-play.md](google-play.md), [eas-builds.md](eas-builds.md), [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md), [password-manager.md](password-manager.md), [`docs/ops/secrets.md`](../ops/secrets.md), [`docs/ops/production-environment.md`](../ops/production-environment.md) Step 5

## What this configures

Thuluth sends every push (meal, hydration, suhoor and iftar reminders, plan ready, billing issue) from the `notifications-dispatch` Edge Function through OneSignal's REST API. OneSignal delivers to iPhones through Apple's APNs and to Android phones through Firebase Cloud Messaging (FCM). The app links each install to the user with OneSignal's **external id = `users.id`**, and the server targets that id. While `ONESIGNAL_APP_ID` or `ONESIGNAL_REST_API_KEY` is unset, pushes are not sent: each due notification is marked `failed` with reason `not_configured`, and account erasure reports `not_configured` for OneSignal (secrets.md §1). While `EXPO_PUBLIC_ONESIGNAL_APP_ID` is unset for a build, the OneSignal plugin is left out of that build and the push SDK never starts.

Menu names in the Firebase and OneSignal consoles change often. They may differ slightly from the labels below.

## Before you start

- [ ] The APNs key `.p8`, its Key ID and the Apple Team ID are in 1Password ("shared apns-p8-key", "shared apple-team-id"). See [apple-app-store.md](apple-app-store.md) steps 1 and 3.
- [ ] The App IDs have Push Notifications and App Groups ([apple-app-store.md](apple-app-store.md) step 2).
- [ ] The Supabase projects exist ([supabase-projects.md](supabase-projects.md)).

## Which OneSignal app serves which build

| Environment | OneSignal app | iOS bundle id | Android package | Firebase project | Plugin `mode` (app.config.ts) |
|---|---|---|---|---|---|
| dev | **Thuluth Dev** | `app.thuluth.mobile.dev` | `app.thuluth.mobile.dev` | `thuluth-nonprod` | `development` |
| staging | **Thuluth Staging** | `app.thuluth.mobile.staging` | `app.thuluth.mobile.staging` | `thuluth-nonprod` | `development` |
| prod | **Thuluth Prod** | `app.thuluth.mobile` | `app.thuluth.mobile` | `thuluth-prod` | `production` |

Staging has its own bundle id (`app.thuluth.mobile.staging`), and a OneSignal app's Apple platform holds a single bundle id, so staging has its own OneSignal app, **Thuluth Staging** (19 §1). Keep "Thuluth Prod" strictly separate from both.

## Steps

### 1. Create the Firebase projects (for FCM)

Do this twice: `thuluth-nonprod` (dev and staging) and `thuluth-prod`.

1. https://console.firebase.google.com > **Add project**. Name `thuluth-prod` (or `thuluth-nonprod`). Turn **Google Analytics off**: the app does not use it.
2. Project overview > **Add app** > Android. Package `app.thuluth.mobile` (for `thuluth-nonprod`: add two Android apps, `app.thuluth.mobile.dev` and `app.thuluth.mobile.staging`). Skip the `google-services.json` download and the SDK steps: OneSignal registers the device itself and the app has no Firebase SDK.
3. Project settings > **Cloud Messaging**. Check that **Firebase Cloud Messaging API (V1)** shows "Enabled". If not, follow its link to enable it in Google Cloud.
4. Project settings > **Service accounts** > **Generate new private key** > Generate. A JSON file downloads once.
5. Save the JSON in 1Password as "prod fcm-service-account-json" (or "staging fcm-service-account-json" for `thuluth-nonprod`), then delete the downloaded file.

You do not need the legacy FCM server key. It has been shut down; OneSignal uses the V1 service account.

### 2. Create the OneSignal account and apps

1. Sign up at https://onesignal.com with a role mailbox (for example `push@thuluth.app`). Turn on two-factor authentication. Create the organisation `Thuluth`.
2. **New App/Website** > name **Thuluth Prod**. Choose the organisation. Platform: **Apple iOS (APNs)** first.
3. Repeat later for **Thuluth Staging** and **Thuluth Dev**, using their bundle ids, packages and Firebase project from the table.

### 3. Apple iOS platform (APNs)

In the OneSignal app > Settings > **Push & In-App** > Apple iOS (APNs):

1. Authentication type: **.p8 Auth Key (recommended)**. Do not use a `.p12` certificate.
2. Upload the `.p8` file, then enter the **Key ID**, the **Team ID** and the **App Bundle ID** from the table (`app.thuluth.mobile` for Thuluth Prod).
3. Save.

The one APNs key works for all three apps and for both APNs environments (it was created as "Sandbox & Production"). The environment of each device is decided by the build, not by this screen: the OneSignal plugin writes `aps-environment` from its `mode`, which `app.config.ts` sets to `production` for the production profile and `development` for the others. If the dashboard ever asks you to pick an environment, pick **Production** for Thuluth Prod and **Development (Sandbox)** for Thuluth Dev; for Thuluth Staging pick Production if testers install it from TestFlight.

### 4. Google Android platform (FCM)

Same screen > **Google Android (FCM)**:

1. Upload the service account JSON for the matching Firebase project ("prod fcm-service-account-json" for Thuluth Prod).
2. Save. OneSignal shows the Firebase project id. Check it is the right one.

### 5. App settings

Still in the OneSignal app:

1. **External id**: nothing to switch on. The app calls `OneSignal.login(users.id)` after sign-in and `logout()` on sign-out (`apps/mobile/src/lib/push/push.ts`), and the server sends to `include_aliases.external_id` (`supabase/functions/_shared/integrations/onesignal.ts`).
2. **Tags**: the app sets no tags today. Do not add tags from the dashboard or the API. If tags are added later, only `locale` and `tier` are allowed (04 §3, production-environment.md Step 5), never health data.
3. **Location**: leave off. The app never shares location with OneSignal.
4. **In-app messages**: not used. Do not create any and leave in-app message analytics off.
5. Languages: OneSignal picks the push text by device language. The server always sends English (`en`) and Urdu (`ur`) headings and contents; nothing to configure.

### 6. Copy the App ID and create the REST API key

1. Settings > **Keys & IDs**. Copy the **OneSignal App ID** (a UUID). It is public. Save it in 1Password as "prod ONESIGNAL_APP_ID" (or "staging ...", "dev ...").
2. Same page > **App API keys** (or "REST API Key") > **Add key**, name `supabase-edge`. Copy it once. Save it in 1Password as "prod ONESIGNAL_REST_API_KEY".

The functions send `Authorization: Key <ONESIGNAL_REST_API_KEY>` to `https://api.onesignal.com`. That scheme works with the current App API keys. An old-style legacy key that expects `Basic` may be refused; create a new key if so.

### 7. Put the values in place

Function secrets on each Supabase project (method in [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md)): add `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` to the env file, then

```bash
supabase secrets set --project-ref <prod-ref> --env-file ./.env.functions.prod   # delete the file afterwards
```

EAS variable for the app, per environment ([eas-builds.md](eas-builds.md) step 3):

```bash
eas env:create --environment production --name EXPO_PUBLIC_ONESIGNAL_APP_ID --value <thuluth-prod-onesignal-app-id> --visibility plaintext
# --environment preview: the Thuluth Staging app id; --environment development: the Thuluth Dev app id
```

Then make a **new build**. Setting `EXPO_PUBLIC_ONESIGNAL_APP_ID` adds the OneSignal plugin, the push entitlement and the notification service extension, which are native changes; an OTA update cannot add them.

The function secret `ONESIGNAL_APP_ID` and the EAS variable `EXPO_PUBLIC_ONESIGNAL_APP_ID` of the same environment must be the **same** app id. If they differ, the server sends to an app the phones are not in, and every push comes back as `no_subscribers`.

### 8. Test push

1. Install the new build, sign in, and allow notifications when the app asks (it shows its own pre-prompt first).
2. OneSignal > Audience > **Subscriptions**: the device appears with External ID = your `users.id` (find it in Supabase > Authentication > Users).
3. Send a test from the dashboard: Messages > **New Push** > audience "Test Subscriptions" after adding the device under Audience > Subscriptions > the row > **Add to Test Subscriptions**. Or send through the API exactly as the server does:

```bash
export ONESIGNAL_REST_API_KEY=...   # from 1Password, never typed inline
curl -s https://api.onesignal.com/notifications?c=push \
  -H "Authorization: Key $ONESIGNAL_REST_API_KEY" -H 'content-type: application/json' \
  -d '{"app_id":"<onesignal-app-id>","target_channel":"push",
       "include_aliases":{"external_id":["<users.id>"]},
       "headings":{"en":"Test","ur":"Test"},"contents":{"en":"Thuluth test push","ur":"Thuluth test push"}}'
```

Expect a JSON body with a non-empty `"id"`, and the push on the phone within seconds. An empty `id` means no subscribed device has that external id.

4. Server path: turn on a hydration or meal reminder in the app for a time a few minutes ahead. After the time passes, check in the SQL editor:

```sql
select kind, status, sent_at, data->'dispatch'->>'reason' as reason
from public.notifications where user_id = '<users.id>' order by scheduled_for desc limit 5;
-- expect status 'sent' with a sent_at; 'failed' with a reason means see Troubleshooting
```

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| OneSignal App ID (per environment) | Supabase function secret | `ONESIGNAL_APP_ID` |
| OneSignal App ID (same value) | EAS env | `EXPO_PUBLIC_ONESIGNAL_APP_ID` |
| OneSignal App API key (per environment) | Supabase function secret | `ONESIGNAL_REST_API_KEY` |
| APNs `.p8`, Key ID, Team ID, bundle id | OneSignal app > Apple iOS platform | none in the repo |
| FCM service account JSON | OneSignal app > Google Android platform | none in the repo |

## Verify

- `supabase secrets list --project-ref <prod-ref>` lists `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY`.
- `eas env:list --environment production` shows `EXPO_PUBLIC_ONESIGNAL_APP_ID` with the same id as the function secret.
- Function logs (Supabase > Edge Functions > `notifications-dispatch` > Logs) no longer show `ONESIGNAL_REST_API_KEY or ONESIGNAL_APP_ID not set; pushes recorded as not sent`.
- The test push in step 8 arrives on one iPhone and one Android phone for each environment you set up.
- `health` stays `ok`: it reports stuck pushes, and the `push_lag` alert (`docs/ops/sentry-alerts.md` §3) stays quiet.

## Rotate or revoke

| Item | Cadence (secrets.md) | How |
|---|---|---|
| `ONESIGNAL_REST_API_KEY` | 180 days | Create a new App API key, set it on the function, wait for the next dispatch run (every minute) and check a `sent` row, then delete the old key in OneSignal |
| `ONESIGNAL_APP_ID` | never (identifier) | only changes if you recreate the app; then update the function secret, the EAS variable and make new builds |
| FCM service account key | yearly, or on suspicion | Firebase > Service accounts > generate a new key, upload it to the OneSignal app, send a test push, then delete the old key in Google Cloud > IAM > Service accounts > Keys |
| APNs key | on suspicion | see [apple-app-store.md](apple-app-store.md) "Rotate or revoke"; upload the new key to all three OneSignal apps |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `notifications.status = 'failed'`, reason `not_configured` | Function secrets missing on that project | Step 7; secrets apply on the next invocation |
| Reason `no_subscribers` | No device with that external id in this OneSignal app: notifications not allowed, app id mismatch between function secret and build, or the build has no OneSignal plugin | Check Audience > Subscriptions for the external id; compare the two app ids; rebuild with `EXPO_PUBLIC_ONESIGNAL_APP_ID` set |
| Reason `http_400` or `http_403` | Wrong or legacy REST key, or a key from another app | Create a new App API key for this app (step 6) |
| Android devices subscribe but never receive | FCM V1 API not enabled, or the service account is from another Firebase project | Step 1 point 3; re-upload the right JSON |
| iOS devices show "Unsubscribed" or "No push token" | Push Notifications missing on the App ID or provisioning profile, or wrong bundle id in OneSignal | [apple-app-store.md](apple-app-store.md) step 2; check the bundle id in step 3 |
| Suhoor and iftar reminders arrive silently on a focused iPhone | The build predates the Time Sensitive Notifications entitlement, the App ID lacks the capability, or the user turned off time-sensitive alerts for Thuluth | Install a current build; check the capability on the App ID ([apple-app-store.md](apple-app-store.md) step 2); nothing to set in OneSignal |
