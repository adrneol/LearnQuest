import 'dotenv/config';

/**
 * Numeric environment values are validated at read time: NaN, Infinity,
 * decimals where an integer is required, and out-of-range values fail fast with
 * a clear configuration error instead of silently becoming 0/NaN at runtime.
 */
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max} (received an invalid value).`);
  }
  return n;
}

// Getters so tests (and runtime key rotation) observe current process.env.
export const env = {
  get port(): number {
    return intEnv('PORT', 3001, 1, 65535);
  },
  get corsOrigin(): string[] {
    const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return origins.length ? origins : ['http://localhost:5173'];
  },
  get cacheTtlSec(): number {
    return intEnv('CACHE_TTL_SEC', 600, 0, 7 * 24 * 3600);
  },
  get cacheMaxEntries(): number {
    return intEnv('CACHE_MAX_ENTRIES', 50, 1, 10_000);
  },
  get rateLimitPerMin(): number {
    return intEnv('RATE_LIMIT_PER_MIN', 30, 1, 100_000);
  },
  /** Number of trusted reverse-proxy hops in front of Express (0 = direct). */
  get trustProxyHops(): number {
    return intEnv('TRUST_PROXY_HOPS', 1, 0, 10);
  },
  get youtubeApiKey(): string {
    return (process.env.YOUTUBE_API_KEY ?? '').trim();
  },
};

export const VERSION = '0.2.0';
