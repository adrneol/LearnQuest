import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredTheme, resolveTheme, setTheme, THEME_KEY } from '../src/app/theme';

describe('theme system', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark when nothing is stored', () => {
    expect(getStoredTheme()).toBe('dark');
  });

  it('persists the choice in localStorage and applies data-theme to <html>', () => {
    setTheme('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('resolves system to dark or light via matchMedia', () => {
    const resolved = resolveTheme('system');
    expect(['dark', 'light']).toContain(resolved);
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it('ignores malformed stored values instead of crashing', () => {
    localStorage.setItem(THEME_KEY, 'opera-motif');
    expect(getStoredTheme()).toBe('dark');
  });
});
