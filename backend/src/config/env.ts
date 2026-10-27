import 'dotenv/config';

/**
 * Validated environment access. Numeric values are checked at read time and
 * fail fast with an actionable message. Secret values are never returned in
 * status objects, logged, or included in error messages.
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

function stringEnv(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function originEnv(name: string, fallback: string): string {
  const raw = stringEnv(name, fallback).replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute origin such as https://app.example.com.`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an origin only (no path, query, or fragment).`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https.`);
  }
  return url.origin;
}

function mongoUri(): string {
  const raw = stringEnv('MONGODB_URI');
  if (!raw) return '';
  if (!/^mongodb(\+srv)?:\/\//.test(raw) || /\s/.test(raw) || raw.length > 2048) {
    throw new Error('MONGODB_URI must be a valid mongodb:// or mongodb+srv:// connection string (value not printed).');
  }
  return raw;
}

function secretEnv(name: string): string {
  const raw = stringEnv(name);
  if (!raw) return '';
  if (raw.length < 32) {
    throw new Error(`${name} must be at least 32 characters. Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`);
  }
  return raw;
}

export const env = {
  get nodeEnv(): 'development' | 'test' | 'production' {
    const v = stringEnv('NODE_ENV', 'development');
    return v === 'production' || v === 'test' ? v : 'development';
  },
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  },
  get port(): number {
    return intEnv('PORT', 3001, 1, 65535);
  },
  get appOrigin(): string {
    return originEnv('APP_ORIGIN', 'http://localhost:5173');
  },
  get apiOrigin(): string {
    return originEnv('API_ORIGIN', 'http://localhost:3001');
  },
  /** Exact allowed browser origins. Never a wildcard. */
  get corsOrigin(): string[] {
    const configured = stringEnv('CORS_ORIGIN');
    const origins = (configured ? configured.split(',') : [this.appOrigin])
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    if (origins.includes('*')) {
      throw new Error('CORS_ORIGIN must list exact origins; wildcard credentialed CORS is not allowed.');
    }
    const merged = [...new Set([this.appOrigin, ...origins])];
    for (const o of merged) {
      try {
        const u = new URL(o);
        if (u.pathname !== '/' || u.search || u.hash) throw new Error('origin only');
      } catch {
        throw new Error('CORS_ORIGIN contains an invalid origin. Use comma-separated absolute origins.');
      }
    }
    return merged;
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
  get authRateLimitPerMin(): number {
    return intEnv('AUTH_RATE_LIMIT_PER_MIN', 20, 1, 10_000);
  },
  get otpRateLimitPer15Min(): number {
    return intEnv('OTP_RATE_LIMIT_PER_15MIN', 8, 1, 10_000);
  },
  /** Number of trusted reverse-proxy hops in front of Express (0 = direct). */
  get trustProxyHops(): number {
    return intEnv('TRUST_PROXY_HOPS', 1, 0, 10);
  },
  get youtubeApiKey(): string {
    return stringEnv('YOUTUBE_API_KEY');
  },
  get mongodbUri(): string {
    return mongoUri();
  },
  get mongodbConfigured(): boolean {
    return Boolean(mongoUri());
  },
  get mongodbDbName(): string {
    const raw = stringEnv('MONGODB_DB_NAME', 'learnquest');
    if (!/^[A-Za-z0-9_-]{1,63}$/.test(raw)) {
      throw new Error('MONGODB_DB_NAME must be 1-63 letters, digits, underscores, or hyphens.');
    }
    return raw;
  },
  get googleClientId(): string {
    return stringEnv('GOOGLE_CLIENT_ID');
  },
  get googleClientSecret(): string {
    return stringEnv('GOOGLE_CLIENT_SECRET');
  },
  get googleRedirectUri(): string {
    const raw = stringEnv('GOOGLE_REDIRECT_URI', `${this.apiOrigin}/api/auth/google/callback`);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('GOOGLE_REDIRECT_URI must be an absolute callback URL.');
    }
    if (!/\/api\/auth\/google\/callback$/.test(url.pathname)) {
      throw new Error('GOOGLE_REDIRECT_URI must end with /api/auth/google/callback.');
    }
    if (url.search || url.hash) throw new Error('GOOGLE_REDIRECT_URI must not contain a query or fragment.');
    return url.toString();
  },
  get googleConfigured(): boolean {
    return Boolean(this.googleClientId && this.googleClientSecret);
  },
  get brevoApiKey(): string {
    return stringEnv('BREVO_API_KEY');
  },
  get brevoSenderEmail(): string {
    return stringEnv('BREVO_SENDER_EMAIL');
  },
  get brevoSenderName(): string {
    return stringEnv('BREVO_SENDER_NAME', 'LearnQuest');
  },
  get brevoConfigured(): boolean {
    return Boolean(this.brevoApiKey && this.brevoSenderEmail);
  },
  get sessionSecret(): string {
    return secretEnv('SESSION_SECRET');
  },
  get otpHmacSecret(): string {
    return secretEnv('OTP_HMAC_SECRET');
  },
  get sessionConfigured(): boolean {
    return Boolean(this.sessionSecret);
  },
  get otpConfigured(): boolean {
    return Boolean(this.otpHmacSecret);
  },
  get sessionIdleHours(): number {
    return intEnv('SESSION_IDLE_HOURS', 24 * 7, 1, 24 * 90);
  },
  get sessionAbsoluteDays(): number {
    return intEnv('SESSION_ABSOLUTE_DAYS', 30, 1, 365);
  },
  get reauthWindowMin(): number {
    return intEnv('REAUTH_WINDOW_MIN', 10, 1, 120);
  },
  get otpTtlMin(): number {
    return intEnv('OTP_TTL_MIN', 10, 2, 30);
  },
  get otpResendSec(): number {
    return intEnv('OTP_RESEND_SEC', 60, 15, 600);
  },
  get otpMaxAttempts(): number {
    return intEnv('OTP_MAX_ATTEMPTS', 5, 1, 10);
  },
  get sessionCookieName(): string {
    return this.isProduction ? '__Host-lq_session' : 'lq_session';
  },
  get cookieSecure(): boolean {
    return this.isProduction;
  },
  get accountMaxStateBytes(): number {
    return intEnv('ACCOUNT_MAX_STATE_BYTES', 8 * 1024 * 1024, 64 * 1024, 32 * 1024 * 1024);
  },
};

export interface PublicConfigStatus {
  nodeEnv: string;
  authEnabled: boolean;
  setupRequired: boolean;
  configured: {
    mongodb: boolean;
    google: boolean;
    brevo: boolean;
    session: boolean;
    otp: boolean;
    youtube: boolean;
  };
  missing: string[];
  cookieSecure: boolean;
  appOrigin: string;
}

/** Actionable, value-free configuration status for the login screen and health. */
export function configStatus(): PublicConfigStatus {
  const configured = {
    mongodb: env.mongodbConfigured,
    google: env.googleConfigured,
    brevo: env.brevoConfigured,
    session: env.sessionConfigured,
    otp: env.otpConfigured,
    youtube: Boolean(env.youtubeApiKey),
  };
  const missing: string[] = [];
  if (!configured.mongodb) missing.push('MONGODB_URI');
  if (!configured.session) missing.push('SESSION_SECRET');
  if (!configured.otp) missing.push('OTP_HMAC_SECRET');
  if (!configured.google) missing.push('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  if (!configured.brevo) missing.push('BREVO_API_KEY', 'BREVO_SENDER_EMAIL');
  const core = configured.mongodb && configured.session && configured.otp;
  return {
    nodeEnv: env.nodeEnv,
    // Password sign-in still requires Google-created accounts; Google is the
    // only registration path, so auth is fully enabled only with Google too.
    authEnabled: core && configured.google,
    setupRequired: missing.length > 0,
    configured,
    missing,
    cookieSecure: env.cookieSecure,
    appOrigin: env.appOrigin,
  };
}

/**
 * Production fail-closed checks called before the listener starts. Development
 * may run in a clearly identified setup-required state; production may not.
 */
export function assertProductionConfig(): void {
  if (!env.isProduction) return;
  const problems: string[] = [];
  if (!env.mongodbConfigured) problems.push('MONGODB_URI is required in production.');
  if (!env.googleConfigured) problems.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in production.');
  if (!env.brevoConfigured) problems.push('BREVO_API_KEY and BREVO_SENDER_EMAIL are required in production.');
  if (!env.sessionConfigured) problems.push('SESSION_SECRET is required in production.');
  if (!env.otpConfigured) problems.push('OTP_HMAC_SECRET is required in production.');
  if (!env.appOrigin.startsWith('https://')) problems.push('APP_ORIGIN must use https in production for Secure cookies.');
  if (!env.googleRedirectUri.startsWith('https://')) problems.push('GOOGLE_REDIRECT_URI must use https in production.');
  if (problems.length) {
    throw new Error(`Refusing to start with insecure production configuration:\n- ${problems.join('\n- ')}`);
  }
}

export const VERSION = '0.3.0';
