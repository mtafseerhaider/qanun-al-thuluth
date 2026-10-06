import { useEffect } from 'react';

/**
 * Cold-start timing marks (24 S7-01, 01 §9.1, apps/mobile/docs/perf-s7.md). Times are
 * `performance.now()` milliseconds; durations are reported from `js_start`, the first app module
 * evaluated (index.ts imports ./js-start first). When React Native exposes its native startup
 * timing, the time from process start to `js_start` is reported too, so the Today budget
 * (2.5 s Android ref, 1.5 s iPhone 11) can be read end to end on a device.
 *
 * Marks are kept in memory only: the debug screen shows them and `onStartupReport` hands the
 * finished report to Sentry as a breadcrumb. No user data is involved.
 */
export const STARTUP_MARKS = [
  'js_start',
  'bootstrap_done',
  'fonts_ready',
  'nav_ready',
  'today_interactive',
] as const;
export type StartupMark = (typeof STARTUP_MARKS)[number];

export interface StartupReport {
  /** Milliseconds from `js_start` to each recorded mark. */
  sinceJsStart: Partial<Record<StartupMark, number>>;
  /** Native process start to `js_start`, when React Native reports it; otherwise null. */
  nativeToJsStart: number | null;
}

type Clock = () => number;
type Reporter = (report: StartupReport) => void;

const defaultClock: Clock = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

let clock: Clock = defaultClock;
let marks: Partial<Record<StartupMark, number>> = {};
let reporters: Reporter[] = [];
let reported = false;

/** Records a mark once per launch; later calls for the same mark are ignored. */
export function markStartup(name: StartupMark): void {
  if (marks[name] !== undefined) return;
  marks[name] = clock();
  if (name === 'today_interactive' && !reported) {
    reported = true;
    const report = getStartupReport();
    for (const r of reporters) {
      try {
        r(report);
      } catch {
        // Reporting must never break startup.
      }
    }
  }
}

/** Shape React Native's `performance.rnStartupTiming` uses (absent on some versions). */
interface RnStartupTiming {
  startTime?: number;
  executeJavaScriptBundleEntryPointStart?: number;
}

function nativeToJsStart(): number | null {
  const timing = (globalThis as { performance?: { rnStartupTiming?: RnStartupTiming } }).performance
    ?.rnStartupTiming;
  const start = timing?.startTime;
  const js = timing?.executeJavaScriptBundleEntryPointStart;
  if (typeof start !== 'number' || typeof js !== 'number' || js < start || start <= 0) return null;
  return Math.round(js - start);
}

export function getStartupReport(): StartupReport {
  const origin = marks.js_start;
  const sinceJsStart: StartupReport['sinceJsStart'] = {};
  if (origin !== undefined) {
    for (const name of STARTUP_MARKS) {
      const at = marks[name];
      if (at !== undefined) sinceJsStart[name] = Math.round(at - origin);
    }
  }
  return { sinceJsStart, nativeToJsStart: nativeToJsStart() };
}

/** Called once, when Today first renders content (the 9.1 "interactive Today" point). */
export function onStartupReport(reporter: Reporter): () => void {
  reporters.push(reporter);
  return () => {
    reporters = reporters.filter((r) => r !== reporter);
  };
}

/** Marks `name` the first time `ready` is true (for screens that render from cache). */
export function useStartupMark(name: StartupMark, ready: boolean): void {
  useEffect(() => {
    if (ready) markStartup(name);
  }, [name, ready]);
}

/**
 * Runs non-critical startup work once the JS thread is idle after the first frame, with a
 * deadline so it never waits indefinitely (07 §9.2 "defer what the first screen does not need").
 */
export function whenIdle(task: () => void, timeoutMs = 1500): void {
  const ric = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => unknown;
    }
  ).requestIdleCallback;
  if (typeof ric === 'function') ric(task, { timeout: timeoutMs });
  else setTimeout(task, 0);
}

/** Test seam. */
export function resetStartupForTests(nextClock: Clock = defaultClock): void {
  clock = nextClock;
  marks = {};
  reporters = [];
  reported = false;
}
