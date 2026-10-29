import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiUrl, getApiBase, checkApiHealth } from '../src/services/api/playlistApi.js';
import { apiRequest, setCsrfToken } from '../src/services/api/http.js';
import App from '../src/app/App';
import { StoreProvider } from '../src/app/store';

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.fetch = realFetch;
});

describe('API base URL contract', () => {
  it('empty base means same-origin /api (local dev proxy)', () => {
    expect(getApiBase()).toBe('');
    expect(apiUrl('/health')).toBe('/api/health');
    expect(apiUrl('playlist')).toBe('/api/playlist');
    expect(apiUrl('/api/account/data')).toBe('/api/account/data');
    expect(apiUrl('api/auth/session')).toBe('/api/auth/session');
    expect(apiUrl('/api')).toBe('/api');
  });

  it('ignores build-time API origins so production requests remain same-origin', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://myservice.onrender.com');
    expect(getApiBase()).toBe('');
    expect(apiUrl('/health')).toBe('/api/health');
    expect(apiUrl('/account/data')).toBe('/api/account/data');
    const clientSource = readFileSync(resolve(process.cwd(), 'src/services/api/http.ts'), 'utf8');
    expect(clientSource).not.toContain('VITE_API_BASE_URL');
    expect(clientSource).not.toContain('learnquest-hhiv.onrender.com');
  });

  it('keeps Vercel forwarding and Vite local proxy aligned with the same-origin client', () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
    const rewrite = vercel.rewrites.find((entry: { source: string }) => entry.source === '/api/:path*');
    expect(rewrite?.destination).toBe('https://learnquest-hhiv.onrender.com/api/:path*');
    const csp = vercel.headers
      .flatMap((group: { headers: { key: string; value: string }[] }) => group.headers)
      .find((header: { key: string }) => header.key.toLowerCase() === 'content-security-policy')?.value;
    expect(vercel.headers.flatMap((group: { headers: { key: string }[] }) => group.headers)
      .filter((header: { key: string }) => header.key.toLowerCase() === 'content-security-policy')).toHaveLength(1);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/connect-src[^;]*https?:/);
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).not.toMatch(/<meta[^>]+http-equiv=["']Content-Security-Policy/i);

    const vite = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(vite).toContain("'/api': 'http://localhost:3001'");
  });

  it('sends credentialed auth requests with CSRF on mutations and rejects failed API responses', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setCsrfToken('csrf-test-token');

    await apiRequest('/auth/session');
    await apiRequest('/account/data', { method: 'POST', body: { version: 1 } });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/session', expect.objectContaining({
      credentials: 'include',
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/account/data', expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-test-token' }),
    }));

    globalThis.fetch = vi.fn(async () => new Response('{"error":"unavailable"}', { status: 503 })) as unknown as typeof fetch;
    await expect(apiRequest('/account/data')).rejects.toMatchObject({ status: 503 });
    setCsrfToken(null);
  });
});

describe('health check truthfulness', () => {
  it('reports healthy only on a successful health response', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ ok: true, hasKey: true }) }) as Response) as any;
    expect(await checkApiHealth()).toEqual({ ok: true, hasKey: true });
  });

  it('a failed health check stays visibly failed (never reported healthy)', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response) as any;
    expect(await checkApiHealth()).toEqual({ ok: false, hasKey: false });
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as any;
    expect(await checkApiHealth()).toEqual({ ok: false, hasKey: false });
  });
});

describe('backend status recovery without reload', () => {
  it('offline pill recovers on window focus once the backend responds', async () => {
    let fail = true;
    globalThis.fetch = (async (url: any) => {
      if (fail) throw new TypeError('fetch failed');
      return { ok: true, json: async () => ({ ok: true, hasKey: true }) } as Response;
    }) as any;
    render(
      <StoreProvider>
        <App />
      </StoreProvider>,
    );
    expect(await screen.findByText(/API offline/)).toBeTruthy();
    fail = false;
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText(/API ready/)).toBeTruthy();
    await waitFor(() => {
      // healthy: no further polling listeners remain attached (single recovery fetch)
      expect(screen.queryByText(/API offline/)).toBeNull();
    });
  });
});
