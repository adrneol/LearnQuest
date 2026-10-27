import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft, CheckCircle2, Link2, Loader2, LockKeyhole, Mail, ShieldCheck,
} from 'lucide-react';
import type { AuthConfig, AuthUser } from '../../services/api/authApi.js';
import {
  confirmEmailChange, forgotPassword, resetPassword,
} from '../../services/api/authApi.js';
import { Card, Btn, Field, inputCls } from '../../components/ui/ui.js';
import { TimezonePicker } from '../../components/ui/TimezonePicker.js';
import { NumberField } from '../../components/ui/NumberField.js';

const AUTH_ERROR_COPY: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled. Nothing changed.',
  google_account_not_found: 'No LearnQuest account is linked to that Google identity. If you meant to join, choose Create an account.',
  google_account_exists: 'An account already exists for that Google identity. Use Sign in with Google instead.',
  LINK_REQUIRED: 'An account already uses this email with another sign-in method. Use the existing account or contact the LearnQuest administrator for a safe link.',
  EMAIL_NOT_VERIFIED: 'Google did not confirm a verified email address for this identity. No account was created.',
  ACCOUNT_UNAVAILABLE: 'That account is unavailable or is being deleted. No session was created.',
  INVALID_OAUTH_STATE: 'That Google sign-in request is invalid, expired, or already used. Start again.',
  INVALID_OAUTH_INTENT: 'Choose whether you want to sign in or create an account.',
  GOOGLE_EXCHANGE_FAILED: 'Google rejected the sign-in exchange. Start again.',
  GOOGLE_TIMEOUT: 'Google took too long to respond. Try again.',
  GOOGLE_UNAVAILABLE: 'Google could not be reached. Check your connection and try again.',
  INVALID_GOOGLE_TOKEN: 'Google returned an identity that LearnQuest could not verify. Start again.',
  ONBOARDING_SESSION_INVALID: 'Your Google registration session expired. Start account creation again with Google.',
  google_failed: 'Google sign-in did not complete. Nothing was changed; try again.',
};

function authRedirectCode(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  if (path !== 'auth') return null;
  return new URLSearchParams(query).get('error');
}

function clearOAuthErrorFromHash(): void {
  if (typeof window === 'undefined') return;
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  if (path !== 'auth' || !new URLSearchParams(query).has('error')) return;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/auth`);
}

export function SetupRequiredScreen({ setup, onRetry }: { setup: AuthConfig | null; onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center p-4 text-slate-200">
      <Card className="w-full border-amber-500/30">
        <h1 className="text-xl font-bold">LearnQuest account services need configuration</h1>
        <p className="mt-2 text-sm text-slate-400">
          Authentication is fail-closed. There is no fake account, numeric code, or local-only authenticated fallback.
          Public playlist metadata fetching may still work if configured.
        </p>
        <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm">
          <p className="font-semibold text-amber-200">Required backend configuration is missing:</p>
          <p className="mt-1 font-mono text-xs text-amber-100">
            {(setup?.missing ?? ['MONGODB_URI', 'SESSION_SECRET', 'EMAIL_ACTION_HMAC_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']).join(', ')}
          </p>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Add the values to the ignored <code>backend/.env</code>, keep <code>backend/.env.example</code> as the documented template,
          restart the API, then retry. See the multi-user deployment guide for where to obtain each external credential.
        </p>
        <div className="mt-4 flex gap-2">
          <Btn variant="primary" onClick={onRetry}>Retry configuration check</Btn>
        </div>
      </Card>
    </main>
  );
}

export function AccountErrorScreen({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut?: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center p-4 text-slate-200">
      <Card className="w-full border-red-500/30">
        <h1 className="text-xl font-bold">Your cloud account is unavailable</h1>
        <p role="alert" className="mt-2 text-sm text-red-200">{message}</p>
        <p className="mt-2 text-sm text-slate-400">
          LearnQuest did not fall back to browser-only state. Cloud saves are paused; nothing is reported as saved until the server confirms it.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="primary" onClick={onRetry}>Retry</Btn>
          {onSignOut && <Btn onClick={onSignOut}>Sign out</Btn>}
        </div>
      </Card>
    </main>
  );
}

type Mode = 'signin' | 'register' | 'forgot' | 'sent';

export function AuthScreens({
  setup,
  authError,
  onPasswordLogin,
  onGoogle,
}: {
  setup: AuthConfig | null;
  authError: string | null;
  onPasswordLogin: (identifier: string, password: string) => Promise<void>;
  onGoogle: (intent: 'login' | 'register') => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = authRedirectCode();
    return code ? (AUTH_ERROR_COPY[code] ?? `Google sign-in failed (${code}). Nothing was changed.`) : null;
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const googleReady = Boolean(setup?.configured?.google);
  const emailReady = Boolean(setup?.configured?.brevo);
  const emailLinksReady = Boolean(setup?.configured?.emailLinks);

  useEffect(() => {
    clearOAuthErrorFromHash();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message ?? 'The request failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const google = (intent: 'login' | 'register') => run(async () => {
    if (!googleReady) throw new Error('Google sign-in is not configured on this server yet.');
    await onGoogle(intent);
  });

  const login = () => run(async () => {
    if (!identifier.trim() || !password) throw new Error('Enter your username or email and password.');
    await onPasswordLogin(identifier.trim(), password);
  });

  const requestLink = (resend = false) => run(async () => {
    if (!identifier.trim()) throw new Error('Enter your username or account email first.');
    if (!emailReady) throw new Error('Password recovery email is not configured yet. Ask the administrator to set Brevo credentials.');
    const result = await forgotPassword(identifier.trim());
    setNotice(resend ? 'If that account exists, a new single-use reset link has been sent.' : result.message);
    setCooldown(60);
    setMode('sent');
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-4 text-slate-200">
      <div className="grid w-full gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden flex-col justify-between rounded-3xl border border-white/10 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.32),transparent_65%),radial-gradient(ellipse_at_bottom,rgba(34,211,238,0.16),transparent_60%)] p-8 lg:flex">
          <div>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-500 text-sm font-black">LQ</span>
            <h1 className="mt-5 text-3xl font-black tracking-tight">Your learning quest, private to your account.</h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">
              Progress, notes, revision history, Focus sessions, checkpoints, and XP live in your authenticated cloud account.
              The server remains the authority for every sign-in and every save.
            </p>
          </div>
          <ul className="space-y-2 text-sm text-slate-300">
            <li className="flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-300" /> Server-side sessions and account isolation</li>
            <li className="flex items-center gap-2"><LockKeyhole size={16} className="text-cyan-300" /> Argon2id password storage</li>
            <li className="flex items-center gap-2"><Mail size={16} className="text-violet-300" /> Single-use email reset links through Brevo</li>
          </ul>
        </section>

        <Card className="w-full border-violet-500/25">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 text-xs font-black">LQ</span>
            <div>
              <p className="text-sm font-bold">LearnQuest</p>
              <p className="text-[11px] text-slate-500">secure account access</p>
            </div>
          </div>

          {(authError || error) && <p role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-200">{error ?? authError}</p>}
          {notice && <p role="status" className="mt-3 rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-2.5 text-sm text-cyan-100">{notice}</p>}

          {mode === 'signin' && (
            <div className="mt-4">
              <h2 className="text-lg font-bold">Sign in</h2>
              <p className="mt-1 text-xs text-slate-400">
                Use Google or your LearnQuest password. Sign-in only works for an account that already exists.
              </p>
              {!googleReady && <p className="mt-2 rounded-xl bg-amber-500/10 p-2 text-xs text-amber-200">Google sign-in is not configured. {setup?.missing?.filter((m) => m.startsWith('GOOGLE')).join(', ')}</p>}
              <Btn variant="primary" className="mt-3 w-full justify-center" onClick={() => google('login')} disabled={busy || !googleReady}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : null} Sign in with Google
              </Btn>
              <div className="my-4 flex items-center gap-2 text-[11px] uppercase tracking-widest text-slate-600">
                <span className="h-px flex-1 bg-white/10" /> or password <span className="h-px flex-1 bg-white/10" />
              </div>
              <form onSubmit={(e) => { e.preventDefault(); void login(); }} className="space-y-2.5">
                <Field label="Username or email">
                  <input className={inputCls} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
                </Field>
                <Field label="Password">
                  <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                </Field>
                <Btn type="submit" variant="primary" className="w-full justify-center" disabled={busy || !identifier.trim() || !password}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : null} Sign in
                </Btn>
              </form>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <button type="button" className="text-cyan-300 hover:underline" onClick={() => { setMode('forgot'); setError(null); setNotice(null); }}>Forgot password?</button>
                <button type="button" className="text-violet-300 hover:underline" onClick={() => { setMode('register'); setError(null); setNotice(null); }}>Create an account</button>
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div className="mt-4">
              <h2 className="text-lg font-bold">Create your account with Google</h2>
              <p className="mt-1 text-sm text-slate-400">
                Registration is Google-only. Google verifies your identity and email first; you then choose a unique username,
                display name, and password. Typing an email address here cannot create an account.
              </p>
              <Btn variant="primary" className="mt-4 w-full justify-center" onClick={() => google('register')} disabled={busy || !googleReady}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : null} Continue with Google
              </Btn>
              <button type="button" className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={() => setMode('signin')}>
                <ArrowLeft size={13} /> Back to sign in
              </button>
            </div>
          )}

          {mode === 'forgot' && (
            <div className="mt-4">
              <h2 className="text-lg font-bold">Reset your password</h2>
              <p className="mt-1 text-xs text-slate-400">
                Enter your username or account email. If an account matches, LearnQuest sends a single-use reset link.
                The response is deliberately generic and does not reveal whether an account exists.
              </p>
              {!emailLinksReady && <p className="mt-2 text-xs text-amber-200">Email action links are not configured on the server yet.</p>}
              <div className="mt-3 space-y-2.5">
                <Field label="Username or email">
                  <input className={inputCls} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
                </Field>
                <Btn variant="primary" className="w-full justify-center" onClick={() => void requestLink()} disabled={busy || !identifier.trim() || !emailReady || !emailLinksReady}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : null} Send password reset link
                </Btn>
                {!emailReady && <p className="text-xs text-amber-200">Recovery email is not configured yet.</p>}
              </div>
              <button type="button" className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={() => setMode('signin')}>
                <ArrowLeft size={13} /> Back to sign in
              </button>
            </div>
          )}

          {mode === 'sent' && (
            <div className="mt-5 text-center">
              <Mail className="mx-auto text-violet-300" size={34} />
              <h2 className="mt-2 text-lg font-bold">Check your email</h2>
              <p className="mt-1 text-sm text-slate-400">
                If an account matches, a single-use password reset link is on its way. It expires shortly and cannot be reused.
                The link opens a confirmation page; it is not a numeric code.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <Btn onClick={() => void requestLink(true)} disabled={busy || cooldown > 0}>
                  {cooldown > 0 ? `Send another link in ${cooldown}s` : 'Send another link'}
                </Btn>
                <Btn variant="primary" onClick={() => { setMode('signin'); setNotice(null); }}>Back to sign in</Btn>
              </div>
            </div>
          )}

          <p className="mt-4 text-[11px] leading-5 text-slate-500">
            Credentials are sent only to the LearnQuest API over HTTPS in production. The backend stores an HttpOnly session cookie;
            no session token, OAuth token, or password is kept in localStorage.
          </p>
        </Card>
      </div>
    </main>
  );
}

/** Link-only password recovery. The token is already in memory, never displayed. */
export function PasswordResetScreen({ token, onExit }: { token: string | null; onExit: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : 'This password reset link is missing its token. Request a new link.');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    if (password.length < 12) { setError('Password must be at least 12 characters.'); return; }
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setPassword('');
      setConfirm('');
    } catch (err: any) {
      setError(err?.message ?? 'This reset link is invalid, expired, or already used. Request a new link.');
      setPassword('');
      setConfirm('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center p-4 text-slate-200">
      <Card className="w-full border-violet-500/25">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 text-xs font-black">LQ</span>
          <div>
            <p className="text-sm font-bold">LearnQuest</p>
            <p className="text-[11px] text-slate-500">secure password recovery</p>
          </div>
        </div>
        {done ? (
          <div className="mt-5 text-center">
            <CheckCircle2 className="mx-auto text-emerald-400" size={34} />
            <h1 className="mt-2 text-xl font-bold">Password reset complete</h1>
            <p className="mt-1 text-sm text-slate-400">All earlier sessions were signed out. Sign in with your new password.</p>
            <Btn variant="primary" className="mt-4 w-full justify-center" onClick={onExit}>Back to sign in</Btn>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
            <h1 className="text-xl font-bold">Choose a new password</h1>
            <p className="text-xs text-slate-400">
              This single-use link expires shortly. Choose at least 12 characters; a long passphrase is ideal.
            </p>
            {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-200">{error}</p>}
            <Field label="New password">
              <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={12} disabled={!token || busy} />
            </Field>
            <Field label="Confirm new password">
              <input className={inputCls} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} disabled={!token || busy} />
            </Field>
            <Btn type="submit" variant="primary" className="w-full justify-center" disabled={!token || busy || password.length < 12 || confirm.length < 12}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : null} Set new password
            </Btn>
            <button type="button" className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={onExit}>
              <ArrowLeft size={13} /> Request a new link
            </button>
          </form>
        )}
      </Card>
    </main>
  );
}

/** Explicit POST for email-change verification; GET never mutates the account. */
export function EmailVerificationScreen({ token, onExit }: { token: string | null; onExit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : 'This email verification link is missing its token. Request a new link from Account → Security.');

  const verify = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await confirmEmailChange(token);
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? 'This email verification link is invalid, expired, or already used. Request a new one.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center p-4 text-slate-200">
      <Card className="w-full border-violet-500/25">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 text-xs font-black">LQ</span>
          <div>
            <p className="text-sm font-bold">LearnQuest</p>
            <p className="text-[11px] text-slate-500">verified email change</p>
          </div>
        </div>
        {done ? (
          <div className="mt-5 text-center">
            <CheckCircle2 className="mx-auto text-emerald-400" size={34} />
            <h1 className="mt-2 text-xl font-bold">Email verified</h1>
            <p className="mt-1 text-sm text-slate-400">The new address is now your LearnQuest account email. All sessions were signed out; sign in again with the new address.</p>
            <Btn variant="primary" className="mt-4 w-full justify-center" onClick={onExit}>Back to sign in</Btn>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <h1 className="text-xl font-bold">Verify your new email address</h1>
            <p className="text-sm text-slate-400">
              This confirms the new address for your LearnQuest account. Your current email stays active until verification succeeds.
              The single-use link expires shortly.
            </p>
            {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-200">{error}</p>}
            <Btn variant="primary" className="w-full justify-center" onClick={() => void verify()} disabled={!token || busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} Verify email address
            </Btn>
            <button type="button" className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={onExit}>
              <ArrowLeft size={13} /> Back to sign in
            </button>
          </div>
        )}
      </Card>
    </main>
  );
}

export function OnboardingScreen({
  user,
  onSubmit,
  onSignOut,
}: {
  user: AuthUser;
  onSubmit: (input: {
    username: string; displayName: string; password: string; timezone?: string;
    sessionLenMin?: number; breakMin?: number; minViableMin?: number;
  }) => Promise<void>;
  onSignOut: () => void;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [timezone, setTimezone] = useState(user.timezone || 'local');
  const [sessionLenMin, setSessionLenMin] = useState<number | null>(user.sessionLenMin ?? 25);
  const [breakMin, setBreakMin] = useState<number | null>(user.breakMin ?? 5);
  const [minViableMin, setMinViableMin] = useState<number | null>(user.minViableMin ?? 10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (password.length < 12) throw new Error('Password must be at least 12 characters.');
      if (password !== confirm) throw new Error('The passwords do not match.');
      await onSubmit({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        timezone,
        ...(sessionLenMin !== null ? { sessionLenMin } : {}),
        ...(breakMin !== null ? { breakMin } : {}),
        ...(minViableMin !== null ? { minViableMin } : {}),
      });
    } catch (err: any) {
      setError(err?.message ?? 'Your setup could not be saved. Your inputs were kept; retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center p-4 text-slate-200">
      <Card className="w-full border-violet-500/30">
        <p className="text-[11px] font-bold uppercase tracking-widest text-violet-300">First-time setup</p>
        <h1 className="mt-1 text-2xl font-black">Finish your LearnQuest account</h1>
        <p className="mt-1 text-sm text-slate-400">
          Your verified Google email is <span className="text-slate-200">{user.email}</span>. It cannot be typed or changed here.
          Choose your public username and a password for direct sign-in.
        </p>
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Username">
            <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={32} />
          </Field>
          <Field label="Display name">
            <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" required maxLength={80} />
          </Field>
          <Field label="Password (at least 12 characters)">
            <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={12} required />
          </Field>
          <Field label="Confirm password">
            <input className={inputCls} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} required />
          </Field>
          <div className="sm:col-span-2">
            <TimezonePicker value={timezone} onChange={setTimezone} />
          </div>
          <NumberField label="Default session length (min)" value={sessionLenMin} onCommit={setSessionLenMin} min={1} max={600} allowEmpty={false} />
          <NumberField label="Break length (min)" value={breakMin} onCommit={setBreakMin} min={0} max={240} allowEmpty={false} />
          <NumberField label="Minimum viable session (min)" value={minViableMin} onCommit={setMinViableMin} min={1} max={600} allowEmpty={false} />
          <div className="sm:col-span-2">
            {error && <p role="alert" className="mb-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-200">{error}</p>}
            <Btn type="submit" variant="primary" className="w-full justify-center" disabled={busy || !username.trim() || !displayName.trim() || password.length < 12}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : null} Complete setup
            </Btn>
          </div>
        </form>
        <button type="button" onClick={onSignOut} className="mt-3 text-xs text-slate-400 hover:text-slate-200">Sign out instead</button>
      </Card>
    </main>
  );
}
