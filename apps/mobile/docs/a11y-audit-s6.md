# Accessibility audit: Sprint 6 (S6-17) and pass 2 (S7-04)

Pass 2 (Sprint 7, WCAG 2.2 AA) is at the end of this file. The Sprint 6 pass follows unchanged,
except that the known gaps now link to their status in pass 2.

## Pass 1: Sprint 6

Scope: the screens added in Sprint 6, namely growth, picky eating, autism, exports, privacy and
deletion, help and support, insights, and report-a-source. This is a code-level pass against
08 §12 (WCAG 2.2 AA targets). It has not yet been run on a device with VoiceOver or TalkBack;
that check is listed under "Needs a device pass".

### What was checked and how it holds

| Check | Result |
| --- | --- |
| Touch targets of 44 pt or more | All new tappables are `Button`, `ChipGroup`, `Checkbox`, `NavRow` or picker rows, which use `min-h-control` (48 pt). Ladder cards and step-editor rows are full-width. |
| Role and label on every tappable | `NavRow`, ingredient-picker rows, ladder cards and module links all set `accessibilityRole="button"` and a label. Each module link names its member, e.g. "Growth for Zayd". Icon-only buttons such as "Remove link" and move up/down carry an `accessibilityLabel` that names the food or step. |
| Headings | Each screen title uses `accessibilityRole="header"`, and so do the section headings (steps, history, categories). |
| Charts | The growth chart is `accessible` with role `image` and a summary label: indicator, latest value, rounded percentile and trend. A table toggle (`growth.table-toggle`) is the non-visual alternative. Each week of the weekly acceptance bars has its own label giving the counts. |
| Colour is never the only signal | Growth status, alerts, export status and the deletion countdown all spell the state out in text. The dashed and solid percentile bands are labelled in the table view. |
| Forms | Inputs use the shared `Input`, which has a visible label, helper text and an error text announced with the field. The growth form shows units next to the value. The OTP code field sets `textContentType="oneTimeCode"`. |
| Selection state | The acceptance score picker is a `radiogroup` of `radio` items with `checked` and `selected` state. The chip groups expose `selected`. |
| Destructive actions | Delete account takes 3 taps from More and an email code. Cancelling has its own clearly labelled button. Removing a ladder, losing a safe food and moving a ladder step each ask for a native confirmation. |
| RTL | Lint bans physical left/right classes, so layouts mirror in Urdu. Ladder step numbers and percentages are formatted through i18next. |
| Dynamic type | No fixed heights on text containers. Long Urdu strings wrap. Screens scroll through `Screen`. |
| Child safety copy | No kcal, calorie or weight-target text appears on child screens. The growth and picky screen tests assert this. |
| Motion | No new animations. |

### Decisions made while building

- Every module link on Family now includes the member's name in its label, so links for different
  children are not read out identically.
- Removed the `accessibilityLiveRegion` prop from the shared `Text`, which does not support it.
  Status changes, such as an export becoming ready or a deletion being scheduled, render as new
  `InlineMessage` content instead.

### Known gaps (follow-up; status in pass 2)

1. **Countdown and export status are not announced.** Neither the deletion countdown nor export
   polling announces a change while the screen is open. Add `AccessibilityInfo.announceForAccessibility`
   when an export becomes ready or fails.
2. **Ladder step reordering needs labels checked on device.** Steps reorder with move up/down
   buttons, not drag and drop, which suits screen readers. Their labels still need checking on a
   device.
3. **Growth chart points are not individually focusable.** The table view is the accessible
   alternative. Design should confirm that this is acceptable.
4. **First-then board needs design review.** Its contrast and pictograms have not been reviewed
   yet (Design).

### Needs a device pass

- VoiceOver (iOS) and TalkBack (Android), in both English and Urdu, on these flows:
  - growth add;
  - picky log;
  - ladder create and move;
  - export share sheet;
  - delete and cancel;
  - help search;
  - report a source.
- Largest system font size on these screens: the growth add form, the delete account screen and
  the help article screen.

## Pass 2: Sprint 7 (S7-04)

Code-level pass over the whole app against 01 §9.3 (WCAG 2.2 AA) and 03 §6 (Sensory-calm). Still
no VoiceOver or TalkBack run: that is the device checklist at the end.

### Sprint 6 gaps

| Gap | Status |
| --- | --- |
| 1. Countdown and export status not announced | **Fixed.** `useAnnounceOnChange` (`src/hooks/use-announce.ts`) announces when deletion is scheduled, starts or is cancelled (`DeletionCountdownCard`). The exports screen announces each row that turns ready or failed while it is open ("Meal plan: Ready"). The first value is not announced; it is read with the screen. |
| 2. Ladder step move labels | Code unchanged (labels name the step and direction). Still needs the device check below. |
| 3. Growth chart points not focusable | Unchanged by design: the table view is the alternative. Design to confirm. |
| 4. First-then board contrast | Checked: its borders are `line-strong` (3.12:1 or more on `surface-raised` in all four themes) and `primary`; text is `ink`. Passes 1.4.11 and 1.4.3. Pictograms still need design review. |

### What pass 2 checked and changed

| Check (WCAG 2.2) | Result |
| --- | --- |
| Text contrast 1.4.3 and non-text contrast 1.4.11, all four themes (light, dark, calmLight, calmDark) | Computed from `@thuluth/config/tokens`: `ink`, `ink-muted`, `ink-subtle`, `primary`, `danger`, `success`, `warning` and `info` on `surface`, `surface-raised` and `surface-sunken` are all 4.5:1 or more; `on-*` pairs and `ink` on every `*-soft` fill pass; `focus` is 5:1 or more. One borderline value: in calmDark, `line-strong` on `surface-sunken` is 2.77:1. The input border is drawn on that fill, but the same border against the screen around it is 3.12:1 or more, so the input boundary still passes. Raise `line-strong` in calmDark at the next token change (Design; tokens are in packages/config). |
| Resize text 1.4.4 (200 percent) | **Fixed.** Text under 18 pt was capped at 1.6x (body, label, caption) or 1.4x (overline) by the type scale, so a user at 200 percent got 160 percent at most. `Text` now lets every style under 18 pt reach 2x (`fontScaleCap`). Headings, titles and display text keep their caps (they are already large text). This differs from 03 §5's `maxMultiplier` values: Design should update 03 and the tokens. Containers with text have no fixed heights. The fixed-height views found are bars and charts without text (`h-2`, `h-3`, `h-12`, `h-24`). |
| Target size 2.5.8 (24 px minimum; 01 §9.3 asks for 44 pt) | Buttons are 48 pt, or 36 pt with a 6 pt hit slop (48 pt). **Fixed:** the budget entry delete "×" (was glyph-sized, now 44 x 44 pt plus slop), the grocery item "Edit" link (now 44 pt high), the Today budget line (now 44 pt high), and the citation, follow-up and source chips (36 pt, now with a 4 pt slop, 44 pt). |
| Name, role, value 4.1.2 | **Fixed:** the chat sessions "Rename" and "Delete" buttons now name the chat ("Delete chat: Iron for Zayd"); the budget delete button names the category, amount and date; loading states are announced as a labelled busy progress element (`LoadingRow`) instead of an unlabeled spinner or silent gap. |
| Status messages 4.1.3 | Fixed through gap 1 above. Errors with retry use `ErrorRetry`: an `alert` followed by a "Try again" button. |
| Focus order and focus not obscured 2.4.3, 2.4.11 | Lists keep reading order: header, filters and messages come before rows in `ListScreen`, and the footer after. The tab bar and native headers sit outside the scroll views, so focused content is not covered. The chat composer is outside the message list. |
| Animation 2.3.3 and reduced motion (01 §9.3) | **Fixed.** There was no reduced-motion handling. `useReducedMotion` follows the OS setting and Sensory-calm mode. Under reduced motion, every stack and modal transition becomes a crossfade (`src/navigation/motion.ts`) and chat auto-scroll jumps instead of animating. No other animation exists. |
| Screen readers in Urdu (RTL) | **Fixed:** `Text` now sets `accessibilityLanguage="ur"` when the UI is in Urdu, so VoiceOver picks an Urdu voice even when the phone's language is English (Arabic scripture already set `ar`). Layout mirroring and reading order come from `I18nManager`; lint bans physical left/right classes. |
| Autism-friendly mode (01 §9.3, 03 §6) | **Fixed: there was no way to turn it on.** `sensoryCalm` and the calm palettes existed, but no screen set them. A Sensory-calm switch is now in More > Accessibility and on the autism hub (02 §7.10 asks for it to be offered there). It switches to the calm palette and forces reduced motion. Checked: the app plays no sounds and has no haptics; layouts do not change between modes; the autism screens have no timers or animation. Not done: the one-time suggestion sheet when the autism module is first enabled (02 §7.10), and the `sensory_calm_toggled` analytics event (not in the shared event catalog yet; backend). |
| Accessible authentication 3.3.8 | Unchanged from S6: the OTP field supports paste and one-time-code autofill. |

### Tests added

`src/app/__tests__/a11y-s7.test.tsx`: the 200 percent cap for every text style in both scripts,
Urdu `accessibilityLanguage`, Button disabled, busy and selected state and the small-button hit
slop, `LoadingRow` and `ErrorRetry` roles and labels, `ListScreen` title role, header, empty state
and virtualization, the Sensory-calm switch label, hint and store update, announcements on
change but not on mount, and crossfade transitions in Sensory-calm mode.

### Needs a device pass (pass 2)

- VoiceOver and TalkBack in English and Urdu, on: Today, meal detail, chat (streaming
  announcements, citations, follow-ups), chat sessions (rename, delete), grocery list, budget,
  exports (ready announcement), delete and cancel (announcements), the Sensory-calm switch, and the
  pass 1 flows above.
- Largest system text size (200 percent) in English and Urdu on: Today, meal cards, chat, grocery
  list detail, paywall, settings, and the pass 1 screens. Look for clipped or overlapping text now
  that small text grows to 2x. Nastaliq at 130 percent minimum.
- Reduced motion on (iOS and Android settings) and Sensory-calm on: transitions crossfade, no
  movement elsewhere.
- Switch Access (Android) and Full Keyboard Access (iOS) on the sign-in and Today screens.
