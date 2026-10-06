/**
 * Lock-screen-safe notification copy (FR-NOT-06) and deep links (FR-NOT-04, 02 §3.4).
 *
 * Rules for every template: no condition names, no measurements, no allergens, no names of
 * family members, nothing that tells a bystander about anyone's health. Details live behind the
 * deep link, inside the app. `FORBIDDEN_TERMS` backs the lint test in
 * `tests/functions/notifications-dispatch.test.ts`. Urdu copy awaits the native review (S4-19).
 */

export type Locale = 'en' | 'ur';

export type TemplateKey =
  | 'daily_plan'
  | 'meal_reminder'
  | 'hydration_reminder'
  | 'plan_ready'
  | 'plan_failed'
  | 'suhoor_reminder'
  | 'iftar_reminder'
  | 'fasting_sunnah_reminder.evening'
  | 'fasting_sunnah_reminder.suhoor'
  | 'billing_issue'
  | 'growth_alert'
  | 'export_ready'
  | 'export_ready.account'
  | 'billing_issue.ai_memory';

interface Copy {
  title: string;
  body: string;
}

export const TEMPLATES: Record<TemplateKey, Record<Locale, Copy>> = {
  daily_plan: {
    en: { title: "Today's plan is ready", body: "Open Thuluth to see today's meals." },
    ur: { title: 'آج کا پلان تیار ہے', body: 'آج کے کھانے دیکھنے کے لیے ثلث کھولیں۔' },
  },
  meal_reminder: {
    en: { title: '{meal} in {minutes} minutes', body: "Tap to see what's on the menu." },
    ur: { title: '{minutes} منٹ میں {meal}', body: 'آج کا مینو دیکھنے کے لیے ٹیپ کریں۔' },
  },
  hydration_reminder: {
    en: { title: 'Time for a glass of water', body: 'A glass now, before the meal.' },
    ur: { title: 'پانی کا وقت', body: 'کھانے سے پہلے ایک گلاس پانی۔' },
  },
  plan_ready: {
    en: { title: 'Your meal plan is ready', body: 'Tap to review it.' },
    ur: { title: 'آپ کا کھانے کا پلان تیار ہے', body: 'دیکھنے کے لیے ٹیپ کریں۔' },
  },
  plan_failed: {
    en: { title: 'We could not finish your plan', body: 'Tap to see what to do next.' },
    ur: { title: 'پلان مکمل نہیں ہو سکا', body: 'آگے کیا کرنا ہے، دیکھنے کے لیے ٹیپ کریں۔' },
  },
  suhoor_reminder: {
    en: { title: 'Suhoor time', body: 'Suhoor ends at {time}.' },
    ur: { title: 'سحری کا وقت', body: 'سحری {time} پر ختم ہوگی۔' },
  },
  iftar_reminder: {
    en: { title: 'Iftar soon', body: 'Iftar is at {time}.' },
    ur: { title: 'افطار قریب ہے', body: 'افطار {time} پر ہے۔' },
  },
  'fasting_sunnah_reminder.evening': {
    en: { title: '{fast} tomorrow', body: 'An optional fast tomorrow, if you wish.' },
    ur: { title: 'کل {fast}', body: 'کل نفلی روزہ، اگر آپ چاہیں۔' },
  },
  'fasting_sunnah_reminder.suhoor': {
    en: { title: 'Suhoor for {fast}', body: 'Suhoor ends at {time}.' },
    ur: { title: '{fast} کی سحری', body: 'سحری {time} پر ختم ہوگی۔' },
  },
  // revenuecat-webhook (17 §10.2): grace period or billing retry. No amounts, no plan names.
  billing_issue: {
    en: {
      title: "Your payment didn't go through",
      body: 'Update your payment in your store settings to keep Premium.',
    },
    ur: {
      title: 'آپ کی ادائیگی نہیں ہو سکی',
      body: 'پریمیم جاری رکھنے کے لیے اسٹور کی سیٹنگز میں ادائیگی اپ ڈیٹ کریں۔',
    },
  },
  // growth-compute (06 §4.15, safety, every tier). Says nothing about whose measurement or why.
  growth_alert: {
    en: {
      title: 'Please check a recent update',
      body: 'Open Thuluth to see a suggestion for your family.',
    },
    ur: {
      title: 'براہِ کرم ایک تازہ اپ ڈیٹ دیکھیں',
      body: 'اپنے خاندان کے لیے ایک مشورہ دیکھنے کے لیے ثلث کھولیں۔',
    },
  },
  // 17 §10.3: AI memories are deleted 12 months after premium lapsed; notice 30 days before. Sent under
  // the existing `billing_issue` kind (no new notification_kinds() value needed).
  'billing_issue.ai_memory': {
    en: {
      title: 'Saved chat memories will be removed soon',
      body: 'Renew Premium within 30 days to keep what Thuluth remembers for your family.',
    },
    ur: {
      title: 'محفوظ چیٹ یادیں جلد ختم ہو جائیں گی',
      body: 'ثلث کو آپ کے خاندان کے بارے میں جو یاد ہے اسے رکھنے کے لیے 30 دن کے اندر پریمیم دوبارہ لیں۔',
    },
  },
  // export-pdf (async path) and account-export (06 §4.15).
  export_ready: {
    en: { title: 'Your PDF is ready', body: 'Tap to open or share it.' },
    ur: { title: 'آپ کی پی ڈی ایف تیار ہے', body: 'کھولنے یا شیئر کرنے کے لیے ٹیپ کریں۔' },
  },
  'export_ready.account': {
    en: {
      title: 'Your data download is ready',
      body: 'Sign in to Thuluth to download it within 24 hours.',
    },
    ur: {
      title: 'آپ کا ڈیٹا ڈاؤن لوڈ کے لیے تیار ہے',
      body: '24 گھنٹوں کے اندر ڈاؤن لوڈ کرنے کے لیے ثلث میں سائن ان کریں۔',
    },
  },
};

/** Meal names by `meal_type`. */
export const MEAL_LABELS: Record<string, Record<Locale, string>> = {
  breakfast: { en: 'Breakfast', ur: 'ناشتہ' },
  lunch: { en: 'Lunch', ur: 'دوپہر کا کھانا' },
  dinner: { en: 'Dinner', ur: 'رات کا کھانا' },
  snack: { en: 'Snack', ur: 'ہلکا ناشتہ' },
  suhoor: { en: 'Suhoor', ur: 'سحری' },
  iftar: { en: 'Iftar', ur: 'افطار' },
};

/** Voluntary fast names by `VoluntaryFast.label_key` (`prayer/voluntary-fasts.ts`). */
export const FAST_LABELS: Record<string, Record<Locale, string>> = {
  'fast.monday': { en: 'Monday fast', ur: 'پیر کا روزہ' },
  'fast.thursday': { en: 'Thursday fast', ur: 'جمعرات کا روزہ' },
  'fast.ayyam_al_bid': { en: 'Ayyam al-Bid fast', ur: 'ایام البیض کا روزہ' },
  'fast.arafah': { en: 'Day of Arafah fast', ur: 'یوم عرفہ کا روزہ' },
  'fast.ashura': { en: 'Ashura fast', ur: 'عاشورہ کا روزہ' },
  'fast.ashura_companion_9': { en: '9 Muharram fast', ur: 'نو محرم کا روزہ' },
  'fast.ashura_companion_11': { en: '11 Muharram fast', ur: 'گیارہ محرم کا روزہ' },
};

/** Never on a lock screen (FR-NOT-06). Lower-case substrings, English copy. */
export const FORBIDDEN_TERMS = [
  'diabet',
  'insulin',
  'pregnan',
  'breastfeed',
  'allerg',
  'anaemi',
  'anemi',
  'iron',
  'weight',
  'bmi',
  'obes',
  'underweight',
  'stunt',
  'growth',
  'condition',
  'disease',
  'blood',
  'medic',
  'celiac',
  'coeliac',
  'kidney',
  'heart',
  'symptom',
  'red flag',
  'kg',
] as const;

export type TemplateVars = Record<string, string | number>;

export function normaliseLocale(locale: string | null | undefined): Locale {
  return (locale ?? '').toLowerCase().startsWith('ur') ? 'ur' : 'en';
}

function fill(text: string, vars: TemplateVars): string {
  const out = text.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`Template variable ${k} missing`);
    return String(v);
  });
  return out;
}

/** Localised variables: `meal` and `fast` are label keys resolved per locale. */
function localVars(vars: TemplateVars, locale: Locale): TemplateVars {
  const out: TemplateVars = { ...vars };
  if (typeof vars.meal === 'string') out.meal = MEAL_LABELS[vars.meal]?.[locale] ?? vars.meal;
  if (typeof vars.fast === 'string') out.fast = FAST_LABELS[vars.fast]?.[locale] ?? vars.fast;
  return out;
}

export interface RenderedCopy {
  headings: Record<Locale, string>;
  contents: Record<Locale, string>;
}

export function render(key: TemplateKey, vars: TemplateVars = {}): RenderedCopy {
  const t = TEMPLATES[key];
  const en = localVars(vars, 'en');
  const ur = localVars(vars, 'ur');
  return {
    headings: { en: fill(t.en.title, en).slice(0, 120), ur: fill(t.ur.title, ur).slice(0, 120) },
    contents: { en: fill(t.en.body, en).slice(0, 500), ur: fill(t.ur.body, ur).slice(0, 500) },
  };
}

/** Deep link per kind (02 §3.4). Every dispatched kind maps to a route (FR-NOT-04). */
export function routeFor(
  key: TemplateKey,
  ids: {
    daily_meal_id?: string;
    meal_plan_id?: string;
    family_member_id?: string;
    export_id?: string;
  } = {},
): string {
  switch (key) {
    case 'daily_plan':
      return 'thuluth://today';
    case 'meal_reminder':
      return ids.daily_meal_id ? `thuluth://meal/${ids.daily_meal_id}` : 'thuluth://today';
    case 'hydration_reminder':
      return 'thuluth://hydration';
    case 'plan_ready':
    case 'plan_failed':
      return ids.meal_plan_id ? `thuluth://plan/${ids.meal_plan_id}` : 'thuluth://plans';
    case 'suhoor_reminder':
    case 'iftar_reminder':
      return 'thuluth://ramadan';
    case 'fasting_sunnah_reminder.evening':
    case 'fasting_sunnah_reminder.suhoor':
      return 'thuluth://fasting';
    case 'billing_issue':
    case 'billing_issue.ai_memory':
      return 'thuluth://settings/subscription';
    case 'growth_alert':
      return ids.family_member_id ? `thuluth://growth/${ids.family_member_id}` : 'thuluth://growth';
    case 'export_ready':
      return ids.export_id ? `thuluth://exports/${ids.export_id}` : 'thuluth://exports';
    case 'export_ready.account':
      return 'thuluth://settings/privacy';
  }
}

export const kindOf = (key: TemplateKey): string => key.split('.')[0]!;

/** A ready-to-insert `notifications` row (status `pending`). */
export interface NotificationRow {
  user_id: string;
  household_id: string | null;
  channel: 'push';
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  scheduled_for: string;
  dedupe_key: string;
}

/**
 * Builds the row: title and body in the recipient's locale; both languages and the route in
 * `data` (`route` for the inbox, 02 §7.13.1; `deeplink` as in the 05 §13.2 column comment).
 */
export function notificationRow(input: {
  key: TemplateKey;
  user_id: string;
  household_id: string | null;
  locale: string | null | undefined;
  scheduled_for: Date;
  dedupe_key: string;
  vars?: TemplateVars;
  route: string;
  data?: Record<string, unknown>;
}): NotificationRow {
  const copy = render(input.key, input.vars);
  const locale = normaliseLocale(input.locale);
  return {
    user_id: input.user_id,
    household_id: input.household_id,
    channel: 'push',
    kind: kindOf(input.key),
    title: copy.headings[locale],
    body: copy.contents[locale],
    data: {
      ...input.data,
      template: input.key,
      route: input.route,
      deeplink: input.route,
      headings: copy.headings,
      contents: copy.contents,
    },
    scheduled_for: input.scheduled_for.toISOString(),
    dedupe_key: input.dedupe_key,
  };
}
