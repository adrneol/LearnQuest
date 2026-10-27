import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cookieHeader } from '../src/auth/crypto.js';

const root = resolve(process.cwd(), '..');

describe('production proxy and runtime configuration', () => {
  const savedNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
  });

  it('keeps the Vercel same-origin /api rewrite pointed at the real Render service', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'frontend/vercel.json'), 'utf8'));
    const rewrite = (config.rewrites ?? []).find((r: any) => r.source === '/api/:path*');
    expect(rewrite).toBeTruthy();
    expect(rewrite.destination).toBe('https://learnquest-hhiv.onrender.com/api/:path*');
    const headers = JSON.stringify(config.headers ?? []);
    expect(headers).toContain('Referrer-Policy');
    expect(headers).toContain('no-referrer');
  });

  it('pins the public Vercel origin, callback, API origin, and two proxy hops in render.yaml', () => {
    const yaml = readFileSync(resolve(root, 'render.yaml'), 'utf8');
    expect(yaml).toContain('APP_ORIGIN');
    expect(yaml).toMatch(/key:\s*APP_ORIGIN\s*\n\s*value:\s*https:\/\/learn-quest-one\.vercel\.app/);
    expect(yaml).toMatch(/key:\s*NODE_ENV\s*\n\s*value:\s*production/);
    expect(yaml).toContain('CORS_ORIGIN');
    expect(yaml).toContain('GOOGLE_REDIRECT_URI');
    expect(yaml).toContain('https://learn-quest-one.vercel.app/api/auth/google/callback');
    expect(yaml).toContain('API_ORIGIN');
    expect(yaml).toContain('https://learnquest-hhiv.onrender.com');
    expect(yaml).toMatch(/TRUST_PROXY_HOPS[\s\S]*?value:\s*'2'/);
    expect(yaml).toContain('NODE_VERSION');
    expect(yaml).toContain("value: '24.22.1'");
    expect(yaml).toContain('EMAIL_ACTION_HMAC_SECRET');
    expect(yaml).not.toMatch(/OTP_TTL_MIN|OTP_RESEND_SEC|OTP_MAX_ATTEMPTS/);
  });

  it('keeps the Node runtime pins consistent without claiming the local runtime matches', () => {
    const dotNode = readFileSync(resolve(process.cwd(), '.node-version'), 'utf8').trim();
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    expect(dotNode).toBe('24.22.1');
    expect(pkg.engines.node).toBe('>=24.22.1 <25');
  });

  it('emits the production __Host- cookie with no Domain attribute', () => {
    process.env.NODE_ENV = 'production';
    const cookie = cookieHeader('test-token', 3600);
    expect(cookie).toContain('__Host-lq_session=test-token');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=3600');
    expect(cookie).toContain('Expires=');
    expect(cookie).not.toMatch(/;\s*Domain=/i);
    const cleared = cookieHeader(null, 0);
    expect(cleared).toContain('__Host-lq_session=');
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });
});
