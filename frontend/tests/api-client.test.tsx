import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { apiUrl, getApiBase, checkApiHealth } from '../src/services/api/playlistApi.js';
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
  });

  it('production origin joins cleanly with or without leading slash', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://myservice.onrender.com');
    expect(apiUrl('/health')).toBe('https://myservice.onrender.com/api/health');
    expect(apiUrl('playlist')).toBe('https://myservice.onrender.com/api/playlist');
  });

  it('trailing slashes are stripped (never //api/... 404s)', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://myservice.onrender.com/');
    expect(getApiBase()).toBe('https://myservice.onrender.com');
    expect(apiUrl('/health')).toBe('https://myservice.onrender.com/api/health');
    vi.stubEnv('VITE_API_BASE_URL', 'https://myservice.onrender.com///');
    expect(apiUrl('/health')).toBe('https://myservice.onrender.com/api/health');
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
