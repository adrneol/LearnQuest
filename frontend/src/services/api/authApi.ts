import { apiRequest, setCsrfToken } from './http.js';

export interface AuthConfig {
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

export async function fetchAuthConfig(): Promise<AuthConfig> {
  return apiRequest<AuthConfig>('/auth/config');
}

export async function fetchSession(): Promise<SessionResponse> {
  const session = await apiRequest<SessionResponse>('/auth/session');
  if (session.authenticated && session.csrfToken) setCsrfToken(session.csrfToken);
  else setCsrfToken(null);
  return session;
}

export async function startGoogleAuth(): Promise<void> {
  const { url } = await apiRequest<{ url: string }>('/auth/google/start', { timeoutMs: 15_000 });
  window.location.assign(url);
}

export async function passwordLogin(identifier: string, password: string): Promise<SessionResponse> {
  const res = await apiRequest<SessionResponse>('/auth/login', { method: 'POST', body: { identifier, password } });
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

export async function forgotPassword(identifier: string): Promise<{ ok: boolean; challengeId: string; message: string }> {
  return apiRequest('/auth/forgot', { method: 'POST', body: { identifier } });
}

export async function verifyPasswordOtp(challengeId: string, code: string): Promise<{ ok: boolean; resetToken: string; expiresAt: string }> {
  return apiRequest('/auth/otp/verify', { method: 'POST', body: { challengeId, code } });
}

export async function resetPassword(resetToken: string, newPassword: string): Promise<void> {
  await apiRequest('/auth/password/reset', { method: 'POST', body: { resetToken, newPassword } });
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

export async function requestEmailChange(newEmail: string, password?: string): Promise<{ challengeId: string; expiresInMin: number; targetEmail: string }> {
  return apiRequest('/account/email/change', { method: 'POST', body: { newEmail, password } });
}

export async function verifyEmailChange(challengeId: string, code: string): Promise<{ user: AuthUser; csrfToken: string }> {
  const res = await apiRequest<{ user: AuthUser; csrfToken: string }>('/account/email/verify', {
    method: 'POST',
    body: { challengeId, code },
  });
  setCsrfToken(res.csrfToken);
  return res;
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
