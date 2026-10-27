import { ApiError, apiRequest, setCsrfToken } from './http.js';

export interface AuthConfig {
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
}

export interface AuthUser {
  userId: string;
  email: string;
  username: string | null;
  displayName: string | null;
  onboardingComplete: boolean;
  timezone: string;
  sessionLenMin: number;
  breakMin: number;
  minViableMin: number;
  createdAt: string;
  hasPassword: boolean;
  googleLinked: boolean;
}

export interface SessionResponse extends AuthConfig {
  authenticated: boolean;
  user?: AuthUser;
  csrfToken?: string;
  onboardingRequired?: boolean;
}

export interface PasswordLoginResponse {
  authenticated: true;
  user: AuthUser;
  csrfToken: string;
}

export interface AccountSession {
  sessionId: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  expiresAt: string;
  userAgent: string;
  current: boolean;
}

export interface ServerState {
  playlists: Record<string, any>;
  meta: Record<string, any>;
  activeId: string | null;
  progress: Record<string, any>;
  ranges: any[];
  checkpoints: any[];
  modules: any[];
  sessions: any[];
  goals: Record<string, any>;
  xp: any[];
  achievements: Record<string, any>;
  segments: any[];
  playSessions: any[];
  queue: Record<string, any>;
  flexGoals: any[];
  challenge: any;
  challengeEnabled: boolean;
  rankHistory: any[];
  settings: any;
  prefs: any;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ApiError(
      `The account service returned an incompatible configuration response (${field}). Deploy the matching frontend and backend versions, then retry.`,
      502,
      'INVALID_AUTH_CONFIG',
    );
  }
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ApiError(
      `The account service returned an incompatible response (${field}). Deploy the matching frontend and backend versions, then retry.`,
      502,
      'INVALID_AUTH_RESPONSE',
    );
  }
  return value;
}

/**
 * Validate the configuration payload at the network boundary. Optional
 * chaining on a partial response previously allowed a render-time TypeError
 * (`undefined.mongodb`). A malformed response is now a truthful, actionable
 * error and can never be mistaken for a usable authentication configuration.
 */
export function validateAuthConfig(value: unknown): AuthConfig {
  if (!isObject(value)) {
    throw new ApiError('The account service returned an invalid configuration response.', 502, 'INVALID_AUTH_CONFIG');
  }
  if (!isObject(value.configured)) {
    throw new ApiError(
      'The account service did not return its configuration status. This usually means the deployed frontend and backend versions do not match.',
      502,
      'INVALID_AUTH_CONFIG',
    );
  }
  const c = value.configured;
  return {
    nodeEnv: readString(value.nodeEnv, 'nodeEnv'),
    authEnabled: readBoolean(value.authEnabled, 'authEnabled'),
    setupRequired: readBoolean(value.setupRequired, 'setupRequired'),
    configured: {
      mongodb: readBoolean(c.mongodb, 'configured.mongodb'),
      google: readBoolean(c.google, 'configured.google'),
      brevo: readBoolean(c.brevo, 'configured.brevo'),
      session: readBoolean(c.session, 'configured.session'),
      emailLinks: readBoolean(c.emailLinks, 'configured.emailLinks'),
      youtube: readBoolean(c.youtube, 'configured.youtube'),
    },
    missing: Array.isArray(value.missing) && value.missing.every((m) => typeof m === 'string')
      ? (value.missing as string[])
      : (() => { throw new ApiError('The account service returned an invalid missing-configuration list.', 502, 'INVALID_AUTH_CONFIG'); })(),
    cookieSecure: readBoolean(value.cookieSecure, 'cookieSecure'),
    appOrigin: readString(value.appOrigin, 'appOrigin'),
  };
}

function validateAuthUser(value: unknown): AuthUser {
  if (!isObject(value)) {
    throw new ApiError('The account service returned an incomplete account profile.', 502, 'INVALID_AUTH_RESPONSE');
  }
  for (const field of ['userId', 'email', 'timezone', 'createdAt'] as const) {
    readString(value[field], `user.${field}`);
  }
  readBoolean(value.onboardingComplete, 'user.onboardingComplete');
  readBoolean(value.hasPassword, 'user.hasPassword');
  readBoolean(value.googleLinked, 'user.googleLinked');
  for (const field of ['sessionLenMin', 'breakMin', 'minViableMin'] as const) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
      throw new ApiError('The account service returned an incomplete account profile.', 502, 'INVALID_AUTH_RESPONSE');
    }
  }
  if (value.username !== null && typeof value.username !== 'string') {
    throw new ApiError('The account service returned an invalid account profile.', 502, 'INVALID_AUTH_RESPONSE');
  }
  if (value.displayName !== null && typeof value.displayName !== 'string') {
    throw new ApiError('The account service returned an invalid account profile.', 502, 'INVALID_AUTH_RESPONSE');
  }
  return value as unknown as AuthUser;
}

export function validateSessionResponse(value: unknown): SessionResponse {
  const config = validateAuthConfig(value);
  if (!isObject(value) || typeof value.authenticated !== 'boolean') {
    throw new ApiError('The account service returned an invalid session response.', 502, 'INVALID_AUTH_RESPONSE');
  }
  const response: SessionResponse = { ...config, authenticated: value.authenticated };
  if (value.authenticated) {
    if (!value.user || typeof value.csrfToken !== 'string' || !value.csrfToken) {
      // Never turn a partial response into an authenticated UI.
      throw new ApiError(
        'The account service reported a session without a complete profile or security token. Sign in again after the deployment finishes.',
        502,
        'INVALID_AUTH_RESPONSE',
      );
    }
    response.user = validateAuthUser(value.user);
    response.csrfToken = value.csrfToken;
    response.onboardingRequired = value.onboardingRequired === true;
  }
  return response;
}

function validatePasswordLoginResponse(value: unknown): PasswordLoginResponse {
  if (!isObject(value) || value.authenticated !== true) {
    throw new ApiError('The account service did not confirm the sign-in. You are not signed in.', 502, 'INVALID_AUTH_RESPONSE');
  }
  if (typeof value.csrfToken !== 'string' || !value.csrfToken) {
    throw new ApiError('The account service did not return a security token. Sign in again.', 502, 'INVALID_AUTH_RESPONSE');
  }
  return {
    authenticated: true,
    user: validateAuthUser(value.user),
    csrfToken: value.csrfToken,
  };
}

function validateGoogleStart(value: unknown): { url: string; intent: 'login' | 'register' } {
  if (!isObject(value) || typeof value.url !== 'string') {
    throw new ApiError('The account service did not return a Google sign-in URL.', 502, 'INVALID_OAUTH_RESPONSE');
  }
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new ApiError('The account service returned an invalid Google sign-in URL.', 502, 'INVALID_OAUTH_RESPONSE');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') {
    throw new ApiError('The account service returned an unexpected sign-in destination. Nothing was opened.', 502, 'INVALID_OAUTH_RESPONSE');
  }
  const intent = value.intent === 'register' ? 'register' : 'login';
  return { url: url.toString(), intent };
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  return validateAuthConfig(await apiRequest<unknown>('/auth/config'));
}

export async function fetchSession(): Promise<SessionResponse> {
  const session = validateSessionResponse(await apiRequest<unknown>('/auth/session'));
  if (session.authenticated && session.csrfToken) setCsrfToken(session.csrfToken);
  else setCsrfToken(null);
  return session;
}

export async function startGoogleAuth(intent: 'login' | 'register'): Promise<void> {
  const result = validateGoogleStart(await apiRequest<unknown>(
    `/auth/google/start?intent=${encodeURIComponent(intent)}`,
    { timeoutMs: 15_000 },
  ));
  window.location.assign(result.url);
}

export async function passwordLogin(identifier: string, password: string): Promise<PasswordLoginResponse> {
  const res = validatePasswordLoginResponse(await apiRequest<unknown>('/auth/login', {
    method: 'POST',
    body: { identifier, password },
  }));
  setCsrfToken(res.csrfToken);
  return res;
}

export async function completeOnboarding(input: {
  username: string;
  displayName: string;
  password: string;
  timezone?: string;
  sessionLenMin?: number;
  breakMin?: number;
  minViableMin?: number;
}): Promise<{ user: AuthUser; csrfToken: string }> {
  const res = await apiRequest<{ user: AuthUser; csrfToken: string }>('/auth/onboarding', { method: 'POST', body: input });
  if (!res || typeof res.csrfToken !== 'string' || !res.user) {
    throw new ApiError('The account service did not confirm setup. Retry from the sign-in page.', 502, 'INVALID_AUTH_RESPONSE');
  }
  setCsrfToken(res.csrfToken);
  return res;
}

export async function logout(): Promise<void> {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } finally {
    setCsrfToken(null);
  }
}

export async function logoutAll(): Promise<void> {
  try {
    await apiRequest('/auth/logout-all', { method: 'POST' });
  } finally {
    setCsrfToken(null);
  }
}

export async function forgotPassword(identifier: string): Promise<{ ok: boolean; message: string }> {
  return apiRequest('/auth/forgot', { method: 'POST', body: { identifier } });
}

// The reset token is captured from the URL fragment by the recovery screen and
// exchanged only through this explicit POST. It is never sent in a page GET.
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await apiRequest('/auth/password/reset', { method: 'POST', body: { token, newPassword } });
}

export async function changePassword(currentPassword: string | null, newPassword: string): Promise<{ csrfToken: string }> {
  const res = await apiRequest<{ ok: boolean; csrfToken: string }>('/auth/password/change', {
    method: 'POST',
    body: { currentPassword: currentPassword ?? undefined, newPassword },
  });
  setCsrfToken(res.csrfToken);
  return res;
}

export async function reauthenticate(password?: string): Promise<void> {
  await apiRequest('/auth/reauth', { method: 'POST', body: { password } });
}

export async function updateProfile(input: { username?: string; displayName?: string }): Promise<AuthUser> {
  const res = await apiRequest<{ user: AuthUser }>('/account/profile', { method: 'PATCH', body: input });
  return res.user;
}

export async function updateAccountPreferences(input: {
  timezone?: string; sessionLenMin?: number; breakMin?: number; minViableMin?: number;
}): Promise<AuthUser> {
  const res = await apiRequest<{ user: AuthUser }>('/account/preferences', { method: 'PATCH', body: input });
  return res.user;
}

export async function listAccountSessions(): Promise<{ sessions: AccountSession[] }> {
  return apiRequest('/account/sessions');
}

export async function revokeAccountSession(sessionId: string): Promise<void> {
  await apiRequest(`/account/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

export async function requestEmailChange(newEmail: string, password?: string): Promise<{
  ok: boolean; email: string; expiresInMin: number; message: string;
}> {
  return apiRequest('/account/email/change', { method: 'POST', body: { newEmail, password } });
}

export async function confirmEmailChange(token: string): Promise<{ ok: boolean; email: string; message: string }> {
  return apiRequest('/account/email/confirm', { method: 'POST', body: { token } });
}

export async function deleteAccount(confirmUsername: string, password?: string): Promise<void> {
  await apiRequest('/account/delete', { method: 'POST', body: { confirmUsername, password } });
  setCsrfToken(null);
}

export async function fetchAccountData(): Promise<{ state: ServerState; version: number }> {
  return apiRequest('/account/data', { timeoutMs: 30_000 });
}

export async function putAccountCollection(
  collection: string,
  items: unknown,
  version: number,
): Promise<{ version: number; collection: string; savedAt: string }> {
  return apiRequest(`/account/data/${encodeURIComponent(collection)}`, {
    method: 'PUT',
    body: { version, items },
    timeoutMs: 30_000,
  });
}

export async function importAccountBackup(payload: unknown, version?: number): Promise<{ version: number }> {
  return apiRequest('/account/import', { method: 'POST', body: { backup: payload, version }, timeoutMs: 60_000 });
}

export async function migrateLocalData(migrationId: string, payload: unknown, version?: number): Promise<{
  ok: boolean; version?: number; alreadyApplied?: boolean; migratedAt?: string; collections?: Record<string, { added: number; skipped: number }>;
}> {
  return apiRequest('/account/migrate', { method: 'POST', body: { migrationId, state: payload, version }, timeoutMs: 60_000 });
}

export async function downloadAccountExport(): Promise<void> {
  const blob = await apiRequest<Blob>('/account/export', { raw: true, timeoutMs: 30_000 });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `learnquest-account-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function archivePlaylistApi(playlistId: string, version: number) {
  return apiRequest<{ ok: boolean; version: number; activeId: string | null; archived: boolean }>(
    `/playlists/${encodeURIComponent(playlistId)}/archive`,
    { method: 'POST', body: { version } },
  );
}

export async function restorePlaylistApi(playlistId: string, version: number) {
  return apiRequest<{ ok: boolean; version: number; activeId: string | null; archived: boolean }>(
    `/playlists/${encodeURIComponent(playlistId)}/restore`,
    { method: 'POST', body: { version } },
  );
}

export async function deletePlaylistApi(playlistId: string, version: number, confirmTitle: string) {
  return apiRequest<{
    ok: boolean; deleted: boolean; alreadyDeleted?: boolean; activeId: string | null;
    deletedCounts: Record<string, number>; title?: string;
  }>(`/playlists/${encodeURIComponent(playlistId)}`, {
    method: 'DELETE',
    body: { version, confirmTitle },
    timeoutMs: 60_000,
  });
}

export async function playlistSummaryApi(playlistId: string) {
  return apiRequest<{
    playlistId: string;
    title: string;
    counts: Record<string, number>;
  }>(`/playlists/${encodeURIComponent(playlistId)}/summary`);
}
