import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import type { AuthConfig, AuthUser } from '../../services/api/authApi.js';
import { forgotPassword, resetPassword, verifyPasswordOtp } from '../../services/api/authApi.js';
import { Card, Btn, Field, inputCls } from '../../components/ui/ui.js';
import { TimezonePicker } from '../../components/ui/TimezonePicker.js';
import { NumberField } from '../../components/ui/NumberField.js';

export function SetupRequiredScreen({ setup, onRetry }: { setup: AuthConfig | null; onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center p-4 text-slate-200">
      <Card className="w-full border-amber-500/30">
        <h1 className="text-xl font-bold">LearnQuest account services need configuration</h1>
        <p className="mt-2 text-sm text-slate-400">
          Authentication is fail-closed. No fake account, predictable OTP, or local-only authenticated fallback can be enabled.
          Public playlist metadata fetching may still work if configured.
        </p>
        <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm">
          <p className="font-semibold text-amber-200">Required backend configuration is missing:</p>
          <p className="mt-1 font-mono text-xs text-amber-100">{(setup?.missing ?? ['MONGODB_URI', 'SESSION_SECRET', 'OTP_HMAC_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']).join(', ')}</p>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Add the values to the ignored <code>backend/.env</code>, keep <code>backend/.env.example</code> as the documented template,
          restart the API, then retry. See the multi-user implementation report for where to obtain each external credential.
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

type Mode = 'signin' | 'register' | 'forgot' | 'otp' | 'reset' | 'done';

export function AuthScreens({
  setup,
  authError,
  onPasswordLogin,
  onGoogle,
}: {
  setup: AuthConfig | null;
  authError: string | null;
  onPasswordLogin: (identifier: string, password: string) => Promise<void>;
  onGoogle: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const googleReady = Boolean(setup?.configured.google);
  const emailReady = Boolean(setup?.configured.brevo);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const run = async (fn: () => Promise<void>) => {
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

  const google = () => run(async () => {
    if (!googleReady) throw new Error('Google sign-in is not configured on this server yet.');
    await onGoogle();
  });

  const login = () => run(async () => {
    await onPasswordLogin(identifier.trim(), password);
  });

  const requestCode = async (resend = false) => {
    const result = await forgotPassword(identifier.trim());
    setChallengeId(result.challengeId);
    setNotice(result.message);
    setCooldown(60);
    setMode('otp');
    if (resend) setNotice('If that account exists, a new code has been sent.');
  };

  const startForgot = () => run(async () => {
    if (!identifier.trim()) throw new Error('Enter your username or account email first.');
    if (!emailReady) throw new Error('Password recovery email is not configured yet. Ask the administrator to set Brevo credentials.');
    await requestCode();
  });

  const verify = () => run(async () => {
    if (!/^\d{6}$/.test(otp.trim())) throw new Error('Enter the six-digit code from the email.');
    const result = await verifyPasswordOtp(challengeId, otp.trim());
    setResetToken(result.resetToken);
    setMode('reset');
    setNotice('Code verified. Choose a new password.');
  });

  const finishReset = () => run(async () => {
    if (newPassword.length < 12) throw new Error('Password must be at least 12 characters.');
    if (newPassword !== confirm) throw new Error('The passwords do not match.');
    await resetPassword(resetToken, newPassword);
    setMode('done');
    setPassword('');
    setNewPassword('');
    setConfirm('');
    setOtp('');
    setNotice('Password reset. All existing sessions were signed out. Sign in with your new password.');
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
              No invented numbers, and no silent local-only fallback.
            </p>
          </div>
          <ul className="space-y-2 text-sm text-slate-300">
            <li className="flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-300" /> Server-side sessions and account isolation</li>
            <li className="flex items-center gap-2"><LockKeyhole size={16} className="text-cyan-300" /> Argon2id password storage</li>
            <li className="flex items-center gap-2"><Mail size={16} className="text-violet-300" /> Six-digit OTP recovery through Brevo</li>
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
              <p className="mt-1 text-xs text-slate-400">Use Google, or your LearnQuest username/email and password.</p>
              {!googleReady && <p className="mt-2 rounded-xl bg-amber-500/10 p-2 text-xs text-amber-200">Google sign-in is not configured. {setup?.missing.filter((m) => m.startsWith('GOOGLE')).join(', ')}</p>}
              <Btn variant="primary" className="mt-3 w-full justify-center" onClick={google} disabled={busy || !googleReady}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : null} Continue with Google
              </Btn>
              <div className="my-4 flex items-center gap-2 text-[11px] uppercase tracking-widest text-slate-600">
                <span className="h-px flex-1 bg-white/10" /> or password <span className="h-px flex-1 bg-white/10" />
              </div>
              <form onSubmit={(e) => { e.preventDefault(); login(); }} className="space-y-2.5">
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
                Registration is Google-only. Your verified Google email is the initial account email; you never type an arbitrary address.
                You will choose a username, display name, and password next.
              </p>
              <Btn variant="primary" className="mt-4 w-full justify-center" onClick={google} disabled={busy || !googleReady}>
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
              <p className="mt-1 text-xs text-slate-400">Enter your username or account email. The response is generic and never reveals whether an account exists.</p>
              <div className="mt-3 space-y-2.5">
                <Field label="Username or email">
                  <input className={inputCls} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
                </Field>
                <Btn variant="primary" className="w-full justify-center" onClick={startForgot} disabled={busy || !identifier.trim() || !emailReady}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : null} Send six-digit code
                </Btn>
                {!emailReady && <p className="text-xs text-amber-200">Recovery email is not configured yet.</p>}
              </div>
              <button type="button" className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={() => setMode('signin')}>
                <ArrowLeft size={13} /> Back to sign in
              </button>
            </div>
          )}

          {mode === 'otp' && (
            <div className="mt-4">
              <h2 className="text-lg font-bold">Enter the six-digit code</h2>
              <p className="mt-1 text-xs text-slate-400">The code expires in about 10 minutes and can be used once.</p>
              <div className="mt-3 space-y-2.5">
                <Field label="Verification code">
                  <input
                    className={`${inputCls} text-center text-xl tracking-[0.5em]`}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                  />
                </Field>
                <Btn variant="primary" className="w-full justify-center" onClick={verify} disabled={busy || otp.length !== 6}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : null} Verify code
                </Btn>
                <Btn className="w-full justify-center" onClick={() => run(() => requestCode(true))} disabled={busy || cooldown > 0}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </Btn>
              </div>
            </div>
          )}

          {mode === 'reset' && (
            <div className="mt-4">
              <h2 className="text-lg font-bold">Choose a new password</h2>
              <p className="mt-1 text-xs text-slate-400">At least 12 characters. A long passphrase is ideal; paste and password managers are supported.</p>
              <form onSubmit={(e) => { e.preventDefault(); finishReset(); }} className="mt-3 space-y-2.5">
                <Field label="New password">
                  <input className={inputCls} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={12} />
                </Field>
                <Field label="Confirm new password">
                  <input className={inputCls} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} />
                </Field>
                <Btn type="submit" variant="primary" className="w-full justify-center" disabled={busy || newPassword.length < 12 || confirm.length < 12}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : null} Set new password
                </Btn>
              </form>
            </div>
          )}

          {mode === 'done' && (
            <div className="mt-5 text-center">
              <CheckCircle2 className="mx-auto text-emerald-400" size={34} />
              <h2 className="mt-2 text-lg font-bold">Password reset complete</h2>
              <p className="mt-1 text-sm text-slate-400">All earlier sessions were revoked. Sign in with your new password.</p>
              <Btn variant="primary" className="mt-4 w-full justify-center" onClick={() => { setMode('signin'); setNotice(null); }}>Back to sign in</Btn>
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
