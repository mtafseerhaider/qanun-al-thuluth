# Reviewer demo account

The reviewer signs in with a password instead of an email code, which stores require. The app
shows a password field only for the exact address `reviewer@thuluth.app`
(`apps/mobile/src/features/auth/utils/email.ts`), and the server hook rejects password sign-in
for any other address (`11-authentication.md` §3.1.1).

**Never write the password in this repository, a ticket or chat.** It goes only into the stores'
review information fields and the team password manager.

## Setup (PO or backend, on `thuluth-prod`)

1. Create the auth user `reviewer@thuluth.app` with a long random password (password manager
   generated, 20+ characters).
2. Sign in once on a device and complete onboarding as a parent in Pakistan (country PK, city
   Lahore, currency PKR, language English).
3. Household "Review Family" with four members, all fictional:
   - Adult A (35), adult B (33), child (6), toddler (2).
   - The child has the picky eating module on; the toddler has the autism module on, so both
     modules can be reviewed.
   - Add two growth measurements for each child so the charts have points.
4. Generate a weekly plan and a grocery list; log one meal, two glasses of water and one fast so
   Today and the trackers show data.
5. Grant Premium with a RevenueCat promotional entitlement (`premium`, lifetime or 1 year) on the
   App User ID of this user. Do not use a sandbox purchase.
6. Leave Ramadan setup available but not completed, so the reviewer can see the setup flow.
7. Check the account on a production build: sign in, Today, chat with a source, photo analysis,
   growth chart, PDF export, delete account screen (do not confirm the deletion).

## Handover

| Store | Field |
| --- | --- |
| App Store Connect | App Review Information > Sign-in required > User name `reviewer@thuluth.app`, Password (from the password manager) |
| Play Console | App content > App access > "All or some functionality is restricted" > add instructions with the same user name and password |

Rotate the password after the app is approved and after any reviewer-reported issue.

## Placeholders to fill in

| Item | Value |
| --- | --- |
| Password | (password manager entry "Thuluth store reviewer") |
| RevenueCat promotional entitlement expiry | (PO) |
| Person who checked the account on a production build, and the date | (PO) |
