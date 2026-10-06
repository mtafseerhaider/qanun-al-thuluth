/**
 * Outlier screening for price observations (14 §12.3, FR-GRO-06), as pure functions.
 *
 * Method (documented choice). Prices are compared per (price_profile, ingredient) as price per kg
 * (`amount_minor × 1000 / unit_grams`) over a trailing 60-day window:
 *
 * 1. Baseline = accepted observations of any source. With 5 or more, a user report is an outlier
 *    when its modified z-score |0.6745 × (x − median) / MAD| exceeds 3.5 (Iglewicz and Hoaglin,
 *    1993), the same rule as the insert trigger `price_report_moderation` (05 §22.6). MAD is
 *    robust: one wild report cannot drag the threshold the way a mean and standard deviation would.
 * 2. Hard band, always: outside 40 to 160 percent of the baseline median is an outlier, so a
 *    report at 3x the median is rejected even when the MAD is zero or the data are thin (AC-G3).
 *    06 §4.16 words the limit as "3 x IQR"; the median/MAD rule above is the stricter of the two
 *    for small samples and is what the database trigger already applies, so both layers agree.
 * 3. Thin data (fewer than 5 accepted): pending user reports are accepted only when at least two
 *    independent reporters agree within 15 percent of their own median (14 §12.3) and they pass
 *    the hard band against any baseline that exists. A lone report stays pending.
 * 4. Reports accepted earlier (thin data at insert time) are re-screened against today's baseline
 *    and rejected when they are now outliers. Seed, admin and partner observations are never
 *    changed here.
 */

export interface Observation {
  id: string;
  price_profile_id: string;
  ingredient_id: string;
  amount_minor: number;
  unit_grams: number;
  observed_on: string;
  source: 'seed' | 'user_report' | 'admin' | 'partner_feed';
  reporter_user_id: string | null;
  moderation_status: 'pending' | 'accepted' | 'rejected' | 'rejected_outlier' | 'rejected_manual';
}

export type StatusUpdate = { id: string; status: 'accepted' | 'rejected_outlier' };

export const MIN_BASELINE = 5;
export const Z_THRESHOLD = 3.5;
export const BAND = { low: 0.4, high: 1.6 } as const;
export const AGREEMENT = 0.15;
export const WINDOW_DAYS = 60;

export const pricePerKg = (o: Pick<Observation, 'amount_minor' | 'unit_grams'>): number =>
  (o.amount_minor * 1000) / o.unit_grams;

export function median(xs: readonly number[]): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median absolute deviation. */
export function mad(xs: readonly number[], med = median(xs)): number {
  return median(xs.map((x) => Math.abs(x - med)));
}

export function isOutlier(x: number, med: number, madValue: number, robust: boolean): boolean {
  if (!Number.isFinite(med) || med <= 0) return false;
  if (x > med * BAND.high || x < med * BAND.low) return true;
  return robust && madValue > 0 && Math.abs((0.6745 * (x - med)) / madValue) > Z_THRESHOLD;
}

export interface ScreenResult {
  updates: StatusUpdate[];
  outliers_rejected: number;
  pending_accepted: number;
}

/** Screens one or more groups of observations (any order). */
export function screen(observations: readonly Observation[]): ScreenResult {
  const groups = new Map<string, Observation[]>();
  for (const o of observations) {
    if (!(o.unit_grams > 0) || !(o.amount_minor > 0)) continue;
    const key = `${o.price_profile_id}:${o.ingredient_id}`;
    const list = groups.get(key) ?? [];
    list.push(o);
    groups.set(key, list);
  }
  const updates: StatusUpdate[] = [];
  let outliers = 0;
  let accepted = 0;
  for (const list of groups.values()) {
    const baseline = list.filter((o) => o.moderation_status === 'accepted').map(pricePerKg);
    const robust = baseline.length >= MIN_BASELINE;
    const med = median(baseline);
    const madValue = robust ? mad(baseline, med) : 0;
    const reports = list.filter(
      (o) =>
        o.source === 'user_report' &&
        (o.moderation_status === 'accepted' || o.moderation_status === 'pending'),
    );

    const pendingOk: Observation[] = [];
    for (const o of reports) {
      if (isOutlier(pricePerKg(o), med, madValue, robust)) {
        updates.push({ id: o.id, status: 'rejected_outlier' });
        outliers += 1;
      } else if (o.moderation_status === 'pending') {
        pendingOk.push(o);
      }
    }
    if (!pendingOk.length) continue;
    if (robust) {
      for (const o of pendingOk) updates.push({ id: o.id, status: 'accepted' });
      accepted += pendingOk.length;
      continue;
    }
    // Thin data: two independent reporters within 15 percent of the reports' median.
    const reportMedian = median(pendingOk.map(pricePerKg));
    const agreeing = pendingOk.filter(
      (o) => Math.abs(pricePerKg(o) - reportMedian) <= reportMedian * AGREEMENT,
    );
    const reporters = new Set(agreeing.map((o) => o.reporter_user_id).filter(Boolean));
    if (reporters.size >= 2) {
      for (const o of agreeing) updates.push({ id: o.id, status: 'accepted' });
      accepted += agreeing.length;
    }
  }
  return { updates, outliers_rejected: outliers, pending_accepted: accepted };
}

/** Prices that moved more than `threshold` (or appeared) between two snapshots. */
export function repriced(
  before: Map<string, number>,
  after: Map<string, number>,
  threshold = 0.03,
): string[] {
  const out: string[] = [];
  for (const [key, price] of after) {
    const old = before.get(key);
    if (old === undefined || old <= 0 || Math.abs(price - old) / old > threshold) out.push(key);
  }
  return out;
}
