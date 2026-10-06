import { useEffect, useState } from 'react';

/** Whole seconds until `targetMs` (0 when passed or null), re-rendering once per second. */
export function secondsUntil(targetMs: number | null, now: number): number {
  if (targetMs === null) return 0;
  return Math.max(0, Math.ceil((targetMs - now) / 1000));
}

export function useCountdown(targetMs: number | null, now: () => number = Date.now): number {
  const [remaining, setRemaining] = useState(() => secondsUntil(targetMs, now()));

  useEffect(() => {
    setRemaining(secondsUntil(targetMs, now()));
    if (targetMs === null || targetMs <= now()) return;
    const id = setInterval(() => {
      const left = secondsUntil(targetMs, now());
      setRemaining(left);
      if (left === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [targetMs, now]);

  return remaining;
}

/** `0:42` style; digits are always Western (08 §10.3). */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
