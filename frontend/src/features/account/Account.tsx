import {
  useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode,
} from 'react';
import { Download, LogOut, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { confirmDialog, Modal } from '../../components/ui/dialog.js';
import { Card, Btn, Field, inputCls } from '../../components/ui/ui.js';
import { downloadZip } from '../../services/exports/zip.js';
import { TimezonePicker } from '../../components/ui/TimezonePicker.js';
import { NumberField } from '../../components/ui/NumberField.js';
import type { AccountSession } from '../../services/api/authApi.js';
import type { AccountSection } from './AccountMenu.js';

const ACCOUNT_SECTIONS: AccountSection[] = ['profile', 'settings', 'security'];

function rateLimitedMessage(action: string, error: any): string | null {
  if (error?.status !== 429) return null;
  const requested = Number(error?.retryAfterSec);
  const seconds = Number.isFinite(requested) && requested > 0 ? Math.ceil(requested) : 60;
  return `${action} The server is rate-limiting requests; try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
}

export function Account({ section, onSection }: { section: AccountSection; onSection: (s: AccountSection) => void }) {
  const s = useStore();
  const user = s.authUser;
  if (!user) {
    return (
      <div className="lq-card lq-workflow-band">
        <h1 id="account-page-title" tabIndex={-1} className="text-lg font-bold text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">This browser has no account</h1>
        <p className="mt-2 max-w-[65ch] text-sm text-[var(--text-muted)]">
          Local mode keeps all learning data in this browser's IndexedDB. Profile,
          password, email verification, sessions and devices only exist for
          LearnQuest cloud accounts (production).
        </p>
        <p className="lq-workflow-section mt-3 max-w-[65ch] text-sm text-[var(--text-muted)]">
          To export, back up, restore, or clear your local data, use Reports.
          Deployed LearnQuest accounts are managed from Settings and from this page once signed in.
        </p>
      </div>
    );
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = ACCOUNT_SECTIONS.indexOf(section);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? ACCOUNT_SECTIONS.length - 1
        : event.key === 'ArrowRight'
          ? (current + 1) % ACCOUNT_SECTIONS.length
          : (current - 1 + ACCOUNT_SECTIONS.length) % ACCOUNT_SECTIONS.length;
    const target = ACCOUNT_SECTIONS[next];
    onSection(target);
    document.getElementById(`account-tab-${target}`)?.focus();
  };

  return (
    <div className="lq-workflow">
      <Card className="lq-workflow-band">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--surface-hover)] text-sm font-bold text-[var(--text)]">
            {(user.displayName || user.username || user.email).slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h1
              id="account-page-title"
              tabIndex={-1}
              className="break-words text-2xl font-bold tracking-tight"
            >
              {user.displayName || user.username}
            </h1>
            <p className="truncate text-xs text-[var(--text-muted)]">{user.email} · @{user.username}</p>
          </div>
        </div>
        <div className="lq-segmented mt-4" role="tablist" aria-label="Account sections" aria-orientation="horizontal" onKeyDown={onTabKeyDown}>
          <SectionBtn id="account-tab-profile" active={section === 'profile'} onClick={() => onSection('profile')}>Profile</SectionBtn>
          <SectionBtn id="account-tab-settings" active={section === 'settings'} onClick={() => onSection('settings')}>Account settings</SectionBtn>
          <SectionBtn id="account-tab-security" active={section === 'security'} onClick={() => onSection('security')}>Security &amp; sessions</SectionBtn>
        </div>
      </Card>

      <div
        role="tabpanel"
        id={`account-panel-${section}`}
        aria-labelledby={`account-tab-${section}`}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring-offset)]"
      >
        {section === 'profile' && <ProfileSection />}
        {section === 'settings' && <SettingsSection />}
        {section === 'security' && <SecuritySection />}
      </div>
    </div>
  );
}

function SectionBtn({ id, active, onClick, children }: { id: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={active ? `account-panel-${id.replace('account-tab-', '')}` : undefined}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
    >
      {children}
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
      <h2 className="lq-section-title">Profile</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Email changes go through verified account security.</p>
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
        <div className="rounded-lg bg-[var(--surface-soft)] p-2.5 text-xs text-[var(--text-muted)]">
          <p>Google identity: <b className="text-[var(--text)]">{user.googleLinked ? 'linked by stable provider subject' : 'not linked'}</b></p>
          <p className="mt-1">Password sign-in: <b className="text-[var(--text)]">{user.hasPassword ? 'enabled' : 'not set'}</b></p>
          <p className="mt-1">Member since {new Date(user.createdAt).toLocaleDateString()}</p>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="mt-2 text-sm text-emerald-800 dark:text-emerald-300">{message}</p>}
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

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

  const exportZip = async () => {
    setError(null);
    try {
      const { zip } = await s.exportAccountBundle();
      downloadZip(`learnquest-account-export-${new Date().toISOString().slice(0, 10)}.zip`, zip);
      setMessage('Account export downloaded.');
    } catch (e: any) {
      setError(e?.message ?? 'Export failed.');
    }
  };

  const exportFullBackup = async () => {
    setError(null);
    try {
      const json = await s.exportBackup();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `learnquest-account-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('Full backup downloaded (restore-compatible Backup JSON v3).');
    } catch (e: any) {
      setError(e?.message ?? 'Export failed.');
    }
  };

  /**
   * Refresh both halves of "account state": the authenticated profile from
   * /auth/session and the learning data from /account/data. The previous
   * control only called listAccountSessions() (discarding the result) and then
   * refreshed the session, so another device's data changes were never loaded
   * and a failure produced no visible message.
   */
  const refreshAccount = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await s.refreshSession();
      await s.reloadCloudData();
      setMessage('Account profile and learning data were reloaded from the server.');
    } catch (e: any) {
      setError(e?.message ?? 'Account state could not be refreshed. Nothing was overwritten.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="lq-section-title">Learning preferences</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TimezonePicker value={timezone} onChange={setTimezone} />
          <div className="space-y-3">
            <NumberField label="Default session length (min)" value={sessionLen} onCommit={setSessionLen} min={1} max={600} allowEmpty={false} />
            <NumberField label="Break length (min)" value={breakMin} onCommit={setBreakMin} min={0} max={240} allowEmpty={false} />
            <NumberField label="Minimum viable session (min)" value={minViable} onCommit={setMinViable} min={1} max={600} allowEmpty={false} />
          </div>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-300">{error}</p>}
        {message && <p role="status" className="mt-2 text-sm text-emerald-800 dark:text-emerald-300">{message}</p>}
        <Btn variant="primary" className="mt-3" onClick={save} disabled={busy}>Save preferences</Btn>
      </Card>

      <Card>
        <h2 className="lq-section-title">Account data</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Two portable formats — pick the one you need.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
            <p className="text-xs font-semibold text-[var(--text)]">Account export (.zip)</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Organized, readable folder of JSON/CSV with a manifest. Good for archiving or inspection.</p>
            <Btn className="mt-2" onClick={() => { void exportZip(); }}><Download size={14} /> Download .zip</Btn>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
            <p className="text-xs font-semibold text-[var(--text)]">Full backup (JSON)</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Restore-compatible Backup JSON (schema v3) — use with Restore backup.</p>
            <Btn className="mt-2" onClick={() => { void exportFullBackup(); }}><Download size={14} /> Download Backup JSON</Btn>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Btn disabled={busy} className="text-xs" onClick={() => { void refreshAccount(); }}><RefreshCw size={14} /> Refresh account state</Btn>
        </div>
      </Card>

      <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-4 sm:p-5">
        <h2 className="lq-section-title">Danger zone</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Delete your account and all associated learning data. This cannot be undone.
        </p>
        <Btn variant="danger" className="mt-3" onClick={() => setDeleteDialogOpen(true)} disabled={busy}>
          <Trash2 size={14} /> Delete my account
        </Btn>
      </div>

      {deleteDialogOpen && (
        <DeleteAccountDialog
          user={user}
          onCancel={() => setDeleteDialogOpen(false)}
          onDelete={async (phrase, password) => {
            await s.deleteAccount(phrase, password);
          }}
          onGoogleReauth={() => { void s.signInWithGoogle('login'); }}
        />
      )}
    </div>
  );
}

/**
 * Deliberate destructive confirmation. Both the current password (verified by
 * the server against the stored Argon2id hash) and the exact typed phrase are
 * required. For a Google-only account, a recent Google session is required
 * instead of inventing a password prompt.
 */
function DeleteAccountDialog({
  user,
  onCancel,
  onDelete,
  onGoogleReauth,
}: {
  user: NonNullable<ReturnType<typeof useStore>['authUser']>;
  onCancel: () => void;
  onDelete: (phrase: string, password?: string) => Promise<void>;
  onGoogleReauth: () => void;
}) {
  const phrase = 'DELETE MY ACCOUNT';
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);

  const phraseMatches = confirmation.trim() === phrase;
  const canDelete = !busy && phraseMatches && (!user.hasPassword || password.length > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);
    if (!phraseMatches) {
      setError(`Type ${phrase} exactly to confirm.`);
      return;
    }
    if (user.hasPassword && !password) {
      setError('Enter your current password.');
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    try {
      await onDelete(confirmation.trim(), user.hasPassword ? password : undefined);
    } catch (err: any) {
      setError(err?.message ?? 'Account deletion did not complete. The account was not reported as deleted; retry safely.');
      setBusy(false);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Modal
      role="alertdialog"
      title="Permanently delete this account?"
      description={(
        <>
          This is permanent and cannot be undone through LearnQuest. All playlists, progress, notes, review history,
          focus sessions, checkpoints, goals, XP, achievements, settings, sessions, and sign-in links owned by
          <b className="text-[var(--text)]"> {user.email}</b> will be removed.
        </>
      )}
      onClose={onCancel}
      busy={busy}
      initialFocusRef={cancelRef}
      closeLabel="Close delete-account dialog"
      testId="delete-account-dialog"
      panelClassName="max-w-lg"
    >
      <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--text-muted)]">
        <li>Export a backup first if you might want a personal copy of your learning data.</li>
        <li>Other LearnQuest accounts are not affected.</li>
        <li>The server verifies recent authentication before deleting anything.</li>
      </ul>

      <form onSubmit={submit} className="mt-4 space-y-3" aria-busy={busy}>
        {user.hasPassword ? (
          <Field label="Current password">
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
            />
          </Field>
        ) : (
          <div className="lq-alert lq-alert--warning">
            <p>This account uses Google sign-in. For your safety, account deletion asks you to confirm with Google again.</p>
            <Btn type="button" className="mt-2" onClick={onGoogleReauth} disabled={busy}>Reauthenticate with Google</Btn>
          </div>
        )}
        <Field label={`Type ${phrase} to confirm`}>
          <input
            className={inputCls}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            aria-invalid={confirmation.length > 0 && !phraseMatches}
            aria-describedby="delete-phrase-help"
          />
        </Field>
        <p id="delete-phrase-help" className={`text-xs ${confirmation.length > 0 && !phraseMatches ? 'text-red-800 dark:text-red-300' : 'text-[var(--text-faint)]'}`}>
          {confirmation.length > 0 && !phraseMatches
            ? `The phrase is not exact. Type ${phrase} exactly (leading/trailing spaces are ignored).`
            : `Exact phrase, including spaces: ${phrase}`}
        </p>
        {error && <p role="alert" className="lq-alert lq-alert--danger">{error}</p>}
        <div className="lq-dialog-actions">
          <Btn ref={cancelRef} type="button" onClick={onCancel} disabled={busy}>Cancel</Btn>
          <Btn type="submit" variant="danger" disabled={!canDelete}>
            <Trash2 size={16} aria-hidden="true" /> {busy ? 'Deleting…' : 'Delete permanently'}
          </Btn>
        </div>
      </form>
    </Modal>
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
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsNotice, setSessionsNotice] = useState<string | null>(null);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsCooldownUntil, setSessionsCooldownUntil] = useState(0);
  const sessionsRef = useRef<AccountSession[]>([]);
  const sessionsLoadedRef = useRef(false);
  const listSessionsRef = useRef(s.listAccountSessions);
  const sessionsInFlightRef = useRef(false);
  const sessionsCooldownRef = useRef(0);

  // Keep the latest store action in a ref. Depending on the whole store object
  // here made the mount effect reload the session list after every unrelated
  // store update (sync status, version, timer state), which could exhaust the
  // global API budget and surface an unrelated rate-limit message.
  useEffect(() => { listSessionsRef.current = s.listAccountSessions; });

  useEffect(() => {
    if (!sessionsCooldownUntil) return;
    const remaining = Math.max(0, sessionsCooldownUntil - Date.now());
    const timer = window.setTimeout(() => {
      sessionsCooldownRef.current = 0;
      setSessionsCooldownUntil(0);
      setSessionsError(null);
      if (!sessionsLoadedRef.current) {
        setSessionsNotice('Active sessions have not been loaded. Select Refresh to retry.');
      } else if (sessionsRef.current.length > 0) {
        setSessionsNotice('Showing the last loaded session list. Select Refresh to check for newer sessions.');
      } else {
        setSessionsNotice('The last loaded session list was empty. Select Refresh to check again.');
      }
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [sessionsCooldownUntil]);

  const loadSessions = useCallback(async () => {
    if (sessionsInFlightRef.current) return;
    if (sessionsCooldownRef.current > Date.now()) {
      const seconds = Math.max(1, Math.ceil((sessionsCooldownRef.current - Date.now()) / 1_000));
      setSessionsError(
        `Active sessions could not be refreshed because the server is rate-limiting requests. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
      );
      return;
    }
    sessionsInFlightRef.current = true;
    setSessionsBusy(true);
    setSessionsError(null);
    try {
      const next = await listSessionsRef.current();
      sessionsRef.current = next;
      sessionsLoadedRef.current = true;
      setSessionsLoaded(true);
      setSessions(next);
      setSessionsNotice(null);
      sessionsCooldownRef.current = 0;
      setSessionsCooldownUntil(0);
    } catch (e: any) {
      setSessionsNotice(null);
      if (e?.status === 429) {
        const requested = Number(e?.retryAfterSec);
        const seconds = Number.isFinite(requested) && requested > 0 ? Math.ceil(requested) : 60;
        const until = Date.now() + seconds * 1_000;
        sessionsCooldownRef.current = until;
        setSessionsCooldownUntil(until);
        const prefix = !sessionsLoadedRef.current
          ? 'Active sessions could not be loaded. '
          : sessionsRef.current.length > 0
            ? 'Showing the last loaded session list. '
            : 'The last loaded session list was empty. ';
        setSessionsError(
          `${prefix}The server is rate-limiting requests; try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
        );
      } else {
        setSessionsError(e?.message ?? 'Active sessions could not be loaded.');
      }
    } finally {
      sessionsInFlightRef.current = false;
      setSessionsBusy(false);
    }
  }, []);

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
      setPasswordError(rateLimitedMessage('Your password could not be changed.', e)
        ?? e?.message
        ?? 'Password could not be changed.');
    } finally {
      setPasswordBusy(false);
    }
  };

  const changeEmailWithGoogle = async () => {
    setEmailError(null);
    setEmailMessage(null);
    setEmailBusy(true);
    try {
      // The server binds this flow to the authenticated account and, when one
      // is linked, to the stable Google subject. No emailed verification link
      // is created. The browser leaves for Google, so this call normally does
      // not return before navigation.
      await s.signInWithGoogle('email_change');
    } catch (e: any) {
      setEmailError(e?.message ?? 'Google verification could not be started.');
      setEmailBusy(false);
    }
  };

  const signOutAll = async () => {
    const ok = await confirmDialog({
      title: 'Sign out of every device?',
      body: 'All active sessions, including this one, will be signed out. You will need to sign in again.',
      confirmLabel: 'Sign out all devices',
      danger: true,
    });
    if (ok) await s.signOut(true);
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await s.revokeAccountSession(sessionId);
      await loadSessions();
    } catch (e: any) {
      setSessionsError(rateLimitedMessage('That session could not be signed out.', e)
        ?? e?.message
        ?? 'That session could not be signed out. Refresh the list and try again.');
    }
  };

  return (
    <div className="lq-workflow">
      <Card className="lq-workflow">
        <section>
        <h2 className="lq-section-title">Password</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">At least 12 characters. Current password required if one is set; otherwise Google re-verification.</p>
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
        {passwordError && <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-300">{passwordError}</p>}
        {passwordMessage && <p role="status" className="mt-2 text-sm text-emerald-800 dark:text-emerald-300">{passwordMessage}</p>}
        <Btn variant="primary" className="mt-3" onClick={changePassword} disabled={passwordBusy || newPassword.length < 12 || (user.hasPassword && !currentPassword)}>
          {user.hasPassword ? 'Change password' : 'Set password'}
        </Btn>
        </section>

        <section className="lq-workflow-section">
        <h2 className="lq-section-title">Email address</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          <b className="text-[var(--text)]">{user.email}</b> is your verified email. LearnQuest changes it only through
          Google verification; every session is signed out afterwards.
        </p>
        {emailError && <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-300">{emailError}</p>}
        {emailMessage && <p role="status" className="mt-2 text-sm text-[var(--text)]">{emailMessage}</p>}
        <Btn className="mt-3" onClick={changeEmailWithGoogle} disabled={emailBusy}>
          <Mail size={14} /> {emailBusy ? 'Opening Google…' : 'Verify a new email with Google'}
        </Btn>
        {!user.googleLinked && (
          <p className="mt-2 text-xs text-[var(--text-faint)]">
            Linking Google for the first time requires a recent sign-in. If this session is older, sign in again first.
          </p>
        )}
        </section>
      </Card>

      <Card>
        <div className="mt-2 flex items-center justify-between gap-2">
          <h2 className="lq-section-title">Active sessions</h2>
          <button
            type="button"
            onClick={() => { void loadSessions(); }}
            disabled={sessionsBusy || sessionsCooldownUntil > Date.now()}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
          >
            {sessionsBusy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {sessionsError && <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-300">{sessionsError}</p>}
        {sessionsNotice && <p role="status" className="mt-2 text-xs text-[var(--text-muted)]">{sessionsNotice}</p>}
        <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
          {sessions.map((session) => (
            <li key={session.sessionId} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[var(--text)]">{session.current ? 'This device' : (session.userAgent || 'Unknown device')}{session.current && <span className="ml-2 align-middle text-[10px] uppercase tracking-wide text-[var(--text-faint)]">current</span>}</p>
                <p className="text-[11px] text-[var(--text-faint)]">Last active {new Date(session.lastSeenAt).toLocaleString()} · expires {new Date(session.expiresAt).toLocaleDateString()}</p>
              </div>
              {!session.current && (
                <button
                  type="button"
                  onClick={() => { void revokeSession(session.sessionId); }}
                  className="text-xs text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)]"
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
          {sessions.length === 0 && sessionsLoaded && !sessionsBusy && !sessionsError && !sessionsNotice && (
            <li className="py-2 text-[var(--text-faint)]">No active sessions.</li>
          )}
        </ul>
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <Btn variant="danger" onClick={signOutAll}><LogOut size={14} /> Sign out all devices</Btn>
          <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">Every session, including this one, will be revoked. You will need to sign in again.</p>
        </div>
      </Card>
    </div>
  );
}
