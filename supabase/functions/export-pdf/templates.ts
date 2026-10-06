import type { ExportPaper } from '@thuluth/shared/contracts/export-pdf.ts';

import { STRINGS, t } from './i18n.ts';
import type { ExportLocale } from './i18n.ts';

/**
 * HTML templates for the MVP export kinds (18 §3 to §5, S6-08). Plain template strings with
 * escaping instead of Preact SSR (deviation from 18 §2: no npm render dependency in the function);
 * every interpolated value goes through `esc`, and the renderer runs without network, so injected
 * markup can neither execute nor fetch (AC-E7). One stylesheet serves both directions through CSS
 * logical properties; Urdu uses Noto Nastaliq Urdu (installed in the renderer image) with a tall
 * line height. Charts are inline SVG and keep age left to right in both directions (18 §5).
 */

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** User-entered text inside the other direction (names, English food names in Urdu). */
const bdi = (v: unknown) => `<bdi>${esc(v)}</bdi>`;

const PAGE: Record<ExportPaper, string> = { A4: 'A4', Letter: 'letter' };

function styles(locale: ExportLocale, paper: ExportPaper, marginMm: number): string {
  const ur = locale === 'ur';
  return `
@page { size: ${PAGE[paper]} portrait; margin: ${marginMm}mm; }
:root { --ink: #1f2a24; --muted: #5b6b62; --line: #d9e1dc; --brand: #2f6b4f; --warn: #8a4b00; }
* { box-sizing: border-box; }
html { font-size: 10pt; }
body { margin: 0; color: var(--ink);
  font-family: ${ur ? "'Noto Nastaliq Urdu', 'Noto Naskh Arabic', " : ''}'Inter', 'Noto Sans', 'DejaVu Sans', sans-serif;
  line-height: ${ur ? '2.1' : '1.45'}; }
.ar { font-family: 'Amiri', 'Noto Naskh Arabic', serif; direction: rtl; }
h1 { font-size: 18pt; margin: 0 0 2mm; color: var(--brand); }
h2 { font-size: 13pt; margin: 6mm 0 2mm; border-block-end: 1px solid var(--line); }
h3 { font-size: 11pt; margin: 4mm 0 1mm; }
header.doc { border-block-end: 2px solid var(--brand); padding-block-end: 3mm; margin-block-end: 4mm; }
header.doc .sub { color: var(--muted); }
table { width: 100%; border-collapse: collapse; margin-block: 2mm; }
th, td { text-align: start; padding: 1.2mm 2mm; border-block-end: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); }
td.num { font-variant-numeric: tabular-nums; }
.box { display: inline-block; width: 3.5mm; height: 3.5mm; border: 1px solid var(--ink); margin-inline-end: 2mm; }
.day { break-inside: avoid; margin-block-end: 3mm; }
.week { break-before: page; }
.week:first-of-type { break-before: auto; }
.meal { margin-block: 1mm; padding-inline-start: 3mm; border-inline-start: 2px solid var(--line); }
.meal .type { color: var(--muted); }
.adapt { color: var(--muted); font-size: 9pt; }
.tag { font-size: 8pt; color: var(--brand); margin-inline-start: 1mm; }
.alert { color: var(--warn); }
.note-lines div { border-block-end: 1px solid var(--line); height: 8mm; }
footer.doc { margin-block-start: 8mm; padding-block-start: 2mm; border-block-start: 1px solid var(--line);
  color: var(--muted); font-size: 8.5pt; }
svg text { font-family: 'Inter', 'Noto Sans', sans-serif; font-size: 7pt; fill: var(--muted); }
`;
}

function document(opts: {
  locale: ExportLocale;
  paper: ExportPaper;
  title: string;
  body: string;
  generatedOn: string;
  marginMm?: number;
}): string {
  const s = STRINGS[opts.locale];
  const dir = opts.locale === 'ur' ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${opts.locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="author" content="Thuluth">
<title>${esc(opts.title)}</title>
<style>${styles(opts.locale, opts.paper, opts.marginMm ?? 14)}</style>
</head>
<body>
${opts.body}
<footer class="doc">
<p>${esc(t(s, 'generated_by', { date: opts.generatedOn }))}</p>
<p>${esc(s.disclaimer)}</p>
</footer>
</body>
</html>`;
}

const fmtDate = (iso: string, locale: ExportLocale) =>
  new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

const fmtWeekday = (iso: string, locale: ExportLocale) =>
  new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

function fmtMoney(minor: number, currency: string, locale: ExportLocale): string {
  const digits = currency === 'PKR' ? 0 : 2;
  return new Intl.NumberFormat(locale === 'ur' ? 'ur-PK' : 'en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 100);
}

// ---- meal_plan (18 §4.1) --------------------------------------------------------------------------

export interface MealPlanView {
  householdName: string;
  title: string | null;
  startDate: string;
  endDate: string;
  members: Array<{ id: string; name: string }>;
  meals: Array<{
    plan_date: string;
    meal_type: string;
    slot: number;
    scheduled_time: string | null;
    title: string;
    notes: string | null;
    servings: Array<{ family_member_id: string; adaptation: string }>;
  }>;
  includeRecipes: boolean;
  includeSources: boolean;
}

export function mealPlanHtml(
  v: MealPlanView,
  locale: ExportLocale,
  paper: ExportPaper,
  today: string,
): string {
  const s = STRINGS[locale];
  const names = new Map(v.members.map((m) => [m.id, m.name]));
  const days = [...new Set(v.meals.map((m) => m.plan_date))].sort();
  const dates: string[] = [];
  for (let d = v.startDate; d <= v.endDate; d = addDays(d, 1)) dates.push(d);
  const weeks: string[][] = [];
  dates.forEach((d, i) => {
    (weeks[Math.floor(i / 7)] ??= []).push(d);
  });
  const dayHtml = (d: string) => {
    const meals = v.meals
      .filter((m) => m.plan_date === d)
      .sort(
        (a, b) => (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? '') || a.slot - b.slot,
      );
    const items = meals.length
      ? meals
          .map((m) => {
            // Household measures and adaptations only: never grams or kcal (18 §3 child data).
            const adapt = m.servings
              .filter((x) => x.adaptation && x.adaptation !== 'none')
              .map(
                (x) =>
                  `${bdi(names.get(x.family_member_id) ?? '')}: ${esc(x.adaptation.replace(/_/g, ' '))}`,
              )
              .join(' · ');
            return `<div class="meal"><span class="type">${esc(s.meal_types[m.meal_type] ?? m.meal_type)}${
              m.scheduled_time ? ` · ${esc(m.scheduled_time.slice(0, 5))}` : ''
            }</span><br><strong>${bdi(m.title)}</strong>${
              adapt ? `<div class="adapt">${esc(s.adaptations)}: ${adapt}</div>` : ''
            }${m.notes ? `<div class="adapt">${esc(s.notes)}: ${esc(m.notes)}</div>` : ''}</div>`;
          })
          .join('')
      : `<p class="adapt">${esc(s.no_meals)}</p>`;
    return `<section class="day"><h3>${esc(fmtWeekday(d, locale))}</h3>${items}</section>`;
  };
  const body = `
<header class="doc">
<h1>${esc(v.title ?? s.meal_plan_title)}</h1>
<div class="sub">${bdi(v.householdName)} · ${esc(t(s, 'period', { from: fmtDate(v.startDate, locale), to: fmtDate(v.endDate, locale) }))}</div>
<div class="sub">${v.members.map((m) => bdi(m.name)).join(' · ')}</div>
</header>
${weeks
  .map((w, i) =>
    weeks.length > 1
      ? `<section class="week"><h2>${esc(t(s, 'week', { n: i + 1 }))}</h2>${w.map(dayHtml).join('')}</section>`
      : w.map(dayHtml).join(''),
  )
  .join('')}
${days.length && v.includeRecipes ? `<p class="adapt">${esc(s.recipes_note)}</p>` : ''}
${v.includeSources ? `<p class="adapt">${esc(s.sources_note)}</p>` : ''}`;
  return document({
    locale,
    paper,
    title: v.title ?? s.meal_plan_title,
    body,
    generatedOn: fmtDate(today, locale),
  });
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---- grocery_list (18 §4.2) -----------------------------------------------------------------------

export interface GroceryView {
  householdName: string;
  startsOn: string;
  endsOn: string;
  currency: string;
  estimatedTotalMinor: number;
  items: Array<{
    label: string;
    quantity: number;
    unit: string;
    aisle: string | null;
    category: string | null;
    estimated_minor: number | null;
    is_fresh: boolean;
    sort_order: number;
  }>;
  groupBy: 'aisle' | 'category';
}

const AISLE_ORDER = ['sabzi', 'fruit', 'meat', 'dairy', 'dry_goods', 'spices', 'other'];

export function groceryHtml(
  v: GroceryView,
  locale: ExportLocale,
  paper: ExportPaper,
  today: string,
): string {
  const s = STRINGS[locale];
  const key = (i: GroceryView['items'][number]) =>
    (v.groupBy === 'category' ? i.category : i.aisle) ?? i.aisle ?? 'other';
  const groups = new Map<string, GroceryView['items']>();
  for (const i of v.items) groups.set(key(i), [...(groups.get(key(i)) ?? []), i]);
  const order = [...groups.keys()].sort(
    (a, b) =>
      ((AISLE_ORDER.indexOf(a) + 100) % 100) - ((AISLE_ORDER.indexOf(b) + 100) % 100) ||
      a.localeCompare(b),
  );
  const unknown = v.items.filter((i) => i.estimated_minor == null).length;
  const qty = (n: number) =>
    new Intl.NumberFormat(locale === 'ur' ? 'ur-PK' : 'en-GB', { maximumFractionDigits: 2 }).format(
      n,
    );
  const body = `
<header class="doc">
<h1>${esc(s.grocery_title)}</h1>
<div class="sub">${bdi(v.householdName)} · ${esc(t(s, 'period', { from: fmtDate(v.startsOn, locale), to: fmtDate(v.endsOn, locale) }))}</div>
<div class="sub">${esc(t(s, 'estimated_total', { amount: fmtMoney(v.estimatedTotalMinor, v.currency, locale) }))}</div>
</header>
${order
  .map(
    (g) => `<h2>${esc(s.aisles[g] ?? g.replace(/_/g, ' '))}</h2>
<table><thead><tr><th>${esc(s.item)}</th><th>${esc(s.quantity)}</th><th>${esc(s.price)}</th></tr></thead><tbody>
${groups
  .get(g)!
  .sort((a, b) => a.sort_order - b.sort_order)
  .map(
    (i) =>
      `<tr><td><span class="box"></span>${bdi(i.label)}${i.is_fresh ? `<span class="tag">${esc(s.fresh)}</span>` : ''}</td><td class="num">${esc(qty(i.quantity))}&nbsp;${esc(i.unit)}</td><td class="num">${
        i.estimated_minor == null ? '' : esc(fmtMoney(i.estimated_minor, v.currency, locale))
      }</td></tr>`,
  )
  .join('')}
</tbody></table>`,
  )
  .join('')}
${unknown ? `<p class="adapt">${esc(t(s, 'unknown_prices', { n: unknown }))}</p>` : ''}`;
  return document({
    locale,
    paper,
    title: s.grocery_title,
    body,
    generatedOn: fmtDate(today, locale),
    marginMm: 12,
  });
}

// ---- growth_report (18 §4.4) ----------------------------------------------------------------------

export interface GrowthReportView {
  householdName: string;
  memberName: string;
  dateOfBirth: string;
  reference: string | null;
  rows: Array<{
    measured_on: string;
    age_months: number | null;
    height_cm: number | null;
    weight_kg: number | null;
    bmi: number | null;
    height_for_age_z: number | null;
    weight_for_age_z: number | null;
    bmi_for_age_z: number | null;
    height_for_age_percentile: number | null;
    weight_for_age_percentile: number | null;
    bmi_for_age_percentile: number | null;
    flags: string[];
  }>;
  includeNotesForClinician: boolean;
}

const REF_LABEL: Record<string, string> = {
  who_2006: 'WHO Child Growth Standards 2006',
  who_2007: 'WHO Growth Reference 2007',
  cdc_2000: 'CDC 2000',
};

function zChart(rows: GrowthReportView['rows']): string {
  const pts = rows.filter(
    (r) => r.age_months != null && !r.flags.includes('implausible_measurement'),
  );
  if (!pts.length) return '';
  const W = 520;
  const H = 200;
  const pad = 28;
  const ages = pts.map((r) => r.age_months!);
  const a0 = Math.floor(Math.min(...ages));
  const a1 = Math.max(a0 + 1, Math.ceil(Math.max(...ages)));
  const x = (a: number) => pad + ((a - a0) / (a1 - a0)) * (W - 2 * pad);
  const y = (z: number) => H / 2 - (Math.max(-4, Math.min(4, z)) / 4) * (H / 2 - 10);
  const lines = [-3, -2, -1.88, 0, 1.88, 2, 3]
    .map(
      (z) =>
        `<line x1="${pad}" x2="${W - pad}" y1="${y(z).toFixed(1)}" y2="${y(z).toFixed(1)}" stroke="${
          z === 0 ? '#2f6b4f' : Math.abs(z) === 1.88 ? '#c9a14a' : '#d9e1dc'
        }" stroke-width="${z === 0 ? 1.2 : 0.8}"/><text x="2" y="${(y(z) + 2).toFixed(1)}">${z}</text>`,
    )
    .join('');
  const series = (key: 'weight_for_age_z' | 'height_for_age_z', color: string) => {
    const p = pts.filter((r) => r[key] != null);
    if (!p.length) return '';
    const path = p.map((r) => `${x(r.age_months!).toFixed(1)},${y(r[key]!).toFixed(1)}`).join(' ');
    return `<polyline fill="none" stroke="${color}" stroke-width="1.5" points="${path}"/>${p
      .map(
        (r) =>
          `<circle cx="${x(r.age_months!).toFixed(1)}" cy="${y(r[key]!).toFixed(1)}" r="2.2" fill="${color}"/>`,
      )
      .join('')}`;
  };
  // dir="ltr": age runs left to right in both locales (18 §5).
  return `<svg dir="ltr" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 14}" viewBox="0 0 ${W} ${H + 14}" role="img">${lines}${series(
    'weight_for_age_z',
    '#2f6b4f',
  )}${series('height_for_age_z', '#3d5a9e')}<text x="${pad}" y="${H + 10}">${a0} mo</text><text x="${W - pad - 20}" y="${H + 10}">${a1} mo</text></svg>`;
}

export function growthReportHtml(
  v: GrowthReportView,
  locale: ExportLocale,
  paper: ExportPaper,
  today: string,
): string {
  const s = STRINGS[locale];
  const zp = (z: number | null, p: number | null) =>
    z == null ? '' : `${z.toFixed(2)} / ${p == null ? '' : p.toFixed(1)}`;
  const age = (m: number | null) =>
    m == null
      ? ''
      : m < 24
        ? t(s, 'months', { n: Math.floor(m) })
        : t(s, 'years_months', { y: Math.floor(m / 12), m: Math.floor(m % 12) });
  const alerts = v.rows.flatMap((r) =>
    r.flags.map((f) => ({ date: r.measured_on, code: f.replace(/^red_flag\./, '') })),
  );
  const body = `
<header class="doc">
<h1>${esc(s.growth_title)}: ${bdi(v.memberName)}</h1>
<div class="sub">${esc(s.for_parents)} · ${esc(s.screening)}</div>
<div class="sub">${esc(t(s, 'born', { date: fmtDate(v.dateOfBirth, locale) }))}${
    v.reference
      ? ` · ${esc(t(s, 'reference', { ref: REF_LABEL[v.reference] ?? v.reference }))}`
      : ''
  }</div>
</header>
<h2>${esc(s.chart_title)}</h2>
${zChart(v.rows)}
<table><thead><tr><th>${esc(s.measured_on)}</th><th>${esc(s.age)}</th><th>${esc(s.height)}</th><th>${esc(s.weight)}</th><th>${esc(s.bmi)}</th><th>${esc(s.hfa)}<br>${esc(s.z_pct)}</th><th>${esc(s.wfa)}<br>${esc(s.z_pct)}</th><th>${esc(s.bfa)}<br>${esc(s.z_pct)}</th></tr></thead><tbody>
${v.rows
  .map(
    (r) =>
      `<tr><td>${esc(fmtDate(r.measured_on, locale))}</td><td>${esc(age(r.age_months))}</td><td class="num">${esc(r.height_cm ?? '')}</td><td class="num">${esc(
        r.weight_kg ?? '',
      )}</td><td class="num">${esc(r.bmi ?? '')}</td><td class="num">${esc(zp(r.height_for_age_z, r.height_for_age_percentile))}</td><td class="num">${esc(
        zp(r.weight_for_age_z, r.weight_for_age_percentile),
      )}</td><td class="num">${esc(zp(r.bmi_for_age_z, r.bmi_for_age_percentile))}${
        r.flags.includes('implausible_measurement')
          ? ` <span class="alert">(${esc(s.excluded)})</span>`
          : ''
      }</td></tr>`,
  )
  .join('')}
</tbody></table>
<h2>${esc(s.alerts)}</h2>
${
  alerts.length
    ? `<ul>${alerts.map((a) => `<li class="alert">${esc(fmtDate(a.date, locale))}: ${esc(s.flags[a.code] ?? a.code)}</li>`).join('')}</ul>`
    : `<p>${esc(s.no_alerts)}</p>`
}
${
  v.includeNotesForClinician
    ? `<h2>${esc(s.clinician_notes)}</h2><div class="note-lines"><div></div><div></div><div></div><div></div></div>`
    : ''
}`;
  return document({
    locale,
    paper,
    title: `${s.growth_title}: ${v.memberName}`,
    body,
    generatedOn: fmtDate(today, locale),
  });
}
