# Sprint 6 accessibility audit (S6-17)

Scope: the screens added in Sprint 6, namely growth, picky eating, autism, exports, privacy and
deletion, help and support, insights, and report-a-source. This is a code-level pass against
08 §12 (WCAG 2.2 AA targets). It has not yet been run on a device with VoiceOver or TalkBack;
that check is listed under "Needs a device pass".

## What was checked and how it holds

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

## Decisions made while building

- Every module link on Family now includes the member's name in its label, so links for different
  children are not read out identically.
- Removed the `accessibilityLiveRegion` prop from the shared `Text`, which does not support it.
  Status changes, such as an export becoming ready or a deletion being scheduled, render as new
  `InlineMessage` content instead.

## Known gaps (follow-up)

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

## Needs a device pass

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
