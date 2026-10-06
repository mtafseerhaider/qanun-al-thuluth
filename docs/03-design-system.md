# 03 · Design System

> **Status:** Draft for implementation (v1 / MVP) · **Owner:** Product design (Tafseer, product owner) with the mobile platform team · **Related:** `00-foundations.md` (canonical names, locales, safety), `02-ux-specification.md` (screens and flows), `07-react-native-folder-structure.md` (file locations), `08-component-architecture.md` (component contracts, NativeWind theming mechanics), `09-state-management.md` (`usePreferencesStore`), `13-islamic-knowledge-module.md` (citation content), `21-testing-strategy.md` (visual and accessibility tests)
>
> This document defines the visual language and the token values. `08-component-architecture.md` owns component prop contracts and file locations; this document repeats those props for design reference and adds visual states. If the two disagree on a prop, `08` wins; if they disagree on a colour, size or motion value, this document wins.

## Table of contents

1. [Design principles](#1-design-principles)
2. [Islamic-friendly visual language](#2-islamic-friendly-visual-language)
3. [Colour](#3-colour)
4. [Plate-method, data-visualisation and contrast verification](#4-plate-method-data-visualisation-and-contrast-verification)
5. [Typography](#5-typography)
6. [Sensory-calm mode](#6-sensory-calm-mode)
7. [Spacing, radius, elevation and layout](#7-spacing-radius-elevation-and-layout)
8. [Iconography, illustration and motion](#8-iconography-illustration-and-motion)
9. [Navigation chrome and layout patterns](#9-navigation-chrome-and-layout-patterns)
10. [Component library catalog](#10-component-library-catalog)
11. [Tokens as code: Tailwind preset, NativeWind and TypeScript](#11-tokens-as-code-tailwind-preset-nativewind-and-typescript)
12. [Dark mode strategy](#12-dark-mode-strategy)
13. [RTL rules](#13-rtl-rules)
14. [Accessibility](#14-accessibility)
15. [Reconciliation with 08 and proposed additions](#15-reconciliation-with-08-and-proposed-additions)

---

## 1. Design principles

| # | Principle | Design consequence |
|---|---|---|
| D1 | **Calm, warm, trustworthy** | A warm ivory canvas, deep teal primary and earthy secondaries. No neon, no pure black on pure white, generous whitespace. |
| D2 | **Faith expressed through craft, not decoration** | Islamic identity appears in proportion, geometry and calligraphic heritage (the Thuluth script), not in stock mosque or crescent clip-art. |
| D3 | **Information before ornament** | Patterns and illustrations never sit behind text that must be read; decorative layers are optional and removed in Sensory-calm mode. |
| D4 | **One family of shapes** | Rounded rectangles (radius scale §7.2), circles for people and rings, the plate circle for food. The "three thirds" motif recurs: three segments, three dots, three breaths. |
| D5 | **Colour carries meaning only with a second cue** | Every colour-coded element also has text, an icon or a pattern (WCAG 1.4.1). |
| D6 | **Bilingual by construction** | Every component is designed in English and Urdu (Nastaliq) at the same time; layouts flex vertically for Nastaliq's taller line boxes and mirror for RTL. |
| D7 | **Gentle feedback** | Success is quiet (a check and a short message), errors are clear but never alarming red walls, and food or body states never use danger colours. Danger colour is reserved for safety (allergy, red-flag escalation) and destructive actions. |
| D8 | **Accessible by default** | AA contrast in all four themes, 44pt minimum targets, dynamic type, reduced motion and screen reader parity are acceptance criteria, not polish. |

---

## 2. Islamic-friendly visual language

### 2.1 Logotype and app icon

- **Arabic mark:** the word ثُلُث written in the **Thuluth** calligraphic style, commissioned from a qualified calligrapher and vectorised (not a font rendering). The three dots of the letter ث (tha) are the brand's signature: they stand for the three thirds (food, drink, breath). In the mark, the dots may take the plate-veg, water and plate-space tones on special surfaces (the app icon); everywhere else the mark is monochrome.
- **Latin wordmark:** "Thuluth" set in Inter Display SemiBold with custom tracking (−1%), the "th" ligature-free, baseline aligned to the Arabic mark's x-height. Lock-ups: horizontal (Arabic mark at the logical start), stacked (Arabic above), and Arabic-only (app icon, splash).
- **App icon:** the ث mark in `#FBF8F2` on the primary teal `#1F6F5C`, three dots in `#D9A23A` (accent). No crescent, no text, no gradients. Android adaptive icon foreground keeps the mark within the 66dp safe zone; monochrome themed icon (Android 13+) uses the mark only.
- **Clear space:** the height of one ث dot cluster on all sides. Minimum size: 24pt for the mark, 72pt wide for the horizontal lock-up.
- **Component:** `ThuluthLogo` (props: `variant: 'mark' | 'horizontal' | 'stacked'`, `size: number`, `tone: 'brand' | 'ink' | 'inverse'`). Files: SVGs in `apps/mobile/assets/brand/` (see `07-react-native-folder-structure.md`).

### 2.2 Geometric patterns

- **Source geometry:** a family of three patterns built from simple, rule-based Islamic geometry: (a) an 8-fold star-and-cross tile (*khatam*-style), (b) a 6-fold hexagonal rosette, (c) a "three-way" tessellation built on a 3-fold grid that echoes the thirds. All drawn as single-weight line art (1pt at 1x), never filled, never multicoloured.
- **Usage (subtle only):** splash background, onboarding headers, empty-state backdrops, paywall header, export PDF covers, and the Ramadan planner header. Opacity 4 to 6 percent in light mode (`ink` colour), 6 to 8 percent in dark mode; never behind body text; never animated.
- **Removed** entirely in Sensory-calm mode and when the user enables "Reduce visual detail" (which Sensory-calm implies).
- **Component:** `GeometricPattern` (props: `pattern: 'star8' | 'rosette6' | 'thirds3'`, `opacity?: number` default 0.05, `tone?: 'ink' | 'primary' | 'accent'`, `fade?: 'none' | 'bottom' | 'radial'`). Rendered as a tiled SVG via `react-native-svg` `Pattern`; `accessibilityElementsHidden` always.

### 2.3 Imagery and illustration rules (hard rules)

1. **No depictions of faces** in any illustration, icon, avatar preset, onboarding art or marketing asset inside the app. People are shown as hands (serving, sharing, washing), as figures from behind at a distance only when essential, or not at all. Preferred subjects: food, tableware, a sufra cloth seen from above, plants, water, light.
2. **Modesty:** where hands or arms appear, sleeves reach the wrist. No body-shape imagery, no scales, no measuring tapes around bodies, no before/after.
3. **Halal food only** in imagery: no pork, no alcohol, no wine glasses or bottles that read as alcohol. Drinks are water, milk, laban, tea, fresh juice.
4. **Children's contexts** (growth, picky eating, autism) use growth metaphors (a sprouting plant, a young tree, a height chart on a door frame drawn without a child) and food play (shapes, colours), never a child's body.
5. **Crescent only where meaningful:** Ramadan planner, Hijri date contexts, Eid content, fasting tracker. Never as a generic "Islamic" decoration and never on the logo, tab bar or paywall. Stars appear only inside geometric patterns.
6. **No mosques, Kaaba or Qur'an book imagery as decoration.** Qur'anic text is never placed on backgrounds that could be stepped on, discarded or treated casually (for example it is never inside a food photo, never in a toast, never in a notification image). When shown, it sits in a dedicated `QuoteCard` with its citation.
7. **Real food photography** (recipes) follows: overhead or 45-degree angle, natural light, regional dishes plated as eaten (roti, daal, salan, raita), no hands with nail polish or jewellery close-ups, no faces in background. AI-generated recipe images are not used in v1; recipes without photos use `GeometricPlaceholder` with the dish's dominant colour.
8. **Style:** flat vector with soft grain, 2 to 3 token colours plus `ink` line at 1.5pt, rounded joins. Illustrations are SVG (`react-native-svg`), stored in `apps/mobile/assets/illustrations/` with names matching `EmptyState.illustration` values (`plate`, `water`, `family`, `grocery`, `chat`, `growth`, `moon`) plus `sufra_overhead`, `bell_tile`, `sprout`.
9. **Colour use in illustrations** comes from tokens so they adapt to dark mode and Sensory-calm mode (illustrations take a `palette` prop resolved from the current theme).

### 2.4 Calligraphy and scripture display

- Qur'anic verses: Amiri Quran (§5.4), centred in a `QuoteCard variant="quran"` with a hairline border in `line`, citation "Al-A'raf 7:31" below in the UI language, translation in the UI language under it. Verse-end marker ۝ with the ayah number in Arabic-Indic digits is part of the Arabic string.
- Hadith and Imam narrations: Amiri (regular) in `QuoteCard variant="hadith"`, with `SourceCitationChip` and grade.
- Honorifics: ﷺ uses the font glyph (U+FDFA) in Arabic contexts and in short UI strings; long English prose uses "peace be upon him" in full.

---

## 3. Colour

### 3.1 Palette rationale

| Role | Name | Light hex | Meaning |
|---|---|---|---|
| Primary | **Sidr teal** | `#1F6F5C` | Calm, natural, associated with gardens and growth; distinct from "Islamic green" cliché while staying in the family. |
| Secondary | **Clay** | `#8A4F2E` | Earthenware, home cooking, warmth. Used for secondary buttons and the Ramadan accent. |
| Accent | **Saffron** | `#D9A23A` | Celebration and barakah; decorative fills, the logo dots, premium badge. Never used for text on light backgrounds (use `accent-ink`). |
| Canvas | **Ivory** | `#FBF8F2` | Warm paper; reduces glare compared to pure white. |
| Ink | **Charcoal green** | `#1D2521` | Softer than black, harmonises with the teal. |

### 3.2 Brand ramps (for illustration and charts; UI uses semantic tokens only)

| Step | Teal | Clay | Saffron | Neutral (warm grey) |
|---|---|---|---|---|
| 50 | `#E9F5F1` | `#F8EEE8` | `#FBF3E2` | `#FBF8F2` |
| 100 | `#CDE8DF` | `#EFD9CC` | `#F6E4BE` | `#F3EEE4` |
| 200 | `#A3D5C4` | `#E2BBA4` | `#EFD08F` | `#E6E0D3` |
| 300 | `#6FBBA3` | `#CF9673` | `#E6B95E` | `#CFC8BB` |
| 400 | `#3F9A80` | `#B06F4B` | `#D9A23A` | `#A39D92` |
| 500 | `#2A8069` | `#9A5D3A` | `#BF8A26` | `#858D87` |
| 600 | `#1F6F5C` | `#8A4F2E` | `#9E701B` | `#636E68` |
| 700 | `#175546` | `#6E3E24` | `#8A5F12` | `#4A5650` |
| 800 | `#103D33` | `#522E1B` | `#614310` | `#2F3833` |
| 900 | `#0A2720` | `#371F12` | `#3D2A0A` | `#1D2521` |

### 3.3 Semantic tokens (all four themes)

Token names are the ones used by `08-component-architecture.md` §10.1 (`surface`, `surface-raised`, `ink`, `ink-muted`, `line`, `primary`, `on-primary`, `success`, `warning`, `danger`, `info`, `plate-veg`, `plate-protein`, `plate-carb`, `water`) plus the additions marked in §15. Tailwind classes are `bg-<token>`, `text-<token>`, `border-<token>`.

| Token | Light | Dark | Calm light | Calm dark |
|---|---|---|---|---|
| `surface` | `#FBF8F2` | `#0F1513` | `#F4F3EF` | `#1A1F1D` |
| `surface-raised` | `#FFFFFF` | `#18201D` | `#FAF9F6` | `#222826` |
| `surface-sunken` | `#F3EEE4` | `#212B27` | `#ECEAE4` | `#2A312E` |
| `ink` | `#1D2521` | `#ECEFEA` | `#2A302D` | `#DCDFDB` |
| `ink-muted` | `#4A5650` | `#B4BEB8` | `#535B57` | `#A9B0AC` |
| `ink-subtle` | `#636E68` | `#8D9892` | `#646B67` | `#969D99` |
| `line` | `#DDD5C7` | `#2C3632` | `#E1DFD8` | `#333A37` |
| `line-strong` | `#7F8781` | `#6E7A74` | `#80867F` | `#6C7470` |
| `primary` | `#1F6F5C` | `#5CC3A6` | `#4F6F66` | `#8FB3A8` |
| `primary-pressed` | `#175546` | `#7DD3BA` | `#3E5A52` | `#A6C4BB` |
| `on-primary` | `#FFFFFF` | `#08201A` | `#FFFFFF` | `#12201B` |
| `primary-soft` | `#E3F1EC` | `#163A31` | `#E4EBE8` | `#2C3B36` |
| `on-primary-soft` | `#145043` | `#A8E3D1` | `#3E5A52` | `#B9D0C9` |
| `secondary` | `#8A4F2E` | `#E39A72` | `#7A5E4E` | `#C4A190` |
| `on-secondary` | `#FFFFFF` | `#2A1307` | `#FFFFFF` | `#24170F` |
| `accent` | `#D9A23A` | `#E8B65A` | `#C9B48E` | `#BFAE8C` |
| `on-accent` | `#2B1E05` | `#2B1E05` | `#2A241A` | `#24200F` |
| `accent-ink` | `#8A5F12` | `#E8B65A` | `#6E5F45` | `#BFAE8C` |
| `success` | `#256B42` | `#6CCB8E` | `#456E53` | `#93BFA0` |
| `on-success` | `#FFFFFF` | `#0B2615` | `#FFFFFF` | `#14231A` |
| `success-soft` | `#E3F3E8` | `#13301F` | `#E5EDE7` | `#25332A` |
| `on-success-soft` | `#1E5A37` | `#A3E0B8` | `#3A5C45` | `#B5D4BE` |
| `warning` | `#8A5300` | `#F0B44C` | `#7D5A1E` | `#CDAE78` |
| `on-warning` | `#FFFFFF` | `#2E1E00` | `#FFFFFF` | `#261C08` |
| `warning-soft` | `#FFF1D6` | `#3A2C10` | `#F3ECDD` | `#37301F` |
| `on-warning-soft` | `#6B4100` | `#F6CD82` | `#634716` | `#DEC79E` |
| `danger` | `#B3362B` | `#F2877C` | `#9A4A40` | `#D9958C` |
| `on-danger` | `#FFFFFF` | `#2B0805` | `#FFFFFF` | `#2A0F0B` |
| `danger-soft` | `#FCE8E5` | `#3A1714` | `#F4E6E3` | `#3A2624` |
| `on-danger-soft` | `#8C2A22` | `#F7B0A8` | `#7E3B33` | `#E8B6AF` |
| `info` | `#2F6690` | `#7DB7E3` | `#4D6B82` | `#93AFC4` |
| `on-info` | `#FFFFFF` | `#0A1F30` | `#FFFFFF` | `#111D26` |
| `info-soft` | `#E3EEF7` | `#142B3D` | `#E5ECF1` | `#25313A` |
| `on-info-soft` | `#234D6D` | `#A9D1F0` | `#3D576B` | `#B6CBDA` |
| `focus` | `#2F6690` | `#7DB7E3` | `#4D6B82` | `#93AFC4` |
| `plate-veg` | `#3F8A58` | `#6CBF85` | `#6E8F78` | `#86A890` |
| `plate-protein` | `#B4573F` | `#E58E74` | `#A07766` | `#B8917F` |
| `plate-carb` | `#B07A1C` | `#E2B456` | `#9A855A` | `#B5A277` |
| `water` | `#2F7DB3` | `#6CB2E6` | `#6A8BA3` | `#8AA7BC` |
| `plate-space` | `#E6E0D3` | `#3A443F` | `#E4E1DA` | `#3A403D` |

### 3.4 Usage rules

| Token | Use for | Never use for |
|---|---|---|
| `surface` | Screen background (canvas) | Cards that need separation (use `surface-raised`) |
| `surface-raised` | Cards, sheets, tab bar, headers | Full-screen backgrounds |
| `surface-sunken` | Inputs, search bars, segmented control track, code-like panels, skeleton fill | Text-heavy content blocks |
| `ink` | Body and heading text, primary icons | |
| `ink-muted` | Secondary text, labels, helper text | Primary actions |
| `ink-subtle` | Captions, timestamps, placeholders, disabled text (disabled controls also lower opacity to 0.5 on the container, and disabled text is exempt from contrast rules per WCAG, but we keep it at AA anyway) | Anything the user must read to proceed |
| `line` | Decorative dividers and card hairlines | Input boundaries or any boundary needed to identify a control |
| `line-strong` | Input borders, checkbox and radio outlines, chart axes, `plate-space` outline (3:1 non-text contrast) | Large fills |
| `primary` / `on-primary` | Primary buttons, active tab, selected chips, links, progress | Large background areas (more than about 20 percent of a screen) |
| `primary-soft` / `on-primary-soft` | Selected list rows, info-like brand callouts, chip selected fill in calm mode | Text on canvas |
| `secondary` / `on-secondary` | Secondary filled buttons (rare), Ramadan and seasonal accents | Errors |
| `accent` / `on-accent` | Premium badge, logo dots, celebratory highlights (non-text fills) | Text on light surfaces (use `accent-ink`) |
| `accent-ink` | Accent-coloured text such as "Premium" labels on canvas | |
| `success` | Completion checks, "on track" budget text | Food judgements ("good food") |
| `warning` | Budget 85 to 100 percent, soft growth "watch" notices, unsynced data | Food or body judgements |
| `danger` | Safety banners (allergy, red-flag escalation), destructive buttons, form errors, budget over 100 percent | Skipped meals, refused foods, any child body metric |
| `info` | Tips, neutral notices, citations | |
| `focus` | Focus rings (2pt) for keyboard and switch control users | |
| `water` | Hydration ring, fluid third, water reminders | Links (avoid confusion with info) |

### 3.5 Special colour rules for gentle UX

- Meal statuses use neutral colouring: `eaten` = `success` check icon, `partly_eaten` = `ink-muted` half-filled circle, `skipped` = `ink-subtle` dash, `swapped` = `info` swap arrows. No red.
- Acceptance scores use a single-hue sequential teal ramp (50 → 600) plus icon and word, never a red-to-green scale.
- Growth status: steady = `success` text with sprout icon; watch = `warning` with info icon; red flag = `danger-soft` banner with `on-danger-soft` text and an explicit "Talk to your doctor" action. Charts never colour the child's own line red.

---

## 4. Plate-method, data-visualisation and contrast verification

### 4.1 Plate-method colours and patterns

The plate method and the Thuluth thirds are the most-used visuals in the product. Each segment has a colour, a pattern and a label so the visual works in greyscale, for colour-blind users and in Sensory-calm mode.

| Segment | Token | Light | Dark | Pattern (second cue) | Icon | Label en / ur |
|---|---|---|---|---|---|---|
| Vegetables and fruit (½) | `plate-veg` | `#3F8A58` | `#6CBF85` | Diagonal hatch 45° | leaf | Vegetables and fruit / سبزیاں اور پھل |
| Protein (¼) | `plate-protein` | `#B4573F` | `#E58E74` | Dots | egg / bean | Protein / پروٹین |
| Whole grains (¼) | `plate-carb` | `#B07A1C` | `#E2B456` | Horizontal lines | wheat | Whole grains / اناج |
| Fluid (Thuluth third) | `water` | `#2F7DB3` | `#6CB2E6` | Waves | glass | Drink / پانی |
| Space / breath (Thuluth third) | `plate-space` | `#E6E0D3` | `#3A443F` | Empty with dashed `line-strong` outline | wind (three curved lines) | Breath / سانس |

Rules: `plate-space` is intentionally low-contrast as a fill; its boundary is a 1.5pt dashed `line-strong` stroke (3:1 or better in all themes). Patterns are drawn in `surface-raised` at 35 percent opacity over the fill; they can be disabled in Sensory-calm mode only if labels are on (labels are then forced on).

### 4.2 Chart palette

| Purpose | Tokens / values |
|---|---|
| Categorical (up to 5 series, e.g. budget categories) | `primary`, `secondary`, `water`, `plate-carb`, `ink-muted`; additional categories fall into "Other" |
| Sequential (acceptance 0 to 5, heat) | Teal ramp 50, 100, 200, 300, 500, 700 (light) and the reversed dark ramp; always paired with labels |
| Growth percentile bands | Bands between percentile curves filled with `primary-soft` at 30 to 60 percent opacity alternating; 50th percentile curve 1.5pt `ink-muted`; 3rd and 97th curves 1pt dashed `line-strong`; child's line 2.5pt `primary` with 6pt point markers (`surface-raised` fill, `primary` stroke) |
| Budget | Spent `primary`; projected `primary` at 40 percent with diagonal hatch; over-budget segment `danger` with label |
| Targets and references | 1pt dashed `ink-subtle` |

Charts follow the conventions in `08-component-architecture.md` §10.3: time runs left to right in both LTR and RTL, legends and axis labels move to logical positions.

### 4.3 Contrast verification (WCAG 2.2 AA)

Computed with the WCAG relative-luminance formula for every foreground/background pair that ships. Text pairs need 4.5:1 (normal text); non-text graphics (input borders, focus rings, chart marks, plate segments) need 3:1. All pairs pass in all four themes. CI re-runs this check from `packages/config/src/tokens.ts` (`pnpm --filter @thuluth/config test:contrast`, script in §11.6) so a token change cannot silently break contrast.

| Pair (foreground on background) | Required | Light | Dark | Calm light | Calm dark |
|---|---|---|---|---|---|
| `ink` on `surface` | 4.5:1 | 14.80 | 15.92 | 12.13 | 12.42 |
| `ink` on `surface-raised` | 4.5:1 | 15.69 | 14.33 | 12.79 | 11.16 |
| `ink` on `surface-sunken` | 4.5:1 | 13.56 | 12.57 | 11.20 | 9.90 |
| `ink-muted` on `surface` | 4.5:1 | 7.24 | 9.67 | 6.30 | 7.55 |
| `ink-muted` on `surface-raised` | 4.5:1 | 7.67 | 8.71 | 6.64 | 6.78 |
| `ink-muted` on `surface-sunken` | 4.5:1 | 6.63 | 7.64 | 5.82 | 6.02 |
| `ink-subtle` on `surface` | 4.5:1 | 5.00 | 6.19 | 4.92 | 6.03 |
| `ink-subtle` on `surface-raised` | 4.5:1 | 5.30 | 5.57 | 5.19 | 5.42 |
| `ink-subtle` on `surface-sunken` | 4.5:1 | 4.59 | 4.89 | 4.54 | 4.81 |
| `primary` on `surface` | 4.5:1 | 5.68 | 8.63 | 4.98 | 7.30 |
| `primary` on `surface-raised` | 4.5:1 | 6.02 | 7.77 | 5.25 | 6.56 |
| `primary` on `surface-sunken` | 4.5:1 | 5.21 | 6.82 | 4.60 | 5.82 |
| `accent-ink` on `surface` | 4.5:1 | 5.32 | 9.91 | 5.59 | 7.67 |
| `accent-ink` on `surface-raised` | 4.5:1 | 5.64 | 8.92 | 5.89 | 6.89 |
| `accent-ink` on `surface-sunken` | 4.5:1 | 4.87 | 7.83 | 5.16 | 6.12 |
| `success` on `surface` | 4.5:1 | 6.08 | 9.30 | 5.24 | 8.11 |
| `success` on `surface-raised` | 4.5:1 | 6.44 | 8.37 | 5.53 | 7.29 |
| `success` on `surface-sunken` | 4.5:1 | 5.57 | 7.34 | 4.84 | 6.47 |
| `warning` on `surface` | 4.5:1 | 5.97 | 9.97 | 5.64 | 7.89 |
| `warning` on `surface-raised` | 4.5:1 | 6.33 | 8.98 | 5.95 | 7.09 |
| `warning` on `surface-sunken` | 4.5:1 | 5.47 | 7.88 | 5.21 | 6.29 |
| `danger` on `surface` | 4.5:1 | 5.69 | 7.50 | 5.52 | 6.86 |
| `danger` on `surface-raised` | 4.5:1 | 6.04 | 6.75 | 5.82 | 6.16 |
| `danger` on `surface-sunken` | 4.5:1 | 5.22 | 5.93 | 5.09 | 5.47 |
| `info` on `surface` | 4.5:1 | 5.79 | 8.58 | 5.06 | 7.29 |
| `info` on `surface-raised` | 4.5:1 | 6.13 | 7.72 | 5.33 | 6.55 |
| `info` on `surface-sunken` | 4.5:1 | 5.30 | 6.78 | 4.67 | 5.81 |
| `on-primary` on `primary-pressed` | 4.5:1 | 8.66 | 9.66 | 7.53 | 9.00 |
| `on-primary` on `primary` | 4.5:1 | 6.02 | 7.97 | 5.53 | 7.36 |
| `on-secondary` on `secondary` | 4.5:1 | 6.48 | 7.64 | 5.93 | 7.35 |
| `on-accent` on `accent` | 4.5:1 | 7.11 | 8.73 | 7.62 | 7.49 |
| `on-success` on `success` | 4.5:1 | 6.44 | 8.12 | 5.82 | 7.94 |
| `on-warning` on `warning` | 4.5:1 | 6.33 | 8.71 | 6.26 | 7.92 |
| `on-danger` on `danger` | 4.5:1 | 6.04 | 7.49 | 6.13 | 7.36 |
| `on-info` on `info` | 4.5:1 | 6.13 | 7.79 | 5.61 | 7.47 |
| `on-primary-soft` on `primary-soft` | 4.5:1 | 8.00 | 8.66 | 6.22 | 7.24 |
| `on-success-soft` on `success-soft` | 4.5:1 | 7.09 | 9.46 | 6.29 | 8.28 |
| `on-warning-soft` on `warning-soft` | 4.5:1 | 7.90 | 9.03 | 7.31 | 7.96 |
| `on-danger-soft` on `danger-soft` | 4.5:1 | 7.21 | 8.94 | 6.75 | 7.92 |
| `on-info-soft` on `info-soft` | 4.5:1 | 7.58 | 9.06 | 6.34 | 7.94 |
| `line-strong` on `surface-raised` | 3.0:1 | 3.69 | 3.72 | 3.54 | 3.12 |
| `line-strong` on `surface` | 3.0:1 | 3.48 | 4.13 | 3.36 | 3.47 |
| `focus` on `surface-raised` | 3.0:1 | 6.13 | 7.72 | 5.33 | 6.55 |
| `focus` on `surface` | 3.0:1 | 5.79 | 8.58 | 5.06 | 7.29 |
| `plate-veg` on `surface-raised` | 3.0:1 | 4.21 | 7.46 | 3.40 | 5.73 |
| `plate-veg` on `surface` | 3.0:1 | 3.97 | 8.29 | 3.23 | 6.37 |
| `plate-protein` on `surface-raised` | 3.0:1 | 4.80 | 6.69 | 3.75 | 5.28 |
| `plate-protein` on `surface` | 3.0:1 | 4.53 | 7.43 | 3.55 | 5.88 |
| `plate-carb` on `surface-raised` | 3.0:1 | 3.72 | 8.63 | 3.39 | 6.00 |
| `plate-carb` on `surface` | 3.0:1 | 3.51 | 9.58 | 3.22 | 6.68 |
| `water` on `surface-raised` | 3.0:1 | 4.46 | 7.24 | 3.42 | 5.96 |
| `water` on `surface` | 3.0:1 | 4.21 | 8.05 | 3.24 | 6.63 |

Notes:

- `plate-space` and `line` are decorative fills and are not required to meet 3:1; they always carry a `line-strong` outline or adjacent label.
- White text on `accent` is not allowed (fails); use `on-accent` (dark).
- Text on images (recipe heroes) uses a `surface-raised` scrim at 85 percent behind the text, never text directly on photography.

---

## 5. Typography

### 5.1 Families

| Script / use | Family | Weights shipped | Licence | Tailwind family key | Notes |
|---|---|---|---|---|---|
| Latin UI (en, later fr, tr, ms, id) | **Inter** (static TTFs; Inter Display for sizes 24pt and above) | 400, 500, 600, 700 | SIL OFL 1.1 | `font-ui` (with weight-specific keys, §11) | Tabular figures (`fontVariant: ['tabular-nums']`) for prices, timers and quantities |
| Urdu UI (`ur`) | **Noto Nastaliq Urdu** | 400, 700 | SIL OFL 1.1 | `font-urdu` | Nastaliq is the expected script for Urdu readers; Naskh fallback is not used for UI |
| Qur'anic text | **Amiri Quran** | 400 | SIL OFL 1.1 | `font-quran` | Designed for full tashkeel and Qur'anic marks; used for `quran_references.arabic_text` only |
| Hadith and narrations (Arabic) | **Amiri** | 400, 700 | SIL OFL 1.1 | `font-arabic` | `hadith_references.arabic_text`, `imam_narrations.arabic_text`, du'a |
| Optional Qur'an alternative | KFGQPC Uthmanic Script Hafs | 400 | King Fahd Complex terms: free to use, redistribution conditions apply | (not shipped in v1) | Requires legal review of the redistribution terms before bundling; Amiri Quran is the v1 default |
| Phase 2 Arabic UI (`ar`) | Noto Naskh Arabic | 400, 600, 700 | SIL OFL 1.1 | `font-naskh` | Arabic UI uses Naskh, not Nastaliq |

Fonts are bundled with `expo-font` (config plugin) so they are available before first render; the splash is held until they load (see `02-ux-specification.md` §7.1.1). Font family names must match the PostScript names on both platforms: `Inter-Regular`, `Inter-Medium`, `Inter-SemiBold`, `Inter-Bold`, `InterDisplay-SemiBold`, `NotoNastaliqUrdu-Regular`, `NotoNastaliqUrdu-Bold`, `AmiriQuran-Regular`, `Amiri-Regular`, `Amiri-Bold`. On Android, React Native does not synthesise weights for custom fonts, so each weight is a separate family key.

### 5.2 Type scale tokens

The `Text` primitive's `variant` values (`08-component-architecture.md` §4.2) map to these tokens. Sizes are in points (dp on Android) at the default content size; they scale with the OS text size up to the `maxFontSizeMultiplier` in the last column.

| Variant | Latin size / line height | Latin weight | Urdu size / line height | Urdu weight | Letter spacing (Latin) | Max multiplier | Typical use |
|---|---|---|---|---|---|---|---|
| `display` | 32 / 40 | 600 (Inter Display) | 30 / 60 | 700 | −0.5 | 1.3 | Onboarding titles, big numbers |
| `title` | 24 / 32 | 600 (Inter Display) | 23 / 46 | 700 | −0.25 | 1.4 | Screen titles |
| `heading` | 18 / 26 | 600 | 18 / 38 | 700 | 0 | 1.5 | Section headers, card titles |
| `body` | 16 / 24 | 400 | 16 / 34 | 400 | 0 | 1.6 | Paragraphs, list items |
| `bodyStrong` | 16 / 24 | 600 | 16 / 34 | 700 | 0 | 1.6 | Emphasis, values |
| `label` | 14 / 20 | 500 | 14 / 30 | 400 | 0.1 | 1.6 | Buttons, chips, form labels |
| `caption` | 13 / 18 | 400 | 13 / 28 | 400 | 0.1 | 1.6 | Helper text, timestamps |
| `overline` | 12 / 16 | 600, uppercase | 13 / 28 | 700, no case change | 0.6 | 1.4 | Section eyebrows (Latin only uses uppercase) |

Additional script tokens (used through `Text script="arabic"` and `QuoteCard`):

| Token | Size / line height | Family | Use |
|---|---|---|---|
| `quran-lg` | 26 / 56 | Amiri Quran | Featured ayah (onboarding, source sheet) |
| `quran-md` | 22 / 48 | Amiri Quran | Inline ayah in chat and cards |
| `arabic-md` | 20 / 40 | Amiri | Hadith and narration Arabic |
| `arabic-sm` | 17 / 34 | Amiri | Du'a chips, short phrases (minimum size for Arabic with tashkeel) |

### 5.3 Urdu (Noto Nastaliq Urdu) rules and vertical metrics

Nastaliq is a diagonal, stacked script: words descend from upper right to lower left, and the font's ascender plus descender span is roughly twice that of Inter at the same point size. Clipping is the most common Urdu UI bug; these rules prevent it.

1. **Line height:** use the Urdu line heights in §5.2 (about 2.0 to 2.2 times the font size). Never set Urdu `lineHeight` below 1.8 times the font size.
2. **No fixed heights on text containers.** Buttons, chips, list rows, tab labels and inputs size to content with `minHeight` (for example button `minHeight: 48`, Urdu buttons resolve to about 56). Single-line Urdu inputs get `minHeight: 56` and `paddingVertical: 10`.
3. **Android font padding:** keep `includeFontPadding` at its default `true` for Nastaliq (it contains the tall glyph extents) and set it to `false` for Inter (for tight Latin metrics). The `Text` primitive switches this by script.
4. **Vertical centering:** Nastaliq glyphs sit visually high in the line box; add `paddingTop: 2` on Urdu single-line labels inside fixed-height-looking controls (chips, tabs) and verify with screenshot tests.
5. **Truncation:** `numberOfLines` truncation in Nastaliq can clip descenders of the last line on Android; allow one extra line for Urdu (`numberOfLines={n + 1}` for n ≤ 2) or use `adjustsFontSizeToFit` only for numbers, never for Urdu words.
6. **Size:** Nastaliq looks smaller than Inter at the same size; we keep sizes equal to Latin for body and label (users are used to this), but never go below 13pt for Urdu.
7. **Mixed script:** English brand names and numbers inside Urdu strings are wrapped in Unicode isolates (FSI U+2068 … PDI U+2069) by the i18n formatter to prevent bidi reordering; the `Text` primitive does not need per-run font switching because Noto Nastaliq Urdu includes Latin digits, but Latin words fall back to the system font, which is acceptable.
8. **Kashida and justification:** never justify Urdu text (`textAlign: 'justify'` is banned in lint for Urdu); align to start.
9. **Letter spacing** is always 0 for Nastaliq and Arabic (spacing breaks joining).
10. **Testing:** every screen has Urdu screenshot tests at default and 200 percent text size on iOS and Android (`21-testing-strategy.md`).

### 5.4 Arabic Qur'anic and narration text

- Always rendered with `writingDirection: 'rtl'`, `textAlign: 'center'` for featured verses and `'right'` (physical, intentionally) for inline Arabic inside LTR English layouts, using the `Text script="arabic"` path (`08-component-architecture.md` §4.2).
- Minimum 17pt with tashkeel; line height at least 2.0 times font size so harakat above and below do not collide.
- The Arabic string is rendered exactly as stored (never reshaped, transliterated or truncated). If it is long, the card expands; "Show more" collapses only the translation, never the Arabic.
- `accessibilityLanguage="ar"` on Arabic runs; the translation follows as a separate element so screen readers read both in the right voice.
- Translation text uses the UI font and the UI direction; translator attribution (`quran_references.translator`) appears in `caption`.

### 5.5 Numerals, units and dates

- Western digits (0 to 9) in both `en` and `ur` in v1 (decision recorded in `08-component-architecture.md` §10.3). Qur'anic ayah markers inside Arabic text keep Arabic-Indic digits as stored.
- Number and currency formatting via `Intl.NumberFormat(locale, { style: 'currency', currency })` with `currencyDisplay: 'narrowSymbol'` (PKR shows "Rs" in en-PK; Urdu shows "روپے" suffix through i18n templates since `ur` formatting of PKR differs by engine; the formatter is in `packages/shared/src/format/money.ts`).
- Quantities, prices, times and phone numbers are LTR isolates inside RTL text.
- Grouping for Pakistani users follows `en-PK`/`ur-PK` lakh grouping only if the engine supports it; otherwise Western grouping (1,250,000). Both are acceptable; consistency within a screen is required.
- Hijri dates render with `Intl.DateTimeFormat(locale + '-u-ca-islamic-umalqura')` plus the user offset (Settings > Faith).

---

## 6. Sensory-calm mode

Sensory-calm mode serves autistic children and adults, parents with sensory sensitivities, migraine sufferers and anyone who prefers a quieter interface. It is suggested once when the autism module is enabled and is always available in Settings > Accessibility (`usePreferencesStore.sensoryCalm`). It is device-level, not account-level.

| Dimension | Default | Sensory-calm |
|---|---|---|
| Palette | Standard light/dark tokens | Calm light / calm dark tokens (§3.3): lower saturation, narrower luminance range, no saffron gold, softer danger |
| Decorative patterns | 4 to 8 percent opacity in a few places | Removed everywhere |
| Illustrations | Full colour (3 tokens) | Monotone (`ink-muted` line + `surface-sunken` fill), or hidden in dense screens |
| Motion | Short transitions (§8.3) | Reduced motion forced on regardless of OS: crossfades of 120 ms max, no springs, no parallax, no shimmer, progress bars step instead of animate |
| Haptics | Selection and success haptics | Off |
| Sounds | Optional timer chime | Off; timers use visual and vibration-free notification only |
| Celebrations | Quiet check animation | Static check, text only |
| Layout | Some carousels | Carousels become vertical lists; tips do not rotate automatically |
| Density | Standard | Spacing +4pt between list rows, max 1 accent colour per screen |
| Notifications | As configured | Same, with "gentle" copy variants and no badges on the tab bar except safety |
| Plate and charts | Patterns + colour | Labels forced on; patterns may be hidden (reduces visual noise) |

Implementation: the calm palette swaps CSS variables (§11.5); behavioural changes read `usePreferencesStore(s => s.sensoryCalm)` through `useMotionPreference()` and `useHaptics()` hooks so components never check the flag ad hoc.

---

## 7. Spacing, radius, elevation and layout

### 7.1 Spacing scale (4pt base)

Defined in pixels in the preset (NativeWind's default `rem` is 14 on native, so we do not rely on rem-based spacing).

| Token | px | Tailwind | Typical use |
|---|---|---|---|
| `0` | 0 | `p-0` | |
| `0.5` | 2 | `p-0.5` | Icon optical nudge |
| `1` | 4 | `p-1` | Chip icon gap |
| `2` | 8 | `p-2` | Inline gaps, tight stacks |
| `3` | 12 | `p-3` | Chip padding, list row vertical |
| `4` | 16 | `p-4` | **Screen gutter**, card padding |
| `5` | 20 | `p-5` | Card padding (large) |
| `6` | 24 | `p-6` | Section spacing |
| `8` | 32 | `p-8` | Between major regions |
| `10` | 40 | `p-10` | Hero spacing |
| `12` | 48 | `p-12` | Minimum touch height reference |
| `16` | 64 | `p-16` | Empty-state top offset |

Layout rules: screen side gutter 16 (20 on screens 414pt wide and up; 24 on tablets); vertical rhythm between sections 24; cards in a list separated by 12; content max width 640 on tablets, centred.

### 7.2 Radius

| Token | px | Use |
|---|---|---|
| `rounded-none` | 0 | Full-bleed images |
| `rounded-sm` | 6 | Badges, small tags |
| `rounded-md` | 12 | Buttons, inputs, chips (chips may use `full`) |
| `rounded-lg` | 16 | Cards, meal cards, list groups |
| `rounded-xl` | 20 | Hero cards, paywall plan cards |
| `rounded-2xl` | 28 | Bottom sheet top corners |
| `rounded-full` | 9999 | Avatars, rings, pills, FAB |

### 7.3 Elevation

Light mode uses soft, warm-tinted shadows; dark mode replaces shadows with lighter surfaces (`surface-raised`, `surface-sunken`) and a 1px `line` border, because shadows are invisible on dark backgrounds.

| Level | Use | iOS shadow (color, opacity, radius, offset y) | Android `elevation` | Dark mode |
|---|---|---|---|---|
| 0 | Flat content | none | 0 | none |
| 1 | Cards | `#1D2521`, 0.06, 6, 2 | 1 | `surface-raised` + `line` border |
| 2 | Sticky headers, tab bar, FAB resting | `#1D2521`, 0.08, 10, 4 | 3 | `surface-raised` + top `line` |
| 3 | Bottom sheets, menus | `#1D2521`, 0.12, 20, 8 | 8 | `surface-raised` (lighter by tone) + `line` |
| 4 | Modals, toasts | `#1D2521`, 0.16, 28, 12 | 12 | `surface-sunken` + `line-strong` 1px |

Sensory-calm uses levels 0 to 2 only (sheets use level 2 values).

### 7.4 Sizing tokens

| Token | Value | Use |
|---|---|---|
| `touch-min` | 44pt (iOS minimum); components default to 48 x 48dp (`08-component-architecture.md` §11) | Every interactive element |
| `control-h-sm` / `md` / `lg` | 36 / 48 / 56 (min heights; Urdu grows with content) | Buttons and inputs (`sm` is allowed only with `hitSlop` reaching 44) |
| `icon-sm` / `md` / `lg` | 16 / 20 / 24 | Icons |
| `avatar-xs` … `xl` | 24 / 32 / 40 / 56 / 80 | `Avatar` sizes |
| `tabbar-h` | 56 + safe-area inset | Bottom tabs |
| `header-h` | 52 (large title collapses from 96) | Native stack header |
| `fab` | 56 | Floating action button |
| `ring-lg` / `md` / `sm` | 160 / 120 / 40 | `HydrationRing`, `ProgressRing` |

---

## 8. Iconography, illustration and motion

### 8.1 Icons

- **Library:** `phosphor-react-native` (MIT), weight `regular` (1.5px stroke at 24) for UI, `fill` for the active tab and selected states, `duotone` never (too busy). One icon set only.
- **Custom icons** (same grid, 24 x 24, 1.5px stroke, rounded caps), stored as SVG components in `apps/mobile/src/components/ui/icons/`: `plate-thirds`, `thuluth-dots` (three dots), `glass-three-breaths`, `dates`, `roti`, `katori` (bowl), `sprout`, `crescent` (Ramadan contexts only), `safe-food` (shield-leaf), `ladder-step`, `texture-crunchy`, `texture-smooth`, `texture-soft`, `texture-chewy`, `texture-crispy`, `texture-mixed`, `texture-lumpy`, `texture-wet`, `texture-dry`.
- **Key mappings:** Today `sun`, Plan `calendar-blank`, Ask `chat-circle-text`, Family `users-three`, More `dots-three-circle`; water `drop`; growth `plant` / custom `sprout`; budget `wallet`; grocery `basket`; fasting `moon-stars` is **not** used (crescent with star is decorative); fasting uses custom `crescent` only inside Ramadan and fasting screens and `timer` elsewhere; sources: Qur'an `book-open-text`, hadith `scroll`, science `flask`; safety `first-aid`; premium `seal-check` in accent.
- **Mirroring:** directional icons (`caret-left/right`, `arrow-*`, `arrow-u-up-left` for undo, `paper-plane-right` for send, `list-bullets` when indicating text direction) mirror in RTL via `Icon mirrorInRtl` (default true for that list). Never mirror: clock, checkmark, media playback (play stays pointing right per platform convention), charts, logos, plate, numbers, the Qur'an book.
- **Labels:** icons are decorative unless they are the only content of a control; icon-only controls must have `accessibilityLabel` (enforced by TypeScript in `IconButtonProps`).

### 8.2 Illustration system

See §2.3 rules. Sizes: empty states 160 x 120, onboarding heroes full width x 240 max, inline spot illustrations 64 x 64. All illustrations ship as SVG components accepting `palette: { primary: string; secondary: string; accent: string; line: string; fill: string }` resolved from `useThemeColors()`.

### 8.3 Motion

| Token | Duration | Easing (Reanimated) | Use |
|---|---|---|---|
| `motion.instant` | 0 ms | none | Reduced motion substitutions |
| `motion.fast` | 120 ms | `Easing.out(Easing.quad)` | Press feedback, chip toggle, checkbox |
| `motion.base` | 200 ms | `Easing.bezier(0.2, 0, 0, 1)` | Sheet content, fades, list item insert |
| `motion.slow` | 300 ms | `Easing.bezier(0.2, 0, 0, 1)` | Ring and bar value changes, screen-level transitions |
| `motion.progress` | linear, continuous | `Easing.linear` | Only progress indicators (exempt from the 300 ms cap) |

Rules:

1. Motion explains change (where something came from, what changed); it never decorates. No looping animations except active progress.
2. **Reduced motion** (`AccessibilityInfo.isReduceMotionEnabled`, or Sensory-calm): replace movement with a 120 ms opacity crossfade or no animation; disable shimmer, springs, parallax and the OTP shake (replace with colour and text).
3. Native stack transitions use platform defaults (`animation: 'default'`); with reduced motion, `animation: 'fade'`.
4. Value animations (`HydrationRing`, `BudgetBar`, `ProgressRing`) animate from the previous value to the new one in `motion.slow`, never from zero on every render.
5. Success moments: a 200 ms check draw and a single `success` haptic; no confetti anywhere in the product.
6. Streaming chat text appears as it arrives without per-character animation; the caret blinks at 1 Hz only when reduced motion is off.

---

## 9. Navigation chrome and layout patterns

- **Bottom tab bar:** 5 tabs (`02-ux-specification.md` §3.2), `surface-raised` background, elevation 2 (light) or top `line` (dark), icons 24 with labels always visible (`label` variant, 12pt min in Latin, 13pt Urdu with 28 line height, so the bar grows to about 64pt in Urdu), active tab `primary` with filled icon, inactive `ink-muted`. Badges: 8pt dot or count pill in `danger` only for safety alerts, `primary` for other counts.
- **Headers:** native stack headers with large titles on top-level tab screens (iOS) and standard titles elsewhere; background `surface` blending into content, `line` hairline when scrolled.
- **Screen template:** `Screen` primitive (`08-component-architecture.md` §4.13) with safe areas, 16pt gutters, keyboard avoidance; the primary action sits either in-content at the end of a form, or in a sticky bottom bar (`StickyActionBar`) for wizards, shopping mode and sheets.
- **Sheets:** `Sheet` with handle, 28pt top radius, `surface-raised`, scrim `#000` at 40 percent (light) or 60 percent (dark).
- **Lists:** grouped lists inset with `rounded-lg` groups on `surface`; rows 56pt min (64 for two-line), separators `line` inset by the leading icon width.
- **FAB:** 56pt circle, `primary` fill, `on-primary` plus icon, bottom-end above the tab bar with 16pt margin; hidden for viewers.
- **Tablets:** two-column layouts at 768pt and wider (list-detail for Plan and Family), max content width 640 per column.

---

## 10. Component library catalog

Layers follow `08-component-architecture.md` §1: **primitives** (`apps/mobile/src/components/ui/`), **composites** (shared, feature-agnostic), **domain components** (owned by features, re-exported where shared). Every component: accepts `className` and `testID`, uses tokens only, supports light, dark, calm light, calm dark, LTR and RTL, and has Storybook stories for each listed state (`08-component-architecture.md` §12). Props marked **(08)** are copied from `08-component-architecture.md`; if they drift, 08 is authoritative. Components marked **Proposed** are used by `02-ux-specification.md` but not yet specified in 08; their props here are the proposal.

### 10.1 Primitives

| Component | Key props (08) | Variants and sizes | Visual states | Notes |
|---|---|---|---|---|
| `Button` | `label`, `onPress`, `variant`, `size`, `leftIcon`, `rightIcon`, `loading`, `disabled`, `fullWidth`, `haptic` | `primary` (`bg-primary text-on-primary`), `secondary` (`border-line-strong text-primary bg-surface-raised`), `ghost` (`text-primary`), `destructive` (`bg-danger text-on-danger`), `link` (`text-primary underline`); `sm` 36, `md` 48, `lg` 56 min height | default, pressed (`primary-pressed`, scale 0.98 unless reduced motion), focused (2pt `focus` ring offset 2), disabled (opacity 0.5), loading (spinner replaces leading icon, label kept for width) | Label never wraps to more than 2 lines; Urdu grows height |
| `Text` | `variant`, `tone`, `script`, `align`, `numberOfLines`, `maxFontSizeMultiplier` | §5.2 variants; tones `neutral`→`ink`, `muted`→`ink-muted`, `inverse`, semantic tones | n/a | Applies Nastaliq metrics in `ur` and Amiri for `script="arabic"` |
| `Input` | `label`, `value`, `onChangeText`, `helperText`, `errorText`, `leftIcon`, `rightAccessory`, `unit`, `variant` (`text`, `numeric`, `otp`, `multiline`, `search`), `required` | md 48 min (Urdu 56) | default (`bg-surface-sunken border-line-strong`), focused (`border-primary` 2pt), error (`border-danger` 2pt + error text + icon), disabled, read-only (no border, `ink-muted`) | Label above field (never placeholder-as-label); `unit` on logical end |
| `Card` | `variant` (`elevated`, `outlined`, `filled`), `padding`, `onPress`, `header`, `footer` | elevated = level 1; outlined = `border-line`; filled = `bg-surface-sunken` | default, pressed (overlay `ink` 4%), focused | `onPress` requires `accessibilityLabel` |
| `Sheet` | `open`, `onClose`, `title`, `snapPoints`, `dismissible`, `footer`, `scrollable` | level 3 | open, dragging, keyboard-open | Focus trapped; Close button always present for screen readers |
| `Chip` | `label`, `selected`, `onPress`, `onRemove`, `icon`, `tone`, `size`, `mode` | `sm` 32, `md` 40 (hitSlop to 44) | unselected (`border-line-strong`), selected (`bg-primary-soft text-on-primary-soft border-primary` + check icon), disabled | Selection never colour-only: check icon appears |
| `Avatar` | `name`, `imageUri`, `size`, `badge`, `ring` | xs to xl | default, active ring (2pt `primary`), with badge | Preset avatars are object illustrations (date palm, pomegranate, star tile, book, olive branch, water jug), never faces; initials fallback on `primary-soft` |
| `ProgressRing` | `value`, `size`, `strokeWidth`, `tone`, `segments`, `centerSlot`, `accessibilityLabel`, `animate` | sizes §7.4 | empty track (`surface-sunken`), partial, complete (check in centre), overflow arc | Base for `HydrationRing` and Thuluth visuals |
| `Skeleton` | `variant`, `width`, `height`, `lines`, `count` | line, block, circle, card, ring, list-row, chart | static (`surface-sunken`) or shimmer (disabled with reduced motion / calm) | Hidden from screen readers |
| `EmptyState` | `illustration`, `title`, `body`, `primaryAction`, `secondaryAction` | | | One primary action max |
| `ErrorState` | `error`, `onRetry`, `variant` (`screen`, `inline`, `card`), `titleOverride`, `showSupportLink` | | | Shows mapped copy, small error code |
| `Toast` | `message`, `tone`, `durationMs`, `action` | level 4, bottom above tab bar | | Never sole feedback for failures |
| `Screen`, `Icon`, `SegmentedControl`, `Switch`, `Divider`, `Spacer`, `Badge`, `Banner` | see 08 §4.13 | `SegmentedControl` track `surface-sunken`, thumb `surface-raised` level 1; `Switch` on = `primary` | | `Badge` tones map to semantic soft tokens |

### 10.2 Composites (shared)

| Component | Status | Props | States |
|---|---|---|---|
| `IconButton` | 08 (referenced in §8.1 rule) | `icon: IconName`, `onPress`, `accessibilityLabel: string` (required), `size?: Size`, `tone?: Tone`, `badgeCount?: number` | default, pressed, disabled |
| `ListItem` | Proposed | `title: string`, `subtitle?: string`, `leading?: Slot`, `trailing?: Slot \| 'chevron' \| 'switch'`, `onPress?`, `destructive?: boolean` | default, pressed, disabled |
| `SectionHeader` | Proposed | `title: string`, `actionLabel?: string`, `onAction?: () => void` | |
| `RadioCard` | Proposed | `title: string`, `description?: string`, `selected: boolean`, `onPress`, `icon?: IconName`, `disabled?: boolean` | unselected, selected (`border-primary` 2pt + `primary-soft` fill + radio dot), disabled |
| `ProgressBar` | Proposed | `value: number (0..1)`, `tone?: Tone`, `label?: string`, `showValue?: boolean`, `stepped?: boolean` (calm mode) | |
| `StickyActionBar` | Proposed | `primary: { label; onPress; loading?; disabled? }`, `secondary?: { label; onPress }` | keyboard-open (lifts) |
| `DatePickerField`, `TimeField`, `SelectField`, `CurrencyField`, `DayChips` | Proposed (form fields built on `Input` + `Sheet`, bound via RHF `Controller`; form architecture in 08 §6) | `label`, `value`, `onChange`, `errorText?`, plus: `DatePickerField.min/max/calendar: 'gregorian' \| 'hijri-display'`; `CurrencyField.currency: string` (minor units in/out); `SelectField.options: {value,label}[]`, `searchable?` | default, open, error |
| `MultiSelectChips` | Proposed | `options: {value,label,icon?}[]`, `value: string[]`, `onChange`, `max?: number` | |
| `AllergenGrid`, `TextureChipGrid`, `IngredientChipPicker` | Proposed (intake pickers) | `value`, `onChange`, `exclude?: string[]`; textures use `Texture` enum and custom texture icons | |
| `WeekStrip` | Proposed | `dates: IsoDate[]`, `selected: IsoDate`, `onSelect`, `showHijri?: boolean`, `markers?: Record<IsoDate, 'complete' \| 'partial' \| 'none'>` | |
| `HijriDate` | Proposed | `date: IsoDate`, `offsetDays?: number`, `format?: 'short' \| 'long'` | |
| `QuoteCard` | Proposed | `variant: 'quran' \| 'hadith' \| 'narration'`, `arabic: string`, `translation: string`, `citation: SourceCitationChipProps['source']`, `translator?: string` | collapsed translation, expanded |
| `GeometricPattern`, `GeometricPlaceholder`, `ThuluthLogo` | Proposed (§2) | see §2.1 and §2.2; `GeometricPlaceholder.color: string`, `label?: string` | hidden in calm mode (pattern only) |
| `Fab` | Proposed | `icon`, `accessibilityLabel`, `onPress`, `actions?: {label; icon; onPress; premium?: boolean}[]` | resting, pressed, expanded menu |
| `CountdownText` | Proposed | `until: number (epoch ms)`, `format: (msLeft) => string`, `onDone?` | |

### 10.3 Feedback, safety and system components

| Component | Status | Props | Visual |
|---|---|---|---|
| `OfflineBanner` | Proposed | `lastUpdatedAt?: number` | `warning-soft` strip under header, cloud-slash icon, "You're offline. Showing saved data." |
| `QueuedBadge` | Proposed | `count?: number` | small `warning-soft` pill with clock icon "Will sync" |
| `RequiresConnectionNotice` | Proposed | `feature: string` | `info-soft` inline card |
| `RoleNotice` | Proposed | `role: 'viewer' \| 'caregiver'` | `info-soft` banner |
| `SafetyBanner` | Proposed | `tone: 'info' \| 'warning' \| 'danger'`, `title: string`, `body: string`, `action?: { label; onPress }`, `dismissible?: false` for danger | danger uses `danger-soft` fill, `on-danger-soft` text, `first-aid` icon; never dismissible when `danger` |
| `AlertCard` | Proposed | `tone`, `title`, `body?`, `onPress`, `timestamp?` | Dashboard priority alerts; danger only for red flags |
| `ScholarNotice` | Proposed | `variant?: 'inline' \| 'card'` | `info-soft`, `scroll` icon, fixed copy key `safety:scholar_notice` |
| `DisclaimerFooter` | Proposed | `variant?: 'short' \| 'full' \| 'inline'` | `caption` in `ink-subtle`, top `line` divider |
| `PremiumBadge` | Proposed | `size?: 'sm' \| 'md'` | `accent` fill, `on-accent` text "Premium", `seal-check` icon |
| `UsageCounter` | Proposed | `remaining: number`, `limit: number` | `caption`, `warning` tone at 3 or fewer |

### 10.4 Domain components

#### `PlateDiagram` (08 §5.1)

| Prop | Type | Default | Notes |
|---|---|---|---|
| `split` | `PlateSplit` `{ veg, protein, carb }` fractions | required | Actual or planned |
| `target` | `PlateSplit` | `{ veg: 0.5, protein: 0.25, carb: 0.25 }` | Drawn as a dashed `line-strong` outline ring when it differs from `split` |
| `size` | `number` | 120 | 32 (inline, labels off), 120 (cards), 160 to 220 (heroes) |
| `showLabels` | `boolean` | `size >= 120` | Forced on in calm mode |
| `interactive` / `onSegmentPress` | `boolean` / `(segment) => void` | false | Segments become buttons with labels |
| `accessibilityLabel` | `string` | generated | "Half vegetables, a quarter protein, a quarter grains" |

Visual: circle plate with a 4pt `surface-sunken` rim, segments in plate tokens with patterns (§4.1), segment gap 2pt in `surface-raised`. States: loading (ring skeleton), no data (empty plate outline with "No meals logged"), comparison (actual filled, target outline). Child meals use the same diagram; it never shows kcal.

#### `ThuluthMeter` (08 §5.2)

| Prop | Type | Default | Notes |
|---|---|---|---|
| `mode` | `'adult' \| 'child'` | required | Discriminated union: `child` accepts no fullness props |
| `fullnessAfter` | `number \| null` (0 to 10, per the `meal_logs` check constraint) | null | Adult only; from `meal_logs.fullness_after` |
| `drinkWindowMl` | `number \| null` | null | Adult only; pre-meal and with-meal fluids |
| `onCheckIn` | `() => void` | undefined | Opens "Could I eat more if I had to?" check |

Visual (adult): a vertical vessel divided into three equal stacked bands (Food `plate-carb` tint, Drink `water`, Breath `plate-space` with dashed outline) inside a rounded rectangle; the food band fills to the fullness level mapped onto the lower third (fullness 7 to 8 of 10 = the food third full, the target), the drink band shows the fluid share, the breath band stays open; a soft tick marks "about 70 to 80 percent full". Text below: "Food · Drink · Breath". Visual (child): three icons in a row (clock "Meal time", table "Sat together", hand "Bismillah") with checkmarks, no fill levels, no stop message. States: no data (outline only with "Check in after your meal"), partial, target reached (calm check), above target (neutral text "Fuller than the thirds today. That's okay."), never danger colours.

#### `HydrationRing` (08 §5.3)

| Prop | Type | Default | Notes |
|---|---|---|---|
| `consumedMl` | `number` | required | |
| `targetMl` | `number` | required | From `hydration_targets.daily_ml` |
| `windows` | `{ mealType, startsAt, endsAt, kind: 'pre_meal' \| 'post_meal' }[]` | [] | Rendered as tick marks on the outer edge |
| `nextWindow` | `{ label, startsAt } \| null` | null | Text under ring: "Water before lunch at 12:40" |
| `unit` | `'metric' \| 'imperial'` | required | ml/L or fl oz/cups |
| `fasting` | `boolean` | false | Shows moon-free "Fasting" state: ring dimmed, text "Hydrate between iftar and suhoor" |
| `loading` | `boolean` | false | Ring skeleton |

Visual: `ProgressRing` in `water` on `surface-sunken` track, centre shows `display` number ("1.2 L") and `caption` "of 1.8 L"; for children, centre shows cups ("4 of 5 cups"). Overflow beyond 100 percent renders a thin second arc, no celebration. Family score on Dashboard uses `ProgressRing` with the same styling and a "Family" label.

#### `GrowthChart` (08 §5.4)

| Prop | Type | Default | Notes |
|---|---|---|---|
| `indicator` | `'weight_for_age' \| 'height_for_age' \| 'bmi_for_age' \| 'head_circumference_for_age'` | required | |
| `sex` | `sex_at_birth` | required | `unspecified` uses the average of male and female LMS curves only for display, with a note (computation rule owned by `15-family-health-modules.md`) |
| `reference` | `'who_2006' \| 'who_2007' \| 'cdc_2000'` | required | |
| `points` | `GrowthPoint[]` | required | |
| `percentileCurves` | `{ percentile: 3 \| 15 \| 50 \| 85 \| 97; series }[]` | required | CDC display maps to the nearest available curves (proposal: extend the union with 5, 10, 25, 75, 90, 95 for CDC; see §15) |
| `unit` | `'metric' \| 'imperial'` | required | |
| `locked` | `boolean` | false | Free tier: blurred bands with `PremiumGate` teaser |
| `onPointPress` | `(point) => void` | | Tooltip card |
| `loading` | `boolean` | false | Chart skeleton |

Visual: §4.2 band styling; x-axis labels in months under 24 months, years after; y-axis on the logical start side; tooltip `surface-raised` level 3 with date, value, "around the 40th percentile". States: empty (axes and bands with "Add first measurement"), single point, trend, watch (affected segment annotated with `warning` text label, line colour unchanged), red flag (banner above chart, line colour unchanged), locked, "As table" view.

#### `MealCard` (08 §5.5)

| Prop | Type | Default | Notes |
|---|---|---|---|
| `mealType` | `MealType` | required | Overline label, icon |
| `title` | `string` | required | `heading`, 2 lines max (3 in Urdu) |
| `scheduledTime` | `string \| null` | null | 'HH:mm', LTR isolate |
| `imageUri` | `string \| null` | null | 72 x 72 rounded-md thumbnail or `GeometricPlaceholder` |
| `plateSplit` | `PlateSplit` | undefined | `PlateDiagram size={32}` |
| `servings` | `{ member, status, adapted }[]` | required | Avatar stack (max 5 + "+2"), each with a status glyph (§3.5) and an adaptation dot |
| `tags` | `('kid_friendly' \| 'autism_friendly' \| 'sunnah_food' \| 'ramadan_suitable' \| 'budget')[]` | [] | `Badge`s, max 2 visible |
| `waterReminder` | `string \| null` | null | `water` drop icon + caption |
| `onPress` / `onSwap` | handlers | | Swap as secondary action (custom a11y action) |

Visual: `Card variant="elevated"` `rounded-lg`, 16 padding. States: upcoming, current (left/start border 3pt `primary`), all logged (check badge, title `ink-muted`), partly logged, skipped (dash glyph, neutral), swapped (swap glyph), offline queued (`QueuedBadge`), loading (`Skeleton variant="card"`). Proposed `density?: 'default' \| 'cell'` prop for the plan week grid (cell: title + dots only, 2 lines; §15).

#### `MealServingRow` (08 §5.6)

Props (08): `member`, `portionLabel`, `adaptation`, `adaptedMealTitle`, `status`, `acceptance`, `showAcceptance`, `onStatusChange`, `onAcceptanceChange`, `disabled`. Visual: avatar, name, portion household measure (`body`), adaptation `Badge` ("Autism", "Picky", "Allergy", "Pregnancy" with icons), status `Chip` group (Ate, Some, Skipped, Swapped). States: default, logged, acceptance shown, viewer disabled, child (no numbers ever).

#### `AcceptanceScorePicker` (08 §5.7)

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `AcceptanceScore \| null` | required | |
| `onChange` | `(score) => void` | required | |
| `variant` | `'faces' \| 'steps'` | `'faces'` | Name kept from 08; **visual uses no faces**: "faces" renders six simple food-interaction icons (plate untouched, plate nudged, hand touch, tongue-free "taste" spoon, half bowl, empty bowl). `steps` renders a 6-step horizontal ladder. See §15 for a suggested rename. |
| `size` | `Size` | `md` | |

Visual: six options, each icon + word (§8.2 of `02-ux-specification.md`), selected option `primary-soft` fill with `primary` border and check; sequential teal ramp only as a subtle background tint. States: unset, selected, disabled, read-only (proposed `readOnly`). Accessibility: radio group "How did it go with {food}?", each option "3, Tasted".

#### `ExposureLadder` (08 §5.8)

Props (08): `targetFoodLabel`, `strategy`, `steps`, `currentStep`, `onStepPress`, `onLogExposure`, `orientation`, `locked`. Visual: vertical stepper with 9 stage nodes (custom `ladder-step` icon per stage), completed nodes filled `primary` with check, current node ringed with "Log a try" button, future nodes outline `line-strong`; food chaining shows bridge labels between nodes with arrows (mirrored in RTL). Horizontal orientation is a compact progress strip for hub cards. States: locked (blurred with `PremiumGate`), paused (all nodes `ink-subtle` + "Paused" badge), completed (summary "Explored over 6 weeks"), step back (no negative styling).

#### `SensoryProfileEditor` (08 §5.9)

Props (08): `value: SensoryProfileValue`, `onChange`, `errors`, `disabled`. Visual: grouped cards (Textures, Colours, Presentation, Temperature, Brand) using `TextureChipGrid` (likes: filled chip; avoids: outline chip with a slash icon, `ink-muted`, never red), colour swatches always with text labels, presentation toggles with tiny diagrams (divided plate, separated foods, cut shapes).

#### `SourceCitationChip` and `EvidenceChip` (08 §5.10)

| Prop | Type | Notes |
|---|---|---|
| `source.id` | `string` | `islamic_sources.id` |
| `source.kind` | `SourceKind` | Icon: Qur'an `book-open-text`, hadith `scroll`, imam narration `scroll` + "Ahl al-Bayt" tag, scholarly `graduation-cap` |
| `source.tradition` | `SourceTradition` | Small text tag: Shared / Sunni / Shia (no colour coding between traditions; same neutral style for fairness) |
| `source.citationText` | `string` | "Tirmidhi 2380", "Al-A'raf 7:31", "Al-Kafi 6:…" |
| `source.grade` | `evidence_grade_hadith \| null` | Grade pill text ("Sahih", "Hasan", "Muwaththaq"); `daif` grades are not shown to users as support (filtered upstream) |
| `source.verified` | `true` | Type-level guarantee |
| `onPress` | `(sourceId) => void` | Opens `SourceDetailSheet` |
| `compact` | `boolean` | Icon + citation only |

`EvidenceChip`: `evidence: { id, citation, grade: evidence_grade_science }`, `onPress`; icon `flask`, GRADE pill ("High", "Moderate", "Low", "Very low", "Expert opinion"). Visual for both: `Chip mode="assist"` style, `surface-sunken` fill, `line-strong` border, `label` text, 32pt height with hitSlop to 44. Chips appear in a wrapping row: Islamic chip(s) first, then evidence chip(s), separated by a thin vertical divider. States: default, pressed, offline (still tappable; sheet shows cached content).

#### `BudgetBar` (08 §5.11)

Props (08): `budget`, `spent`, `estimated`, `strictness`, `categories`, `periodLabel`, `onCategoryPress`. Visual: 12pt tall rounded bar on `surface-sunken`, spent segment tone by threshold (below 85 percent `success`, 85 to 100 `warning`, over 100 `danger`, per 08), estimated segment hatched at 40 percent, labels above ("PKR 41,200 of 80,000") and below ("12 days left"); category mode stacks thin 6pt bars per category with labels. States: no budget (CTA), loading, over budget (`hard_cap` adds `SafetyBanner tone="warning"` style banner with neutral copy), offline.

#### `GroceryItemRow` (08 §5.12)

Props (08): `item`, `mode: 'planning' \| 'shopping'`, `onToggle`, `onActualPriceChange`, `onSubstitute`, `disabled`. Visual: planning 56pt rows; shopping 64pt rows with 28pt checkbox, larger `bodyStrong` label, price entry button; checked = strike-through label in `ink-subtle` and moves to "In basket"; fresh tag `Badge` "Weekly"; substitution shows "instead of {original}" caption.

#### `ChatMessageBubble` (08 §5.13), `ChatComposer` (08 §5.14), `MealAnalysisCard` (08 §5.15), `FollowUpChips` (08 §5.16)

- `ChatMessageBubble`: user role = `primary-soft` bubble, `on-primary-soft` text, `rounded-xl` with the logical-end bottom corner at 6; assistant role = no bubble, full width, `ink` text, markdown subset; failed = `danger` caption "Not sent. Tap to retry"; streaming = caret; citation and evidence chips row below; `safetyNotice` renders `SafetyBanner` above content.
- `ChatComposer`: `surface-raised` bar with top `line`, input `surface-sunken` `rounded-xl`, attachment and mic `IconButton`s (with `PremiumBadge` dot on free), send button `primary` circle 40pt (mirrored icon in RTL). Recording state: input replaced by timer and level bars (static in calm mode), "Release to finish" / "Tap to stop" (toggle mode for screen readers).
- `MealAnalysisCard`: `Card variant="outlined"`, photo thumbnail 64pt, items list with confidence `Badge` ("Sure" / "Not sure"), `PlateDiagram size={96}` with target outline, Thuluth feedback in `body`, nutrition table hidden when `memberIsChild`, actions "Looks right" / "Edit".
- `FollowUpChips`: horizontally scrolling row of `Chip mode="assist"` (max 4), wraps to 2 lines in Urdu.

#### `PaywallSheet` (08 §5.17)

| Prop | Type | Notes |
|---|---|---|
| `open` / `onClose` | `boolean` / `() => void` | Close visible immediately |
| `trigger` | 08 union (see §15 for proposed extension) | Selects headline and benefit order |
| `packages` | `PurchasesPackage[]` | From RevenueCat offerings |
| `selectedPackageId` / `onSelectPackage` | `string \| null` / `(id) => void` | Annual preselected by the container |
| `onPurchase` / `onRestore` | `() => void` | |
| `purchasing` / `restoring` | `boolean` | Button loading states; dismissal blocked while purchasing |
| `error` | `string \| null` | Inline `danger` text above the CTA |
| `legal` | `{ termsUrl, privacyUrl }` | Fine print links |

Visual: full-screen on phones (rendered by the `PaywallModal` route), header `GeometricPattern` at 5 percent behind the `ThuluthLogo`, benefit rows with icons, two `PlanOptionCard`s (Proposed: `title`, `priceString`, `periodLabel`, `perMonthString?`, `savingsLabel?`, `selected`, `onPress`, `introOfferLabel?`) as `RadioCard`-style cards with `rounded-xl`, the selected card `primary` 2pt border; CTA `Button size="lg" fullWidth`; reassurance line in `ink-muted`. No countdowns, no strikethrough fake prices, no pre-checked add-ons. States: loading offerings (two skeleton cards), error, purchasing, success, pending, already premium.

#### `PremiumGate` (08 §5.18), `FamilyMemberSwitcher` (08 §5.19), `IntakeStep` (08 §5.20)

- `PremiumGate` fallbacks: `teaser` (content preview at 40 percent opacity with a 16pt blur where supported, overlaid `Card` with title, body and "See Premium"), `lock-badge` (inline row with `PremiumBadge` and chevron), `hidden`.
- `FamilyMemberSwitcher`: `avatars` variant is a horizontal scroll of 40pt avatars with names below (`caption`), "Everyone" first with a `users-three` icon, selected avatar ring `primary`; `dropdown` variant is a header pill with sheet.
- `IntakeStep`: header with Back, progress bar (`ProgressBar`, section-labelled), member avatar chip on per-member steps, scroll content, `StickyActionBar` with Next and optional Skip, "Draft saved" caption.

#### Proposed domain components (used in `02-ux-specification.md`, not yet in 08)

| Component | Props | Visual / states |
|---|---|---|
| `ThirdsKeptPicker` | `value: 0 \| 1 \| 2 \| 3 \| null`, `onChange`, `disabled?` | Three segments (Food, Drink, Breath icons) that light up in order; adjustable a11y role; neutral copy at every value |
| `ThirdsKeptSummary` / `ThirdsKeptTrend` | `average: number \| null` / `series: { date: IsoDate; value: number \| null }[]` | Summary shows "2.3 of 3 thirds kept yesterday"; trend is a 7/30-day dot plot in `primary` |
| `PortionTable` | `rows: { member: FamilyMemberSummary; householdMeasure: string; grams?: number; kcal?: number; adaptation: MealServingRowProps['adaptation'] }[]`, `showNumbers: boolean` | `kcal` column renders only when `showNumbers` and the member is an adult; child rows add "Seconds welcome" caption |
| `AdaptationNote` | `member`, `reason: 'autism' \| 'picky' \| 'allergy' \| 'pregnancy'`, `text: string` | `info-soft` card with reason icon |
| `RecommendationCard` | `title: string`, `body: string`, `sources: SourceCitationChipProps['source'][]`, `evidence: EvidenceChipProps['evidence'][]`, `onAsk?: () => void` | `Card variant="outlined"`, chips row, "Ask about this" link |
| `PlanGenerationStepper` | `stages: { key: string; label: string }[]`, `currentKey: string`, `progress: number`, `status: 'generating' \| 'ready' \| 'failed'` | Vertical list with icons; current stage `primary` + `ProgressBar`; failed `danger` text with retry slot |
| `PlanWeekGrid` | `days: IsoDate[]`, `mealTypes: MealType[]`, `cells: Record<string, MealCardProps>`, `onCellPress` | Sticky day column on logical start; horizontal scroll on phones |
| `RecipeCard` | `title`, `imageUri`, `minutes`, `costTier: 1 \| 2 \| 3`, `badges`, `textures?: Texture[]`, `onPress` | 2-column grid card, `rounded-lg` |
| `FastingTimer` / `FastingTimerCompact` | `startsAt: number`, `endsAt: number`, `label: string` (e.g. "Iftar"), `prayerLabel?: string` | `ProgressRing` in `secondary` (clay) with remaining time; crescent icon only in Ramadan context |
| `PrayerTimesStrip` | `times: { name: 'fajr' \| 'dhuhr' \| 'asr' \| 'maghrib' \| 'isha'; at: string }[]`, `highlight?: 'fajr' \| 'maghrib'` | Horizontal strip, LTR isolates for times |
| `FluidTimingTimeline` | `meals: { mealType; at: string }[]`, `windows: HydrationRingProps['windows']`, `logs: { at: string; ml: number }[]` | Horizontal day line, meals as `plate-thirds` icons, windows shaded `water` 15 percent |
| `SafeFoodTile` | `label`, `icon?`, `texture?: Texture`, `brandNote?: string`, `strength: 1 \| 2 \| 3`, `onPress` | `rounded-lg` tile, shield-leaf icon, strength dots |
| `FoodChainBuilder` | `startLabel`, `targetLabel`, `links: { id; label; change: 'taste' \| 'texture' \| 'colour' \| 'shape' \| 'temperature'; why: string }[]`, `onChange`, `onAskAi?` | Node chain with arrows (mirrored in RTL), wraps vertically on narrow screens |
| `CoachingTipCard` | `body: string`, `source?: SourceCitationChipProps['source']`, `evidence?: EvidenceChipProps['evidence']`, `module` | `primary-soft` card with lightbulb icon |
| `AcceptanceTrendChart` | `weeks: { weekStart: IsoDate; counts: Record<AcceptanceScore, number> }[]` | Stacked bars, sequential teal ramp, labels, "As table" |
| `InsightCard` | `title`, `summary`, `visual: Slot`, `onAsk?` | `Card variant="elevated"` |
| `MemoryIndicator` | `enabled: boolean`, `count: number`, `onPress` | Bookmark icon + count; off state outline with `PremiumBadge` |
| `StreamingText` | `text: string`, `streaming: boolean` | Markdown subset, caret while streaming; sentence-level announcements |
| `VoiceRecordButton` | `state`, `elapsedMs`, `onStart`, `onStop`, `onCancel`, `mode: 'hold' \| 'toggle'` | Part of `ChatComposer` |
| `NotificationRow`, `SettingsRow`, `ExportRow` | standard row props (`title`, `subtitle`, `icon`, `trailing`, `onPress`, `unread?` / `status?`) | `ListItem` specialisations |

---

## 11. Tokens as code: Tailwind preset, NativeWind and TypeScript

### 11.1 Files

| File | Role |
|---|---|
| `packages/config/src/tokens.ts` | **Single source of truth** for colour (four themes), spacing, radius, typography, motion, elevation. Typed. |
| `packages/config/tailwind/preset.js` | Tailwind preset consumed by NativeWind; requires the compiled tokens (`packages/config/dist/tokens.cjs`, built by `tsup` before the mobile app in the Turborepo pipeline). Colours reference CSS variables, as specified in `08-component-architecture.md` §10.1. |
| `apps/mobile/tailwind.config.js` | App config: content globs, `nativewind/preset` + our preset. |
| `apps/mobile/global.css` | Tailwind directives and the light/dark CSS variable defaults (used by Storybook web and as NativeWind fallback). |
| `apps/mobile/src/theme/theme-provider.tsx` | Applies the active variable set with NativeWind `vars()` at the root (light, dark, calm light, calm dark) and sets `colorScheme`. |
| `apps/mobile/src/theme/use-theme-colors.ts` | Resolved hex values for SVG, charts and the React Navigation theme (08 §10.2). |
| `packages/config/scripts/check-contrast.ts` | CI contrast check (§11.6). |

### 11.2 TypeScript tokens

```ts
// packages/config/src/tokens.ts
export type ThemeName = 'light' | 'dark' | 'calmLight' | 'calmDark';

export const colorTokenNames = [
  'surface', 'surface-raised', 'surface-sunken',
  'ink', 'ink-muted', 'ink-subtle',
  'line', 'line-strong',
  'primary', 'primary-pressed', 'on-primary', 'primary-soft', 'on-primary-soft',
  'secondary', 'on-secondary',
  'accent', 'on-accent', 'accent-ink',
  'success', 'on-success', 'success-soft', 'on-success-soft',
  'warning', 'on-warning', 'warning-soft', 'on-warning-soft',
  'danger', 'on-danger', 'danger-soft', 'on-danger-soft',
  'info', 'on-info', 'info-soft', 'on-info-soft',
  'focus',
  'plate-veg', 'plate-protein', 'plate-carb', 'water', 'plate-space',
] as const;
export type ColorToken = (typeof colorTokenNames)[number];
export type ColorTheme = Readonly<Record<ColorToken, `#${string}`>>;

export const colors: Readonly<Record<ThemeName, ColorTheme>> = {
  light: {
    'surface': '#FBF8F2',
    'surface-raised': '#FFFFFF',
    'surface-sunken': '#F3EEE4',
    'ink': '#1D2521',
    'ink-muted': '#4A5650',
    'ink-subtle': '#636E68',
    'line': '#DDD5C7',
    'line-strong': '#7F8781',
    'primary': '#1F6F5C',
    'primary-pressed': '#175546',
    'on-primary': '#FFFFFF',
    'primary-soft': '#E3F1EC',
    'on-primary-soft': '#145043',
    'secondary': '#8A4F2E',
    'on-secondary': '#FFFFFF',
    'accent': '#D9A23A',
    'on-accent': '#2B1E05',
    'accent-ink': '#8A5F12',
    'success': '#256B42',
    'on-success': '#FFFFFF',
    'success-soft': '#E3F3E8',
    'on-success-soft': '#1E5A37',
    'warning': '#8A5300',
    'on-warning': '#FFFFFF',
    'warning-soft': '#FFF1D6',
    'on-warning-soft': '#6B4100',
    'danger': '#B3362B',
    'on-danger': '#FFFFFF',
    'danger-soft': '#FCE8E5',
    'on-danger-soft': '#8C2A22',
    'info': '#2F6690',
    'on-info': '#FFFFFF',
    'info-soft': '#E3EEF7',
    'on-info-soft': '#234D6D',
    'focus': '#2F6690',
    'plate-veg': '#3F8A58',
    'plate-protein': '#B4573F',
    'plate-carb': '#B07A1C',
    'water': '#2F7DB3',
    'plate-space': '#E6E0D3',
  },
  dark: {
    'surface': '#0F1513',
    'surface-raised': '#18201D',
    'surface-sunken': '#212B27',
    'ink': '#ECEFEA',
    'ink-muted': '#B4BEB8',
    'ink-subtle': '#8D9892',
    'line': '#2C3632',
    'line-strong': '#6E7A74',
    'primary': '#5CC3A6',
    'primary-pressed': '#7DD3BA',
    'on-primary': '#08201A',
    'primary-soft': '#163A31',
    'on-primary-soft': '#A8E3D1',
    'secondary': '#E39A72',
    'on-secondary': '#2A1307',
    'accent': '#E8B65A',
    'on-accent': '#2B1E05',
    'accent-ink': '#E8B65A',
    'success': '#6CCB8E',
    'on-success': '#0B2615',
    'success-soft': '#13301F',
    'on-success-soft': '#A3E0B8',
    'warning': '#F0B44C',
    'on-warning': '#2E1E00',
    'warning-soft': '#3A2C10',
    'on-warning-soft': '#F6CD82',
    'danger': '#F2877C',
    'on-danger': '#2B0805',
    'danger-soft': '#3A1714',
    'on-danger-soft': '#F7B0A8',
    'info': '#7DB7E3',
    'on-info': '#0A1F30',
    'info-soft': '#142B3D',
    'on-info-soft': '#A9D1F0',
    'focus': '#7DB7E3',
    'plate-veg': '#6CBF85',
    'plate-protein': '#E58E74',
    'plate-carb': '#E2B456',
    'water': '#6CB2E6',
    'plate-space': '#3A443F',
  },
  calmLight: {
    'surface': '#F4F3EF',
    'surface-raised': '#FAF9F6',
    'surface-sunken': '#ECEAE4',
    'ink': '#2A302D',
    'ink-muted': '#535B57',
    'ink-subtle': '#646B67',
    'line': '#E1DFD8',
    'line-strong': '#80867F',
    'primary': '#4F6F66',
    'primary-pressed': '#3E5A52',
    'on-primary': '#FFFFFF',
    'primary-soft': '#E4EBE8',
    'on-primary-soft': '#3E5A52',
    'secondary': '#7A5E4E',
    'on-secondary': '#FFFFFF',
    'accent': '#C9B48E',
    'on-accent': '#2A241A',
    'accent-ink': '#6E5F45',
    'success': '#456E53',
    'on-success': '#FFFFFF',
    'success-soft': '#E5EDE7',
    'on-success-soft': '#3A5C45',
    'warning': '#7D5A1E',
    'on-warning': '#FFFFFF',
    'warning-soft': '#F3ECDD',
    'on-warning-soft': '#634716',
    'danger': '#9A4A40',
    'on-danger': '#FFFFFF',
    'danger-soft': '#F4E6E3',
    'on-danger-soft': '#7E3B33',
    'info': '#4D6B82',
    'on-info': '#FFFFFF',
    'info-soft': '#E5ECF1',
    'on-info-soft': '#3D576B',
    'focus': '#4D6B82',
    'plate-veg': '#6E8F78',
    'plate-protein': '#A07766',
    'plate-carb': '#9A855A',
    'water': '#6A8BA3',
    'plate-space': '#E4E1DA',
  },
  calmDark: {
    'surface': '#1A1F1D',
    'surface-raised': '#222826',
    'surface-sunken': '#2A312E',
    'ink': '#DCDFDB',
    'ink-muted': '#A9B0AC',
    'ink-subtle': '#969D99',
    'line': '#333A37',
    'line-strong': '#6C7470',
    'primary': '#8FB3A8',
    'primary-pressed': '#A6C4BB',
    'on-primary': '#12201B',
    'primary-soft': '#2C3B36',
    'on-primary-soft': '#B9D0C9',
    'secondary': '#C4A190',
    'on-secondary': '#24170F',
    'accent': '#BFAE8C',
    'on-accent': '#24200F',
    'accent-ink': '#BFAE8C',
    'success': '#93BFA0',
    'on-success': '#14231A',
    'success-soft': '#25332A',
    'on-success-soft': '#B5D4BE',
    'warning': '#CDAE78',
    'on-warning': '#261C08',
    'warning-soft': '#37301F',
    'on-warning-soft': '#DEC79E',
    'danger': '#D9958C',
    'on-danger': '#2A0F0B',
    'danger-soft': '#3A2624',
    'on-danger-soft': '#E8B6AF',
    'info': '#93AFC4',
    'on-info': '#111D26',
    'info-soft': '#25313A',
    'on-info-soft': '#B6CBDA',
    'focus': '#93AFC4',
    'plate-veg': '#86A890',
    'plate-protein': '#B8917F',
    'plate-carb': '#B5A277',
    'water': '#8AA7BC',
    'plate-space': '#3A403D',
  },
} as const;

/** Brand ramps for illustration and charts only (UI code uses semantic tokens). */
export const ramps = {
  teal:    { 50: '#E9F5F1', 100: '#CDE8DF', 200: '#A3D5C4', 300: '#6FBBA3', 400: '#3F9A80', 500: '#2A8069', 600: '#1F6F5C', 700: '#175546', 800: '#103D33', 900: '#0A2720' },
  clay:    { 50: '#F8EEE8', 100: '#EFD9CC', 200: '#E2BBA4', 300: '#CF9673', 400: '#B06F4B', 500: '#9A5D3A', 600: '#8A4F2E', 700: '#6E3E24', 800: '#522E1B', 900: '#371F12' },
  saffron: { 50: '#FBF3E2', 100: '#F6E4BE', 200: '#EFD08F', 300: '#E6B95E', 400: '#D9A23A', 500: '#BF8A26', 600: '#9E701B', 700: '#8A5F12', 800: '#614310', 900: '#3D2A0A' },
  neutral: { 50: '#FBF8F2', 100: '#F3EEE4', 200: '#E6E0D3', 300: '#CFC8BB', 400: '#A39D92', 500: '#858D87', 600: '#636E68', 700: '#4A5650', 800: '#2F3833', 900: '#1D2521' },
} as const;

export const spacing = { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48, 14: 56, 16: 64, 20: 80 } as const;
export const radius = { none: 0, sm: 6, md: 12, lg: 16, xl: 20, '2xl': 28, full: 9999 } as const;

export type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'label' | 'caption' | 'overline';
export interface TypeSpec { size: number; lineHeight: number; family: string; letterSpacing?: number; uppercase?: boolean; maxMultiplier: number }

export const fontFamilies = {
  ui: { 400: 'Inter-Regular', 500: 'Inter-Medium', 600: 'Inter-SemiBold', 700: 'Inter-Bold', display600: 'InterDisplay-SemiBold' },
  urdu: { 400: 'NotoNastaliqUrdu-Regular', 700: 'NotoNastaliqUrdu-Bold' },
  quran: { 400: 'AmiriQuran-Regular' },
  arabic: { 400: 'Amiri-Regular', 700: 'Amiri-Bold' },
} as const;

export const typeScale: Readonly<Record<'latin' | 'urdu', Record<TextVariant, TypeSpec>>> = {
  latin: {
    display:    { size: 32, lineHeight: 40, family: fontFamilies.ui.display600, letterSpacing: -0.5, maxMultiplier: 1.3 },
    title:      { size: 24, lineHeight: 32, family: fontFamilies.ui.display600, letterSpacing: -0.25, maxMultiplier: 1.4 },
    heading:    { size: 18, lineHeight: 26, family: fontFamilies.ui[600], maxMultiplier: 1.5 },
    body:       { size: 16, lineHeight: 24, family: fontFamilies.ui[400], maxMultiplier: 1.6 },
    bodyStrong: { size: 16, lineHeight: 24, family: fontFamilies.ui[600], maxMultiplier: 1.6 },
    label:      { size: 14, lineHeight: 20, family: fontFamilies.ui[500], letterSpacing: 0.1, maxMultiplier: 1.6 },
    caption:    { size: 13, lineHeight: 18, family: fontFamilies.ui[400], letterSpacing: 0.1, maxMultiplier: 1.6 },
    overline:   { size: 12, lineHeight: 16, family: fontFamilies.ui[600], letterSpacing: 0.6, uppercase: true, maxMultiplier: 1.4 },
  },
  urdu: {
    display:    { size: 30, lineHeight: 60, family: fontFamilies.urdu[700], maxMultiplier: 1.3 },
    title:      { size: 23, lineHeight: 46, family: fontFamilies.urdu[700], maxMultiplier: 1.4 },
    heading:    { size: 18, lineHeight: 38, family: fontFamilies.urdu[700], maxMultiplier: 1.5 },
    body:       { size: 16, lineHeight: 34, family: fontFamilies.urdu[400], maxMultiplier: 1.6 },
    bodyStrong: { size: 16, lineHeight: 34, family: fontFamilies.urdu[700], maxMultiplier: 1.6 },
    label:      { size: 14, lineHeight: 30, family: fontFamilies.urdu[400], maxMultiplier: 1.6 },
    caption:    { size: 13, lineHeight: 28, family: fontFamilies.urdu[400], maxMultiplier: 1.6 },
    overline:   { size: 13, lineHeight: 28, family: fontFamilies.urdu[700], maxMultiplier: 1.4 },
  },
};

export const scriptType = {
  'quran-lg':  { size: 26, lineHeight: 56, family: fontFamilies.quran[400] },
  'quran-md':  { size: 22, lineHeight: 48, family: fontFamilies.quran[400] },
  'arabic-md': { size: 20, lineHeight: 40, family: fontFamilies.arabic[400] },
  'arabic-sm': { size: 17, lineHeight: 34, family: fontFamilies.arabic[400] },
} as const;

export const motion = {
  instant: 0, fast: 120, base: 200, slow: 300,
  easing: { standard: [0.2, 0, 0, 1] as const, out: 'quad-out' as const },
} as const;

export interface ElevationSpec { shadowColor: string; shadowOpacity: number; shadowRadius: number; shadowOffsetY: number; androidElevation: number }
export const elevation: Readonly<Record<0 | 1 | 2 | 3 | 4, ElevationSpec>> = {
  0: { shadowColor: '#1D2521', shadowOpacity: 0,    shadowRadius: 0,  shadowOffsetY: 0,  androidElevation: 0 },
  1: { shadowColor: '#1D2521', shadowOpacity: 0.06, shadowRadius: 6,  shadowOffsetY: 2,  androidElevation: 1 },
  2: { shadowColor: '#1D2521', shadowOpacity: 0.08, shadowRadius: 10, shadowOffsetY: 4,  androidElevation: 3 },
  3: { shadowColor: '#1D2521', shadowOpacity: 0.12, shadowRadius: 20, shadowOffsetY: 8,  androidElevation: 8 },
  4: { shadowColor: '#1D2521', shadowOpacity: 0.16, shadowRadius: 28, shadowOffsetY: 12, androidElevation: 12 },
};

export const sizing = { touchMin: 44, controlSm: 36, controlMd: 48, controlLg: 56, tabBar: 56, header: 52, fab: 56 } as const;

/** "#1F6F5C" -> "31 111 92" for rgb(var(--x) / <alpha-value>) usage. */
export function hexToRgbTriplet(hex: string): string {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
}

/** CSS variable map for NativeWind vars(). */
export function cssVarsFor(theme: ThemeName): Record<`--color-${ColorToken}`, string> {
  const out = {} as Record<`--color-${ColorToken}`, string>;
  for (const name of colorTokenNames) out[`--color-${name}`] = hexToRgbTriplet(colors[theme][name]);
  return out;
}
```

### 11.3 Tailwind preset

```js
// packages/config/tailwind/preset.js
/* eslint-disable @typescript-eslint/no-var-requires */
const { colorTokenNames, spacing, radius, typeScale, fontFamilies } = require('../dist/tokens.cjs');

const v = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;
const px = (obj) => Object.fromEntries(Object.entries(obj).map(([k, n]) => [k, typeof n === 'number' ? `${n}px` : n]));

const fontSize = Object.fromEntries(
  Object.entries(typeScale.latin).map(([k, s]) => [k, [`${s.size}px`, { lineHeight: `${s.lineHeight}px`, letterSpacing: `${s.letterSpacing ?? 0}px` }]]),
);
const urduFontSize = Object.fromEntries(
  Object.entries(typeScale.urdu).map(([k, s]) => [`ur-${k}`, [`${s.size}px`, { lineHeight: `${s.lineHeight}px` }]]),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  theme: {
    // Replace (not extend) spacing and radius so only token values exist.
    spacing: px(spacing),
    borderRadius: px(radius),
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#FFFFFF',
      black: '#000000',
      ...Object.fromEntries(colorTokenNames.map((n) => [n, v(n)])),
    },
    fontFamily: {
      ui: [fontFamilies.ui[400]],
      'ui-medium': [fontFamilies.ui[500]],
      'ui-semibold': [fontFamilies.ui[600]],
      'ui-bold': [fontFamilies.ui[700]],
      'ui-display': [fontFamilies.ui.display600],
      urdu: [fontFamilies.urdu[400]],
      'urdu-bold': [fontFamilies.urdu[700]],
      quran: [fontFamilies.quran[400]],
      arabic: [fontFamilies.arabic[400]],
      'arabic-bold': [fontFamilies.arabic[700]],
    },
    fontSize: { ...fontSize, ...urduFontSize },
    extend: {
      minHeight: { touch: '44px', control: '48px', 'control-lg': '56px' },
      minWidth: { touch: '44px' },
      borderWidth: { hairline: '0.5px', focus: '2px' },
      opacity: { pattern: '0.05', disabled: '0.5', scrim: '0.4' },
    },
  },
  plugins: [],
};
```

`fontFamily.ui` matches the key used in `08-component-architecture.md` §10.1; the weight-specific keys are additions required because Android does not synthesise custom font weights.

### 11.4 App Tailwind config and global CSS

```js
// apps/mobile/tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './index.ts', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset'), require('@thuluth/config/tailwind/preset')],
};
```

```css
/* apps/mobile/global.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-surface: 251 248 242;
  --color-surface-raised: 255 255 255;
  --color-surface-sunken: 243 238 228;
  --color-ink: 29 37 33;
  --color-ink-muted: 74 86 80;
  --color-ink-subtle: 99 110 104;
  --color-line: 221 213 199;
  --color-line-strong: 127 135 129;
  --color-primary: 31 111 92;
  --color-primary-pressed: 23 85 70;
  --color-on-primary: 255 255 255;
  --color-primary-soft: 227 241 236;
  --color-on-primary-soft: 20 80 67;
  --color-secondary: 138 79 46;
  --color-on-secondary: 255 255 255;
  --color-accent: 217 162 58;
  --color-on-accent: 43 30 5;
  --color-accent-ink: 138 95 18;
  --color-success: 37 107 66;
  --color-on-success: 255 255 255;
  --color-success-soft: 227 243 232;
  --color-on-success-soft: 30 90 55;
  --color-warning: 138 83 0;
  --color-on-warning: 255 255 255;
  --color-warning-soft: 255 241 214;
  --color-on-warning-soft: 107 65 0;
  --color-danger: 179 54 43;
  --color-on-danger: 255 255 255;
  --color-danger-soft: 252 232 229;
  --color-on-danger-soft: 140 42 34;
  --color-info: 47 102 144;
  --color-on-info: 255 255 255;
  --color-info-soft: 227 238 247;
  --color-on-info-soft: 35 77 109;
  --color-focus: 47 102 144;
  --color-plate-veg: 63 138 88;
  --color-plate-protein: 180 87 63;
  --color-plate-carb: 176 122 28;
  --color-water: 47 125 179;
  --color-plate-space: 230 224 211;
}
.dark:root {
  --color-surface: 15 21 19;
  --color-surface-raised: 24 32 29;
  --color-surface-sunken: 33 43 39;
  --color-ink: 236 239 234;
  --color-ink-muted: 180 190 184;
  --color-ink-subtle: 141 152 146;
  --color-line: 44 54 50;
  --color-line-strong: 110 122 116;
  --color-primary: 92 195 166;
  --color-primary-pressed: 125 211 186;
  --color-on-primary: 8 32 26;
  --color-primary-soft: 22 58 49;
  --color-on-primary-soft: 168 227 209;
  --color-secondary: 227 154 114;
  --color-on-secondary: 42 19 7;
  --color-accent: 232 182 90;
  --color-on-accent: 43 30 5;
  --color-accent-ink: 232 182 90;
  --color-success: 108 203 142;
  --color-on-success: 11 38 21;
  --color-success-soft: 19 48 31;
  --color-on-success-soft: 163 224 184;
  --color-warning: 240 180 76;
  --color-on-warning: 46 30 0;
  --color-warning-soft: 58 44 16;
  --color-on-warning-soft: 246 205 130;
  --color-danger: 242 135 124;
  --color-on-danger: 43 8 5;
  --color-danger-soft: 58 23 20;
  --color-on-danger-soft: 247 176 168;
  --color-info: 125 183 227;
  --color-on-info: 10 31 48;
  --color-info-soft: 20 43 61;
  --color-on-info-soft: 169 209 240;
  --color-focus: 125 183 227;
  --color-plate-veg: 108 191 133;
  --color-plate-protein: 229 142 116;
  --color-plate-carb: 226 180 86;
  --color-water: 108 178 230;
  --color-plate-space: 58 68 63;
}
```

The CSS block above is generated from `tokens.ts` by `pnpm --filter @thuluth/config gen:css` (checked in; CI fails if it is stale). On native, `ThemeProvider` overrides these defaults with `vars()` so that calm themes work without extra CSS selectors.

### 11.5 Theme provider

```tsx
// apps/mobile/src/theme/theme-provider.tsx
import { useEffect, type ReactNode } from 'react';
import { View, useColorScheme } from 'react-native';
import { vars, useColorScheme as useNwColorScheme } from 'nativewind';
import { cssVarsFor, type ThemeName } from '@thuluth/config/tokens';
import { usePreferencesStore } from '@/stores/preferences-store';

const themeVars: Record<ThemeName, ReturnType<typeof vars>> = {
  light: vars(cssVarsFor('light')),
  dark: vars(cssVarsFor('dark')),
  calmLight: vars(cssVarsFor('calmLight')),
  calmDark: vars(cssVarsFor('calmDark')),
};

export function resolveThemeName(scheme: 'light' | 'dark', calm: boolean): ThemeName {
  if (calm) return scheme === 'dark' ? 'calmDark' : 'calmLight';
  return scheme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pref = usePreferencesStore((s) => s.theme);          // 'system' | 'light' | 'dark'
  const calm = usePreferencesStore((s) => s.sensoryCalm);
  const system = useColorScheme() ?? 'light';
  const scheme: 'light' | 'dark' = pref === 'system' ? system : pref;
  const { setColorScheme } = useNwColorScheme();

  // Keep NativeWind's scheme in sync so any `dark:` variants (rare) also resolve.
  useEffect(() => { setColorScheme(scheme); }, [scheme, setColorScheme]);

  const name = resolveThemeName(scheme, calm);
  return (
    <View style={[{ flex: 1 }, themeVars[name]]} className="bg-surface">
      {children}
    </View>
  );
}
```

`use-theme-colors.ts` returns `colors[resolveThemeName(scheme, calm)]` for SVG and chart libraries, and builds the React Navigation theme (`colors.background = surface`, `card = surface-raised`, `text = ink`, `border = line`, `primary = primary`, `notification = danger`). The `calm` root class described in `08-component-architecture.md` §10.2 is realised by this variable swap; components needing behaviour changes read `sensoryCalm` through `useMotionPreference()` and `useHaptics()`.

### 11.6 Contrast check script

```ts
// packages/config/scripts/check-contrast.ts  (run in CI: pnpm --filter @thuluth/config test:contrast)
import { colors, type ColorToken, type ThemeName } from '../src/tokens';

const lum = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT: ColorToken[] = ['ink', 'ink-muted', 'ink-subtle', 'primary', 'accent-ink', 'success', 'warning', 'danger', 'info'];
const SURFACES: ColorToken[] = ['surface', 'surface-raised', 'surface-sunken'];
const ON_PAIRS: Array<[ColorToken, ColorToken]> = [
  ['on-primary', 'primary'], ['on-primary', 'primary-pressed'], ['on-secondary', 'secondary'], ['on-accent', 'accent'],
  ['on-success', 'success'], ['on-warning', 'warning'], ['on-danger', 'danger'], ['on-info', 'info'],
  ['on-primary-soft', 'primary-soft'], ['on-success-soft', 'success-soft'], ['on-warning-soft', 'warning-soft'],
  ['on-danger-soft', 'danger-soft'], ['on-info-soft', 'info-soft'],
];
const GRAPHICS: ColorToken[] = ['line-strong', 'focus', 'plate-veg', 'plate-protein', 'plate-carb', 'water'];

let failures = 0;
for (const theme of Object.keys(colors) as ThemeName[]) {
  const c = colors[theme];
  const check = (fg: ColorToken, bg: ColorToken, min: number) => {
    const r = ratio(c[fg], c[bg]);
    if (r < min) { failures++; console.error(`${theme}: ${fg} on ${bg} = ${r.toFixed(2)} < ${min}`); }
  };
  for (const fg of TEXT) for (const bg of SURFACES) check(fg, bg, 4.5);
  for (const [fg, bg] of ON_PAIRS) check(fg, bg, 4.5);
  for (const g of GRAPHICS) { check(g, 'surface', 3); check(g, 'surface-raised', 3); }
}
if (failures) process.exit(1);
console.log('All contrast checks passed');
```

---

## 12. Dark mode strategy

1. **Semantic tokens only.** Components never reference hex values or ramp steps; the four token sets in §3.3 are swapped at the root (§11.5). This is why `dark:` variants are rarely needed.
2. **User choice** in Settings > Accessibility and display: System (default), Light, Dark (`usePreferencesStore.theme`, device-level).
3. **Surfaces get lighter as they rise** (`surface` `#0F1513` → `surface-raised` `#18201D` → `surface-sunken` `#212B27` is used for inputs, which read as recessed through their border); shadows are replaced by a `line` border (§7.3).
4. **Saturation is reduced** for large fills and increased in lightness for text and marks so they meet contrast on dark surfaces (for example primary `#1F6F5C` → `#5CC3A6`), with dark text on bright fills (`on-primary` `#08201A`).
5. **Images:** recipe photos get a 6 percent black overlay in dark mode to reduce glare; illustrations swap palettes through tokens; the logo uses the `inverse` tone.
6. **Charts** use dark-mode token values from `useThemeColors()`; percentile bands keep their relative opacity.
7. **Status bar and navigation bar:** `expo-status-bar` style follows the resolved scheme; Android navigation bar colour is set to `surface-raised` with `expo-navigation-bar`.
8. **PDF exports** are always rendered in light theme (`18-exports-and-analytics.md`).
9. **Testing:** every Storybook story renders in light, dark, calm light and calm dark (four-way decorator); screenshot tests cover the top 20 screens in light and dark (`21-testing-strategy.md`).

---

## 13. RTL rules

The mechanics (`I18nManager.forceRTL`, reload on direction change, ESLint ban on physical utilities) are defined in `08-component-architecture.md` §10.3. Design rules:

1. **Logical properties everywhere:** `ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `text-start`, `text-end`, `rounded-s-*`, `rounded-e-*`, `border-s`, `border-e`. Specs in this document and in `02-ux-specification.md` say "start" and "end", never "left" and "right", except for physical exceptions listed below.
2. **What mirrors:** layout order (rows, tab order is kept by the platform), navigation back affordance, chevrons and arrows, progress direction of linear progress bars and steppers, swipe directions (swipe toward the end edge to act), the logical-end corner of the user chat bubble, the sticky day column in the plan grid, food-chaining arrows, sliders.
3. **What does not mirror:** charts' time axis (left to right in both, per 08), clocks and timers, media controls, numbers and units, phone numbers, the logo lock-up internals, the plate diagram (segments keep fixed positions so the same "half vegetables" area is recognisable across languages), Qur'anic and Arabic text (always RTL regardless of UI), checkmarks.
4. **Progress rings** fill clockwise in both directions (platform convention for circular progress).
5. **Numbers:** Western digits in both locales in v1; numerals, prices, quantities and times are LTR-isolated within RTL runs; units follow the number in reading order ("2 کلو"). Percent sign follows locale formatting (`Intl.NumberFormat('ur-PK', { style: 'percent' })`).
6. **Mixed-direction strings:** i18n interpolations wrap variables in FSI/PDI isolates; member names may be in Latin or Urdu script and must not flip surrounding punctuation.
7. **Nastaliq vertical metrics:** see §5.3; every RTL screenshot is also a Nastaliq clipping test.
8. **Icons with text direction meaning** (list-bullets, text-align, reply, send, undo/redo) mirror; icons depicting real objects (glass, plate, basket, sprout) do not.
9. **Gestures:** back-swipe edge is the platform's leading edge (right edge in RTL on iOS); horizontal carousels start at the logical start.
10. **Keyboard and input:** email, numeric, OTP and URL inputs are forced LTR (`writingDirection: 'ltr'`, `textAlign: 'left'` physical exception) in Urdu; free-text inputs follow the content direction (`textAlign: 'auto'` behaviour via `writingDirection` from the first strong character).

---

## 14. Accessibility

Targets WCAG 2.2 AA equivalents for mobile; patterns and lint rules are in `08-component-architecture.md` §11. Design-level requirements:

| Area | Requirement |
|---|---|
| Dynamic type | All text uses `Text` variants that scale with the OS setting up to the per-variant `maxMultiplier` (§5.2). Layouts are verified at 200 percent: rows grow, buttons wrap to two lines, horizontal chip rows wrap, tab labels may truncate with full label in a11y. Fixed heights are banned for text containers. Settings offer +1/+2 app-level steps on top of the OS setting. |
| Screen readers | VoiceOver and TalkBack parity. Each screen has one `header` element first; cards with a single action are one focusable element with a composed label; secondary actions use `accessibilityActions`. Rings, bars and charts expose a summary label and a table alternative. Streaming chat announces per sentence (`02-ux-specification.md` §7.7.2). Arabic runs set `accessibilityLanguage="ar"`, Urdu UI sets `ur`. |
| Touch targets | Minimum 44 x 44pt on iOS and 48 x 48dp on Android; components default to 48 (08). Small visual controls (chips 32, icon buttons 40) use `hitSlop` to reach the minimum. Adjacent targets are separated by at least 8pt. Shopping mode uses 64pt rows. |
| Colour independence | Status always has icon + text; plate segments have patterns and labels; selected chips show a check; errors show icon + text; charts are labelled directly where possible. Verified with deuteranopia, protanopia, tritanopia and greyscale simulations in Storybook. |
| Contrast | §4.3; checked in CI. |
| Focus | Visible 2pt `focus` ring with 2pt offset for keyboard, switch control and external keyboard users (iPad); logical focus order follows reading order in both directions. |
| Haptics | `selection` for chip toggles and pickers, `success` for completing a meal log, a grocery trip or a measurement, `warning` never used for food or body events. All haptics respect the OS setting and are off in Sensory-calm mode or when `usePreferencesStore.haptics` is false. Haptics never carry information alone. |
| Motion | §8.3; reduced motion honoured from OS and forced in calm mode. |
| Time limits | No timed interactions except OTP expiry (10 minutes, with resend) and paywall purchase sheets controlled by the store. Toasts with actions stay at least 4 seconds and the action is also available elsewhere (for example Undo in the meal detail). |
| Cognitive load | One primary action per screen, plain language at about a 6th-grade reading level in English, consistent placement of primary actions (bottom), no carousels for essential info in calm mode, explicit labels instead of icon-only controls in the tab bar. |
| Autism-friendly | Predictable layouts, no surprise sounds or animations, literal copy, preview of what happens next in multi-step flows, the ability to pause any module. |
| Forms | Labels above fields, errors inline and announced, first invalid field focused on submit, no placeholder-only labels, input types and autofill hints set (`textContentType`, `autoComplete`). |

---

## 15. Reconciliation with 08 and proposed additions

These are design-system items that `08-component-architecture.md` should adopt or confirm. None of them adds a database table, column or Edge Function.

| # | Item | Proposal |
|---|---|---|
| 1 | Colour tokens | Keep 08's names; add `surface-sunken`, `ink-subtle`, `line-strong`, `primary-pressed`, `primary-soft`, `on-primary-soft`, `secondary`, `on-secondary`, `accent`, `on-accent`, `accent-ink`, `on-success`, `on-warning`, `on-danger`, `on-info`, the four `*-soft` / `on-*-soft` pairs, `focus` and `plate-space`. `water` is the fluid-third colour (task brief calls it "fluid"). |
| 2 | Calm theme mechanism | 08 §10.2 says a `calm` class is added at the root; this document implements the palette swap with NativeWind `vars()` (§11.5), which works on native without custom class selectors. Behavioural changes read `sensoryCalm` via hooks. |
| 3 | Font family keys | 08 lists `ui`, `urdu`, `arabic`; add `quran` (Amiri Quran for Qur'anic text) and weight-specific keys (`ui-medium`, `ui-semibold`, `ui-bold`, `ui-display`, `urdu-bold`, `arabic-bold`). |
| 4 | Preset path | 08 places the preset at `packages/config/tailwind/preset.js`; this document keeps that and adds `packages/config/src/tokens.ts` compiled to `dist/tokens.cjs`. |
| 5 | `AcceptanceScorePicker.variant = 'faces'` | Visual has no faces (§2.3 rule 1). Suggest renaming the value to `'icons'` in 08; until then `'faces'` renders icons. Add `readOnly?: boolean`. |
| 6 | `MealCard` | Add `density?: 'default' \| 'cell'` for `PlanWeekGrid`. |
| 7 | `GrowthChart.percentileCurves` | Extend the percentile union with 5, 10, 25, 75, 90, 95 for CDC charts. |
| 8 | `PaywallSheet.trigger` | Extend the union with `plan_multi_week`, `plan_adjust`, `grocery_optimize`, `sensory_profile`, `picky_coaching`, `insights`, `household_limit`, `member_limit` (used by `02-ux-specification.md` §3.3). |
| 9 | Touch target | Task brief and iOS HIG: 44pt minimum; 08: 48dp default. Both hold: 44pt is the floor, 48 the component default. |
| 10 | Proposed components | All rows marked "Proposed" in §10.2 to §10.4 (for example `ThirdsKeptPicker`, `PortionTable`, `SafetyBanner`, `ScholarNotice`, `DisclaimerFooter`, `QuoteCard`, `PlanGenerationStepper`, `FastingTimer`, `FoodChainBuilder`, `PlanOptionCard`, `OfflineBanner`, `QueuedBadge`). |
