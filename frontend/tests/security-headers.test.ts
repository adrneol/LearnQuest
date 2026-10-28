import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
const allHeaders = (config.headers ?? []).flatMap((entry: any) => entry.headers ?? []);
const header = (name: string): string => {
  const match = allHeaders.find((entry: any) => String(entry.key).toLowerCase() === name.toLowerCase());
  return match ? String(match.value) : '';
};

describe('static hosting security headers', () => {
  it('sets restrictive browser isolation and anti-sniffing headers', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('no-referrer');
    expect(header('Strict-Transport-Security')).toMatch(/max-age=31536000/);
    expect(header('Permissions-Policy')).toMatch(/camera=\(\)/);
  });

  it('defines a CSP that permits the real app and YouTube player resources only', () => {
    const csp = header('Content-Security-Policy');
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/script-src 'self' https:\/\/www\.youtube\.com/);
    expect(csp).toMatch(/style-src 'self' 'unsafe-inline'/);
    expect(csp).toMatch(/connect-src 'self'/);
    expect(csp).toMatch(/frame-src https:\/\/www\.youtube\.com/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'none'/);
    expect(csp).toMatch(/form-action 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/upgrade-insecure-requests/);
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(csp).not.toMatch(/script-src[^;]*\*/);
  });
});
