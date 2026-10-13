import 'dotenv/config';

// Getters so tests (and runtime key rotation) observe current process.env.
export const env = {
  get port(): number {
    return Number(process.env.PORT ?? 3001);
  },
  get corsOrigin(): string[] {
    return (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim());
  },
  get cacheTtlSec(): number {
    return Number(process.env.CACHE_TTL_SEC ?? 600);
  },
  get rateLimitPerMin(): number {
    return Number(process.env.RATE_LIMIT_PER_MIN ?? 30);
  },
  get youtubeApiKey(): string {
    return process.env.YOUTUBE_API_KEY ?? '';
  },
};

export const VERSION = '0.2.0';
