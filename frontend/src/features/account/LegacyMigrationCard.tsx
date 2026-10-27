import { useState } from 'react';
import { AlertTriangle, Download, HardDriveDownload, Trash2 } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { confirmDialog } from '../../components/ui/dialog.js';
import { Card, Btn } from '../../components/ui/ui.js';

/**
 * Post-authentication legacy IndexedDB migration. Login screens never read or
 * display these records; the offer appears only after the server session and
 * cloud state have loaded.
 */
export function LegacyMigrationCard() {
  const s = useStore();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<'backup' | 'import' | 'cleanup' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? s.migrationError;

  if (hidden) return null;
  if (!s.migrationAvailable && !s.migrationSummary && !s.migrationError) return null;

  const download = async () => {
    setBusy('backup');
    setLocalError(null);
    try {
      await s.exportLegacyBackup();
    } catch (e: any) {
      setLocalError(e?.message ?? 'The local backup could not be downloaded.');
    } finally {
      setBusy(null);
    }
  };

  const migrate = async () => {
    const ok = await confirmDialog({
      title: 'Import this browser’s local LearnQuest data?',
      body: 'Playlists, stable entry identities, progress, notes, review history, Focus sessions, playback evidence, checkpoints, saved ranges, modules, goals, achievements, and XP will be merged into your signed-in account. Existing cloud records win on identical IDs; missing records are added. A failed import keeps the local source and can be retried safely.',
      confirmLabel: 'Import into my account',
    });
    if (!ok) return;
    setBusy('import');
    setLocalError(null);
    try {
      await s.migrateLocalDataNow();
    } catch (e: any) {
      setLocalError(e?.message ?? 'Import failed. The local source data was retained; retry is safe.');
    } finally {
      setBusy(null);
    }
  };

  const cleanup = async () => {
    const ok = await confirmDialog({
      title: 'Remove the local LearnQuest data from this browser?',
      body: 'The import has already been confirmed by the server. Removing the local copy cannot be undone unless you downloaded a backup. Your cloud learning data is not affected.',
      confirmLabel: 'Remove local copy',
      danger: true,
    });
    if (!ok) return;
    setBusy('cleanup');
    setLocalError(null);
    try {
      await s.removeLocalLegacyData();
    } catch (e: any) {
      setLocalError(e?.message ?? 'The local copy could not be removed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-cyan-500/30">
      <div className="flex flex-wrap items-start gap-3">
        <HardDriveDownload className="mt-0.5 shrink-0 text-cyan-300" size={20} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">Local LearnQuest data found in this browser</h2>
          {s.migrationSummary ? (
            <p role="status" className="mt-1 text-sm text-emerald-200">{s.migrationSummary}</p>
          ) : (
            <p className="mt-1 text-sm text-slate-400">
              This browser has unclaimed legacy data. Importing is an explicit choice: it is merged into <b className="text-slate-200">{s.authUser?.email}</b>,
              with duplicate IDs skipped and existing cloud records preserved. Nothing is uploaded until you confirm, and a different account never inherits it.
            </p>
          )}
          {(error || s.migrationError) && <p role="alert" className="mt-2 text-sm text-red-300">{error ?? s.migrationError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {s.migrationAvailable && (
              <>
                <Btn onClick={download} disabled={busy !== null}><Download size={14} /> {busy === 'backup' ? 'Preparing…' : 'Download local backup first'}</Btn>
                <Btn variant="primary" onClick={migrate} disabled={busy !== null}>{busy === 'import' ? 'Importing and verifying…' : 'Import into my account'}</Btn>
                <Btn onClick={() => setHidden(true)} disabled={busy !== null}>Not now</Btn>
              </>
            )}
            {s.migrationSummary && (
              <>
                <Btn variant="danger" onClick={cleanup} disabled={busy !== null}><Trash2 size={14} /> {busy === 'cleanup' ? 'Removing…' : 'Remove local copy'}</Btn>
                <Btn onClick={() => setHidden(true)} disabled={busy !== null}>Keep local copy</Btn>
              </>
            )}
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-500">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            The local source is retained after every failure. Migration is marked complete only after the server confirms the merged account state.
          </p>
        </div>
      </div>
    </Card>
  );
}
