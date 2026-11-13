import { beforeEach, describe, expect, it } from 'vitest';
import { kvClearAll, kvSet } from '../src/services/persistence/db.js';
import {
  CLOUD_RECOVERY_COLLECTIONS,
  CLOUD_RECOVERY_MAX_AGE_MS,
  mergeCloudRecoveryDraft,
  readCloudRecoveryDraft,
  writeCloudRecoveryDraft,
} from '../src/services/persistence/cloudRecovery.js';

const USER_A = 'recovery-user-a';
const USER_B = 'recovery-user-b';

beforeEach(async () => {
  await kvClearAll();
});

describe('cloud recovery drafts', () => {
  it('keeps a pending cloud edit isolated to the same account and excludes event data', async () => {
    const baseline = { progress: { lesson: { notes: 'before' } }, sessions: [{ id: 'session-1' }] };
    const local = { progress: { lesson: { notes: 'unsaved' } }, sessions: [{ id: 'session-1' }, { id: 'session-2' }] };
    const draft = await writeCloudRecoveryDraft(USER_A, 7, baseline, local, [...CLOUD_RECOVERY_COLLECTIONS, 'sessions']);

    expect(draft?.collections).toEqual({
      progress: { base: { lesson: { notes: 'before' } }, local: { lesson: { notes: 'unsaved' } } },
    });
    await expect(readCloudRecoveryDraft(USER_A)).resolves.toEqual(draft);
    await expect(readCloudRecoveryDraft(USER_B)).resolves.toBeNull();
  });

  it('three-way merges recovery data and requires review for a conflicting remote edit', async () => {
    const draft = await writeCloudRecoveryDraft(
      USER_A,
      2,
      { progress: { lesson: { notes: 'base' } } },
      { progress: { lesson: { notes: 'local recovery' } } },
      CLOUD_RECOVERY_COLLECTIONS,
    );
    expect(draft).not.toBeNull();
    const merged = mergeCloudRecoveryDraft(draft!, { progress: { lesson: { notes: 'remote edit' } }, sessions: [{ id: 'unchanged' }] });

    expect(merged.state.progress).toEqual({ lesson: { notes: 'local recovery' } });
    expect(merged.state.sessions).toEqual([{ id: 'unchanged' }]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]).toMatchObject({ collection: 'progress', key: 'lesson' });
  });

  it('drops corrupt and expired drafts instead of attempting recovery', async () => {
    await kvSet('cloud-recovery-v1:bad-draft', { invalid: true });
    await expect(readCloudRecoveryDraft('bad-draft')).resolves.toBeNull();

    const expiredAt = new Date(Date.now() - CLOUD_RECOVERY_MAX_AGE_MS - 1).toISOString();
    await kvSet(`cloud-recovery-v1:${USER_A}`, {
      version: 1,
      userId: USER_A,
      baseVersion: 0,
      createdAt: expiredAt,
      updatedAt: expiredAt,
      collections: { progress: { base: {}, local: { lesson: { notes: 'stale' } } } },
    });
    await expect(readCloudRecoveryDraft(USER_A)).resolves.toBeNull();

    await kvSet(`cloud-recovery-v1:${USER_A}`, {
      version: 1,
      userId: USER_B,
      baseVersion: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      collections: { progress: { base: {}, local: { lesson: { notes: 'wrong account' } } } },
    });
    await expect(readCloudRecoveryDraft(USER_A)).resolves.toBeNull();
  });
});
