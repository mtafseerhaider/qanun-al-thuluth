/**
 * Solar position for prayer-time computation. Pure functions, no dependencies, so the same code
 * runs in Deno (Edge Functions), Node (tests) and Hermes (React Native).
 *
 * Formulas: Jean Meeus, "Astronomical Algorithms" (2nd ed., 1998), chapters 7 (Julian day),
 * 22 (nutation, low accuracy), 25 (solar coordinates, low accuracy) and the NOAA solar
 * calculator's equation of time (an algebraic form of Meeus 28.3). Accuracy is about 0.01 degree
 * in declination and a few seconds in the equation of time for 1950 to 2100, far inside the
 * one-minute rounding of published timetables.
 */

export const DEG = Math.PI / 180;

const sin = (d: number) => Math.sin(d * DEG);
const cos = (d: number) => Math.cos(d * DEG);
const tan = (d: number) => Math.tan(d * DEG);
const asin = (x: number) => Math.asin(x) / DEG;
const acos = (x: number) => Math.acos(x) / DEG;
const atan2 = (y: number, x: number) => Math.atan2(y, x) / DEG;

/** Normalises an angle to [0, 360). */
export function fixAngle(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** Julian day number at 0h UT of a Gregorian calendar date (Meeus 7.1). */
export function julianDay(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

export interface SolarPosition {
  /** Apparent declination, degrees. */
  declination: number;
  /** Equation of time, minutes (apparent minus mean solar time). */
  equationOfTimeMin: number;
}

/** Apparent solar declination and equation of time at a Julian day (UT). */
export function solarPosition(jd: number): SolarPosition {
  const t = (jd - 2451545.0) / 36525;
  const l0 = fixAngle(280.46646 + t * (36000.76983 + 0.0003032 * t));
  const m = fixAngle(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sin(2 * m) * (0.019993 - 0.000101 * t) +
    sin(3 * m) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * sin(omega);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cos(omega);
  const declination = asin(sin(eps) * sin(lambda));

  const y = tan(eps / 2) ** 2;
  const l0r = l0 * DEG;
  const mr = m * DEG;
  const eot =
    y * Math.sin(2 * l0r) -
    2 * e * Math.sin(mr) +
    4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) -
    0.5 * y * y * Math.sin(4 * l0r) -
    1.25 * e * e * Math.sin(2 * mr);
  return { declination, equationOfTimeMin: (4 * eot) / DEG };
}

/**
 * Hour angle (degrees) at which the sun's centre reaches `altitude` (negative = below the
 * horizon), or NaN when it never does that day (high latitudes).
 */
export function hourAngle(altitude: number, latitude: number, declination: number): number {
  const x = (sin(altitude) - sin(latitude) * sin(declination)) / (cos(latitude) * cos(declination));
  if (x < -1 || x > 1) return Number.NaN;
  return acos(x);
}

/** Sun altitude at which an object's shadow is `factor` times its length plus the noon shadow. */
export function asrAltitude(factor: number, latitude: number, declination: number): number {
  return atan2(1, factor + tan(Math.abs(latitude - declination)));
}
