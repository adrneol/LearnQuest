import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Download, KeyRound, LogOut, Mail, RefreshCw, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { confirmDialog } from '../../components/ui/dialog.js';
import { Card, Btn, Field, inputCls } from '../../components/ui/ui.js';
import { TimezonePicker } from '../../components/ui/TimezonePicker.js';
import { NumberField } from '../../components/ui/NumberField.js';
import type { AccountSession } from '../../services/api/authApi.js';
import type { AccountSection } from './AccountMenu.js';

export function Account({ section, onSection }: { section: AccountSection; onSection: (s: AccountSection) => void }) {
  const s = useStore();
  const user = s.authUser;
  if (!user) return null;
  return (
    <div className="space-y-4">
      <Card className="border-violet-500/25">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-500 text-sm font-black">
            {(user.displayName || user.username || user.email).slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">{user.displayName || user.username}</h1>
            <p className="truncate text-xs text-slate-400">{user.email} · @{user.username}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] ${s.syncStatus === 'error' || s.syncStatus === 'conflict' ? 'bg-red-500/15 text-red-200' : s.syncStatus === 'saving' ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'}`}>
            {s.syncStatus === 'saving' ? 'Saving to server…' : s.syncStatus === 'error' ? 'Save failed' : s.syncStatus === 'conflict' ? 'Save conflict' : s.syncStatus === 'saved' ? 'Cloud saves confirmed' : 'Cloud account'}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Account sections">
          <SectionBtn active={section === 'profile'} onClick={() => onSection('profile')} icon={<UserRound size={14} />}>Profile</SectionBtn>
          <SectionBtn active={section === 'settings'} onClick={() => onSection('settings')} icon={<ShieldCheck size={14} />}>Account settings</SectionBtn>
          <SectionBtn active={section === 'security'} onClick={() => onSection('security')} icon={<KeyRound size={14} />}>Security & sessions</SectionBtn>
        </div>
      </Card>

      {section === 'profile' && <ProfileSection />}
      {section === 'settings' && <SettingsSection />}
      {section === 'security' && <SecuritySection />}
    </div>
  );
}

function SectionBtn({ active, onClick, children, icon }: { active: boolean; onClick: () => void; children: ReactNode; icon: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium ${active ? 'bg-violet-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
    >
      {icon}{children}
    </button>
  );
}

function ProfileSection() {
  const s = useStore();
  const user = s.authUser!;
  const [username, setUsername] = useState(user.username ?? '');
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setUsername(user.username ?? '');
    setDisplayName(user.displayName ?? '');
  }, [user.username, user.displayName]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await s.updateProfile({ username: username.trim(), displayName: displayName.trim() });
      setMessage('Profile saved. Your username is unique across LearnQuest.');
    } catch (e: any) {
      setError(e?.message ?? 'Profile could not be saved. Your input was kept.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="text-base font-bold">Profile</h2>
      <p className="mt-1 text-xs text-slate-400">Your email is managed through verified account security, never typed at signup.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Email (verified)">
          <input className={inputCls} value={user.email} readOnly aria-readonly="true" />
        </Field>
        <Field label="Username">
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} autoComplete="username" />
        </Field>
        <Field label="Display name">
          <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} autoComplete="name" />
        </Field>
        <div className="rounded-xl bg-white/5 p-2.5 text-xs text-slate-400">
          <p>Google identity: <b className="text-slate-200">{user.googleLinked ? 'linked by stable provider subject' : 'not linked'}</b></p>
          <p className="mt-1">Password sign-in: <b className="text-slate-200">{user.hasPassword ? 'enabled' : 'not set'}</b></p>
          <p className="mt-1">Member since {new Date(user.createdAt).toLocaleDateString()}</p>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
      {message && <p role="status" className="mt-2 text-sm text-emerald-300">{message}</p>}
      <Btn variant="primary" className="mt-3" onClick={save} disabled={busy || !username.trim() || !displayName.trim()}>
        {busy ? 'Saving…' : 'Save profile'}
      </Btn>
    </Card>
  );
}

function SettingsSection() {
  const s = useStore();
  const user = s.authUser!;
  const [timezone, setTimezone] = useState(s.prefs.timezone);
  const [sessionLen, setSessionLen] = useState<number | null>(s.prefs.sessionLenMin);
  const [breakMin, setBreakMin] = useState<number | null>(s.prefs.breakMin);
  const [minViable, setMinViable] = useState<number | null>(s.prefs.minViableMin);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await s.updateAccountPreferences({
        timezone,
        ...(sessionLen !== null ? { sessionLenMin: sessionLen } : {}),
        ...(breakMin !== null ? { breakMin } : {}),
        ...(minViable !== null ? { minViableMin: minViable } : {}),
      });
      setMessage('Learning preferences saved to your account and available on other devices.');
    } catch (e: any) {
      setError(e?.message ?? 'Preferences could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const exportData = async () => {
    setError(null);
    try {
      await s.exportAccountData();
      setMessage('Account export downloaded.');
    } catch (e: any) {
      setError(e?.message ?? 'Export failed.');
    }
  };

  const removeAccount = async () => {
    setError(null);
    if (!user.username || confirmName !== user.username) {
      setError('Type your exact username to enable account deletion.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Permanently delete this LearnQuest account?',
      body: 'This removes the account, learning data, sessions, and all related records from MongoDB. It cannot be undone through LearnQuest. Export a copy first.',
      confirmLabel: 'Delete account permanently',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await s.deleteAccount(confirmName, deletePassword || undefined);
    } catch (e: any) {
      setError(e?.message ?? 'Account deletion failed. Nothing was reported as deleted; retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-base font-bold">Learning preferences</h2>
        <p className="mt-1 text-xs text-slate-400">These belong to your account and are stored on the server, not only in this browser.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TimezonePicker value={timezone} onChange={setTimezone} />
          <div className="space-y-3">
            <NumberField label="Default session length (min)" value={sessionLen} onCommit={setSessionLen} min={1} max={600} allowEmpty={false} />
            <NumberField label="Break length (min)" value={breakMin} onCommit={setBreakMin} min={0} max={240} allowEmpty={false} />
            <NumberField label="Minimum viable session (min)" value={minViable} onCommit={setMinViable} min={1} max={600} allowEmpty={false} />
          </div>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
        {message && <p role="status" className="mt-2 text-sm text-emerald-300">{message}</p>}
        <Btn variant="primary" className="mt-3" onClick={save} disabled={busy}>Save preferences</Btn>
      </Card>

      <Card>
        <h2 className="text-base font-bold">Account data</h2>
        <p className="mt-1 text-sm text-slate-400">Download a JSON export with account profile and all learning data. It never includes password hashes, email action tokens, or session tokens.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn onClick={exportData}><Download size={14} /> Export account data</Btn>
          <Btn disabled={busy} onClick={() => { void s.listAccountSessions().then(() => s.refreshSession()); }}><RefreshCw size={14} /> Refresh account state</Btn>
        </div>
      </Card>

      <Card className="border-red-500/25">
        <h2 className="flex items-center gap-1.5 text-base font-bold text-red-200"><Trash2 size={16} /> Delete account</h2>
        <p className="mt-1 text-sm text-slate-400">
          Deletion requires your exact username and recent reauthentication. It removes MongoDB learning records, sessions, and the account.
          Other accounts are never affected. This cannot be undone through LearnQuest.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Field label="Type your exact username">
            <input className={inputCls} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={user.hasPassword ? 'Current password' : 'Google reauthentication is required'}>
            <input className={inputCls} type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} autoComplete="current-password" disabled={!user.hasPassword} />
          </Field>
        </div>
        <Btn variant="danger" className="mt-3" onClick={removeAccount} disabled={busy || !confirmName || (user.hasPassword && !deletePassword)}>
          <Trash2 size={14} /> Delete my account permanently
        </Btn>
      </Card>
    </div>
  );
}

function SecuritySection() {
  const s = useStore();
  const user = s.authUser!;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailRequest, setEmailRequest] = useState<{ email: string; expiresInMin: number } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);

  const loadSessions = useCallback(async () => {
    setSessionsBusy(true);
    setSessionsError(null);
    try {
      setSessions(await s.listAccountSessions());
    } catch (e: any) {
      setSessionsError(e?.message ?? 'Active sessions could not be loaded.');
    } finally {
      setSessionsBusy(false);
    }
  }, [s]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  const changePassword = async () => {
    setPasswordError(null);
    setPasswordMessage(null);
    if (newPassword.length < 12) { setPasswordError('Password must be at least 12 characters.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('The new passwords do not match.'); return; }
    setPasswordBusy(true);
    try {
      await s.changeAccountPassword(user.hasPassword ? currentPassword : null, newPassword);
      setPasswordMessage('Password changed. Other sessions were revoked and this session was rotated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await loadSessions();
    } catch (e: any) {
      setPasswordError(e?.message ?? 'Password could not be changed.');
    } finally {
      setPasswordBusy(false);
    }
  };

  const requestEmail = async () => {
    setEmailError(null);
    setEmailMessage(null);
    setEmailBusy(true);
    try {
      const result = await s.requestEmailChange(newEmail.trim(), emailPassword || undefined);
      setEmailRequest({ email: result.email, expiresInMin: result.expiresInMin });
      setEmailMessage(`A secure verification link was sent to ${result.email}. It expires in ${result.expiresInMin} minutes; your current email remains active until you open it.`);
      setEmailPassword('');
    } catch (e: any) {
      setEmailError(e?.message ?? 'Email change could not be started.');
    } finally {
      setEmailBusy(false);
    }
  };

  const signOutAll = async () => {
    const ok = await confirmDialog({
      title: 'Sign out of every device?',
      body: 'All server-side sessions, including this one, will be revoked. You will need to sign in again.',
      confirmLabel: 'Sign out all devices',
      danger: true,
    });
    if (ok) await s.signOut(true);
  };

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="flex items-center gap-1.5 text-base font-bold"><KeyRound size={16} /> Password</h2>
        <p className="mt-1 text-xs text-slate-400">Passwords are hashed with Argon2id. The current password is required when one exists; a recent Google sign-in is required otherwise.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {user.hasPassword && (
            <Field label="Current password">
              <input className={inputCls} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            </Field>
          )}
          <Field label="New password (12+ characters)">
            <input className={inputCls} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <input className={inputCls} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        {passwordError && <p role="alert" className="mt-2 text-sm text-red-300">{passwordError}</p>}
        {passwordMessage && <p role="status" className="mt-2 text-sm text-emerald-300">{passwordMessage}</p>}
        <Btn variant="primary" className="mt-3" onClick={changePassword} disabled={passwordBusy || newPassword.length < 12 || (user.hasPassword && !currentPassword)}>
          {user.hasPassword ? 'Change password' : 'Set password'}
        </Btn>
      </Card>

      <Card>
        <h2 className="flex items-center gap-1.5 text-base font-bold"><Mail size={16} /> Email address</h2>
        <p className="mt-1 text-xs text-slate-400">
          The current verified email is <b className="text-slate-200">{user.email}</b>. A secure single-use link sent to the new
          address must be opened before the change takes effect; the old address stays active until then.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Field label="New email address">
            <input className={inputCls} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" />
          </Field>
          {user.hasPassword && (
            <Field label="Current password">
              <input className={inputCls} type="password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} autoComplete="current-password" />
            </Field>
          )}
        </div>
        {emailError && <p role="alert" className="mt-2 text-sm text-red-300">{emailError}</p>}
        {emailMessage && <p role="status" className="mt-2 text-sm text-cyan-200">{emailMessage}</p>}
        <Btn className="mt-3" onClick={requestEmail} disabled={emailBusy || !newEmail.trim() || (user.hasPassword && !emailPassword)}>
          {emailRequest ? 'Send another verification link' : 'Send verification link'}
        </Btn>
      </Card>

      <Card>
        <h2 className="flex items-center gap-1.5 text-base font-bold"><ShieldCheck size={16} /> Active sessions</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn onClick={() => { void loadSessions(); }} disabled={sessionsBusy}><RefreshCw size={14} /> Refresh</Btn>
          <Btn variant="danger" onClick={signOutAll}><LogOut size={14} /> Sign out all devices</Btn>
        </div>
        {sessionsError && <p role="alert" className="mt-2 text-sm text-red-300">{sessionsError}</p>}
        <ul className="mt-2 divide-y divide-white/5 text-sm">
          {sessions.map((session) => (
            <li key={session.sessionId} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-slate-200">{session.current ? 'This device' : (session.userAgent || 'Unknown device')}</p>
                <p className="text-[11px] text-slate-500">Last active {new Date(session.lastSeenAt).toLocaleString()} · expires {new Date(session.expiresAt).toLocaleDateString()}</p>
              </div>
              {!session.current && (
                <Btn onClick={async () => { await s.revokeAccountSession(session.sessionId); await loadSessions(); }}>Sign out</Btn>
              )}
            </li>
          ))}
          {sessions.length === 0 && !sessionsBusy && <li className="py-2 text-slate-500">No active sessions were returned.</li>}
        </ul>
      </Card>
    </div>
  );
}
