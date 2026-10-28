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

/**
 * Read an integer from the current variable name, with a documented legacy
 * alias so existing deployments keep working through a configuration rename.
 */
function intEnvAlias(name: string, legacyName: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name] ?? process.env[legacyName];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max} (received an invalid value).`);
  }
  return n;
}

function nodeEnvValue(): 'development' | 'test' | 'production' {
  const value = stringEnv('NODE_ENV', 'development');
  if (value !== 'development' && value !== 'test' && value !== 'production') {
    throw new Error('NODE_ENV must be exactly "development", "test", or "production" (received an invalid value).');
  }
  return value;
}

function productionRuntime(): boolean {
  return nodeEnvValue() === 'production';
}

/**
 * Resolve one configured public origin. Production never falls back to a
 * localhost default and never accepts a local/private host, so a production
 * reset email cannot silently point at a developer machine. The local
 * development default remains available only outside production.
 */
function originEnv(name: string, fallback: string): string {
  const configured = stringEnv(name);
  if (productionRuntime() && !configured) {
    throw new Error(`${name} must be explicitly set to the public application origin in production.`);
  }
  const raw = (configured || fallback).replace(/\/+$/, '');
  if (!raw) throw new Error(`${name} must be an absolute origin such as https://app.example.com.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute origin such as https://app.example.com.`);
  }
  // Reject credentials, paths, queries, and fragments. `URL.origin` would
  // silently discard some of these, which would make an invalid configuration
  // look valid while changing where a security-sensitive link points.
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials.`);
  }
  if (url.pathname !== '/' || url.search || url.hash || /[?#]/.test(raw)) {
    throw new Error(`${name} must be an origin only (no path, query, or fragment).`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https.`);
  }
  if (productionRuntime()) {
    if (url.protocol !== 'https:') {
      throw new Error(`${name} must use https in production.`);
    }
    if (isLocalOrPrivateHost(url.hostname)) {
      throw new Error(`${name} must be a public origin in production, never localhost, a private IP, or an internal host.`);
    }
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
    return nodeEnvValue();
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
      let u: URL;
      try {
        u = new URL(o);
      } catch {
        throw new Error('CORS_ORIGIN contains an invalid origin. Use comma-separated absolute origins.');
      }
      if (u.pathname !== '/' || u.search || u.hash) {
        throw new Error('CORS_ORIGIN contains an invalid origin. Use comma-separated absolute origins without paths, queries, or fragments.');
      }
      if (u.username || u.password) {
        throw new Error('CORS_ORIGIN must not contain credentials.');
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error('CORS_ORIGIN must use http or https.');
      }
      // APP_ORIGIN is validated separately, but an extra CORS origin must not
      // reintroduce a development-only or plain-text origin into production.
      // Without this check a production deployment could silently allow a
      // localhost or HTTP origin that bypasses the same-origin cookie model.
      if (this.isProduction) {
        if (u.protocol !== 'https:') {
          throw new Error('CORS_ORIGIN must use https in production.');
        }
        if (isLocalOrPrivateHost(u.hostname)) {
          throw new Error('CORS_ORIGIN must contain only public origins in production, never localhost, a private IP, or an internal host.');
        }
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
  get emailActionRateLimitPer15Min(): number {
    return intEnvAlias('EMAIL_ACTION_RATE_LIMIT_PER_15MIN', 'OTP_RATE_LIMIT_PER_15MIN', 8, 1, 10_000);
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
  /**
   * Which application learning-data backend the repository reads and writes.
   * `legacy` remains the safe default until an owner-approved migration has
   * been applied and independently verified. There is no automatic fallback:
   * a selected backend that fails returns an error instead of reading the
   * other layout.
   */
  get userDataStore(): 'legacy' | 'unified' {
    const raw = stringEnv('LQ_USER_DATA_STORE', 'legacy').toLowerCase();
    if (raw !== 'legacy' && raw !== 'unified') {
      throw new Error('LQ_USER_DATA_STORE must be exactly "legacy" or "unified".');
    }
    return raw;
  },
  /** Explicit acknowledgement required to select the unified store in production. */
  get userDataCutoverAcknowledged(): boolean {
    return stringEnv('LQ_USER_DATA_CUTOVER_ACK') === 'lq-data-to-user-data-v1';
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
  /**
   * HMAC key for opaque email-action tokens. The legacy OTP_HMAC_SECRET is
   * accepted as a fallback so existing deployments can rotate credentials on
   * their own schedule; new installations should use the dedicated name.
   */
  get emailActionHmacSecret(): string {
    const current = stringEnv('EMAIL_ACTION_HMAC_SECRET');
    if (current) return secretEnv('EMAIL_ACTION_HMAC_SECRET');
    return secretEnv('OTP_HMAC_SECRET');
  },
  get sessionConfigured(): boolean {
    return Boolean(this.sessionSecret);
  },
  get emailActionConfigured(): boolean {
    return Boolean(this.emailActionHmacSecret);
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
  get emailActionTtlMin(): number {
    return intEnvAlias('EMAIL_ACTION_TTL_MIN', 'OTP_TTL_MIN', 30, 5, 120);
  },
  get emailActionResendSec(): number {
    return intEnvAlias('EMAIL_ACTION_RESEND_SEC', 'OTP_RESEND_SEC', 60, 15, 900);
  },
  get sessionCookieName(): string {
    return this.isProduction ? '__Host-lq_session' : 'lq_session';
  },
  /** Short-lived browser binding for a Google authorization flow. */
  get oauthCookieName(): string {
    return this.isProduction ? '__Host-lq_oauth' : 'lq_oauth';
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
    emailLinks: boolean;
    youtube: boolean;
  };
  missing: string[];
  cookieSecure: boolean;
  appOrigin: string;
  /** UI can state the real reset-link lifetime without hard-coding it. */
  emailActionTtlMin: number;
  /** Observable storage mode; exposes no connection details. */
  userDataStore: 'legacy' | 'unified';
}

function isLocalOrPrivateHost(hostname: string): boolean {
  // URL.hostname keeps brackets around IPv6 literals.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host === '::'
    || host === '0.0.0.0'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host === 'metadata.google.internal'
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    || /^f[cd][0-9a-f]{2}:/.test(host)
    || /^fe[89ab][0-9a-f]:/.test(host);
}

/** Actionable, value-free configuration status for the login screen and health. */
export function configStatus(): PublicConfigStatus {
  const configured = {
    mongodb: env.mongodbConfigured,
    google: env.googleConfigured,
    brevo: env.brevoConfigured,
    session: env.sessionConfigured,
    emailLinks: env.emailActionConfigured,
    youtube: Boolean(env.youtubeApiKey),
  };
  const missing: string[] = [];
  if (!configured.mongodb) missing.push('MONGODB_URI');
  if (!configured.session) missing.push('SESSION_SECRET');
  if (!configured.emailLinks) missing.push('EMAIL_ACTION_HMAC_SECRET');
  if (!configured.google) missing.push('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  if (!configured.brevo) missing.push('BREVO_API_KEY', 'BREVO_SENDER_EMAIL');
  const core = configured.mongodb && configured.session && configured.emailLinks;
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
    emailActionTtlMin: env.emailActionTtlMin,
    userDataStore: env.userDataStore,
  };
}

/**
 * Production fail-closed checks called before the listener starts. Development
 * may run in a clearly identified setup-required state; production may not.
 */
export function assertProductionConfig(): void {
  if (!env.isProduction) {
    // Render sets RENDER=true and normally injects NODE_ENV=production. A
    // dashboard override to development/test must not silently disable the
    // production cookie and origin checks on a public Render service.
    if (stringEnv('RENDER') === 'true') {
      throw new Error('NODE_ENV must be production when running on Render; refusing to start in a non-production mode.');
    }
    return;
  }
  const problems: string[] = [];
  const capture = <T>(read: () => T): T | null => {
    try {
      return read();
    } catch (e) {
      problems.push(e instanceof Error ? e.message : 'An environment value is invalid.');
      return null;
    }
  };
  if (!env.mongodbConfigured) problems.push('MONGODB_URI is required in production.');
  if (!env.googleConfigured) problems.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in production.');
  if (!env.brevoConfigured) problems.push('BREVO_API_KEY and BREVO_SENDER_EMAIL are required in production.');
  if (!env.sessionConfigured) problems.push('SESSION_SECRET is required in production.');
  if (!env.emailActionConfigured) problems.push('EMAIL_ACTION_HMAC_SECRET is required in production (OTP_HMAC_SECRET is accepted only as a legacy fallback).');
  // Read the numeric policy at startup so an invalid value fails closed now,
  // rather than only when the first recovery request is attempted.
  capture(() => env.emailActionTtlMin);
  capture(() => env.emailActionResendSec);
  const appOrigin = capture(() => env.appOrigin);
  const apiOrigin = capture(() => env.apiOrigin);
  const redirectUri = capture(() => env.googleRedirectUri);
  // Validate the complete CORS allowlist at startup. Otherwise an invalid
  // extra origin would only fail when createApp() first reads it.
  capture(() => env.corsOrigin);
  if (appOrigin && !appOrigin.startsWith('https://')) {
    problems.push('APP_ORIGIN must use https in production.');
  }
  if (apiOrigin && !apiOrigin.startsWith('https://')) {
    problems.push('API_ORIGIN must use https in production.');
  }
  if (appOrigin && isLocalOrPrivateHost(new URL(appOrigin).hostname)) {
    problems.push('APP_ORIGIN must be the public frontend origin in production, never localhost, a private IP, or an internal host.');
  }
  if (redirectUri && isLocalOrPrivateHost(new URL(redirectUri).hostname)) {
    problems.push('GOOGLE_REDIRECT_URI must use the public production origin, never localhost or an internal host.');
  }
  if (env.userDataStore === 'unified' && !env.userDataCutoverAcknowledged) {
    problems.push('LQ_USER_DATA_STORE=unified requires LQ_USER_DATA_CUTOVER_ACK=lq-data-to-user-data-v1 after a verified migration.');
  }
  if (redirectUri && appOrigin && apiOrigin) {
    const redirectOrigin = new URL(redirectUri).origin;
    if (redirectOrigin !== appOrigin && redirectOrigin !== apiOrigin) {
      problems.push('GOOGLE_REDIRECT_URI must use the public APP_ORIGIN (same-origin proxy) or API_ORIGIN (same-site API domain).');
    }
  }
  if (problems.length) {
    throw new Error(`Refusing to start with insecure production configuration:\n- ${problems.join('\n- ')}`);
  }
}

export const VERSION = '0.3.0';
