import { useEffect, useState } from 'react';
import { dateKeyInTimezone } from '../domain/index.js';

/**
 * Calendar-day tick for the selected display timezone. Returns today's
 * YYYY-MM-DD key and re-renders the caller when the local calendar day
 * changes — via a cheap 30s check plus visibility/focus listeners, so
 * background-throttled timers, device sleep, and tabs returning from sleep
 * still refresh rolling windows, streaks, goals, and Arena ranks. No polling
 * of heavy computations: callers recompute their memos from this key.
 */
export function useDayTick(timeZone: string): string {
  const [key, setKey] = useState(() => {
    try {
      return dateKeyInTimezone(new Date(), timeZone);
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  });
  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const current = () => {
      try {
        return dateKeyInTimezone(new Date(), timeZone);
      } catch {
        return new Date().toISOString().slice(0, 10);
      }
    };
    setKey(current());
    const check = () => {
      if (dead) return;
      const k = current();
      setKey((prev) => (prev === k ? prev : k));
      schedule();
    };
    const schedule = () => {
      if (dead) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 30000);
    };
    const onVis = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') check();
    };
    const onFocus = () => check();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
    schedule();
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
    };
  }, [timeZone]);
  return key;
}
