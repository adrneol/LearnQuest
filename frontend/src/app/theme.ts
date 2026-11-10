/**
 * LearnQuest theme management.
 *
 * Single source of truth for dark/light/system theme.
 * - Persisted in `localStorage` as `lq-theme` (`'dark' | 'light' | 'system'`).
 * - Applied to `<html data-theme>` and `color-scheme`.
 * - Initialized before paint by the same-origin `theme-init.js` script.
 * - UI-only preference: not part of the server-persisted user data, so cloud
 *   sync never overwrites it. Per-device, like nav-collapsed.
 */

import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_KEY = 'lq-theme';
export const THEMES: Theme[] = ['dark', 'light', 'system'];

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light' || value === 'system';
}

export function getStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (isTheme(raw)) return raw;
  } catch {
    /* storage unavailable */
  }
  return 'dark'; // explicit dark default preserves existing visual baseline
}

export function resolveTheme(pref: Theme): ResolvedTheme {
  if (pref === 'light') return 'light';
  if (pref === 'system') {
    try {
      if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
        return 'light';
      }
    } catch {
      /* ignore */
    }
  }
  return 'dark';
}

function applyResolved(resolved: ResolvedTheme, animate = false) {
  try {
    const root = document.documentElement;
    if (animate && root.dataset.theme !== resolved) root.dataset.themeTransition = 'true';
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  } catch {
    /* document unavailable */
  }
}

export function setTheme(pref: Theme) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* ignore */
  }
  publishTheme(pref);
}

let stopWatchingSystem: (() => void) | undefined;

function publishTheme(pref: Theme) {
  const resolved = resolveTheme(pref);
  applyResolved(resolved, true);
  window.dispatchEvent(new CustomEvent('lq:theme-change', { detail: { pref, resolved } }));
}

export function initTheme() {
  applyResolved(resolveTheme(getStoredTheme()));
  stopWatchingSystem?.();
  const system = window.matchMedia?.('(prefers-color-scheme: light)');
  const onSystemChange = () => {
    if (getStoredTheme() === 'system') publishTheme('system');
  };
  const onStorageChange = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) publishTheme(getStoredTheme());
  };
  system?.addEventListener?.('change', onSystemChange);
  window.addEventListener('storage', onStorageChange);
  stopWatchingSystem = () => {
    system?.removeEventListener?.('change', onSystemChange);
    window.removeEventListener('storage', onStorageChange);
  };
}

/** Hook-friendly subscribe: returns stored pref; caller re-renders on change. */
export function subscribeTheme(listener: () => void): () => void {
  window.addEventListener('lq:theme-change', listener);
  return () => window.removeEventListener('lq:theme-change', listener);
}

const getResolvedTheme = () => resolveTheme(getStoredTheme());

/** React hook: current theme pref + resolved theme + setter. */
export function useTheme(): { pref: Theme; resolved: ResolvedTheme; setTheme: (t: Theme) => void } {
  const pref = useSyncExternalStore(subscribeTheme, getStoredTheme, () => 'dark' as Theme);
  const resolved = useSyncExternalStore(subscribeTheme, getResolvedTheme, () => 'dark' as ResolvedTheme);
  return { pref, resolved, setTheme };
}

export function themeLabel(pref: Theme, resolved: ResolvedTheme): string {
  if (pref === 'system') return `System (${resolved})`;
  return pref === 'dark' ? 'Dark' : 'Light';
}
