/**
 * Monotonically-increasing time value, updated at ~intervalMs cadence.
 * Pass `null` to pause. Used to drive shimmer / spinner animations in
 * isolated components — keep the interval ONLY in the leaf that needs
 * animation so parent re-renders are bounded.
 *
 * Mirrors helixent's hooks/use-animation-frame.ts.
 */

import { useEffect, useState } from 'react';

export function useAnimationFrame(intervalMs: number | null = 100): number {
  const [time, setTime] = useState(0);

  useEffect(() => {
    if (intervalMs === null) return;
    const id = setInterval(() => {
      setTime(prev => prev + intervalMs);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return time;
}
