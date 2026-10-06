import { cmToIn, kgToLb } from '@shared/utils/units';

import type { Indicator } from './growth-rules';

/** Display unit for an indicator in the household's units; BMI has none. */
export function unitKey(
  indicator: Indicator,
  units: 'metric' | 'imperial',
): 'kg' | 'lb' | 'cm' | 'in' | null {
  if (indicator === 'bmi') return null;
  if (indicator === 'wfa') return units === 'imperial' ? 'lb' : 'kg';
  return units === 'imperial' ? 'in' : 'cm';
}

/** A measurement as text in the household's units, one decimal (stored metric, 15 §2.2). */
export function formatMeasurement(
  value: number,
  indicator: Indicator,
  units: 'metric' | 'imperial',
): string {
  let v = value;
  if (units === 'imperial' && indicator === 'wfa') v = kgToLb(value);
  if (units === 'imperial' && (indicator === 'hfa' || indicator === 'hc')) v = cmToIn(value);
  return (Math.round(v * 10) / 10).toFixed(1);
}
