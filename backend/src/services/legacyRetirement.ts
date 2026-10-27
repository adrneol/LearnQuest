import { env } from '../config/env.js';
import { USER_COLLECTIONS, type DataStore } from '../store.js';
import {
  USER_DATA_MIGRATION_ID,
  inspectUserDataMigration,
  type UserDataMigrationReport,
} from './userDataMigration.js';

/**
 * Explicit, non-automatic retirement of the legacy per-domain learning
 * collections. It is deliberately unreachable from server startup, health
 * checks, or account deletion.
 *
 * Preconditions:
 *   - the application is configured for the unified backend;
 *   - a production cutover has been acknowledged;
 *   - a reviewed migration artifact proves a verified copy;
 *   - the live migration inspection still matches that artifact;
 *   - the operator confirms a backup and types the destructive phrase.
 */
export const LEGACY_RETIREMENT_CONFIRMATION = 'RETIRE LEGACY LQ_DATA';

export interface LegacyRetirementInspection {
  status: 'ready' | 'blocked';
  blockers: string[];
  warnings: string[];
  migration: {
    id: string;
    status: UserDataMigrationReport['status'];
    validSourceKeys: number;
    matchedKeys: number;
    pendingKeys: number;
    conflicts: number;
    checksum: string;
  };
  collections: Array<{ name: string; documents: number }>;
}

function artifactChecks(artifact: unknown, live: UserDataMigrationReport): string[] {
  const blockers: string[] = [];
  if (!artifact || typeof artifact !== 'object') {
    return ['A reviewed migration report artifact is required.'];
  }
  const report = artifact as Record<string, any>;
  const after = report.after && typeof report.after === 'object' ? report.after : report;
  if (report.status !== 'applied' || report.ok !== true) {
    blockers.push('The reviewed migration artifact did not report a verified apply.');
  }
  if (after.migration?.id !== USER_DATA_MIGRATION_ID) {
    blockers.push('The reviewed migration artifact belongs to a different migration.');
  }
  if (after.status !== 'ready' || after.totals?.pendingKeys !== 0) {
    blockers.push('The reviewed migration artifact did not end with zero pending records.');
  }
  if (!after.checksums || after.checksums.source !== after.checksums.matchedDestination) {
    blockers.push('The reviewed migration artifact contains mismatched source/destination checksums.');
  }
  if (live.status !== 'ready' || live.totals.pendingKeys !== 0) {
    blockers.push('The live migration check still has pending or invalid records.');
  }
  if (live.totals.conflicts > 0 || live.totals.duplicateSourceKeys > 0
    || live.totals.duplicateDestinationKeys > 0 || live.totals.invalidSourceDocuments > 0
    || live.totals.invalidDestinationDocuments > 0) {
    blockers.push('The live migration check found conflicts, duplicates, or malformed records.');
  }
  if (after.checksums?.source !== live.checksums.source) {
    blockers.push('The live legacy source checksum no longer matches the reviewed migration report.');
  }
  if (after.totals?.validSourceKeys !== live.totals.validSourceKeys) {
    blockers.push('The live legacy record count no longer matches the reviewed migration report.');
  }
  return blockers;
}

export async function inspectLegacyRetirement(
  store: DataStore,
  migrationArtifact: unknown,
): Promise<LegacyRetirementInspection> {
  const blockers: string[] = [];
  if (env.userDataStore !== 'unified') {
    blockers.push('Set LQ_USER_DATA_STORE=unified and verify the application after cutover before retiring legacy collections.');
  }
  if (!env.userDataCutoverAcknowledged) {
    blockers.push('Set LQ_USER_DATA_CUTOVER_ACK=lq-data-to-user-data-v1 only after the cutover has been verified.');
  }
  if (!store.adapter.dropCollection) {
    blockers.push('The active database adapter cannot perform an explicit collection retirement.');
  }

  let live: UserDataMigrationReport | null = null;
  try {
    live = await inspectUserDataMigration(store);
  } catch (error) {
    blockers.push(`The live migration check failed: ${error instanceof Error ? error.message : 'unknown error'}.`);
  }
  if (live) blockers.push(...artifactChecks(migrationArtifact, live));

  const collections: Array<{ name: string; documents: number }> = [];
  for (const domain of USER_COLLECTIONS) {
    const name = `lq_data_${domain}`;
    try {
      collections.push({ name, documents: await store.adapter.collection(name).count({}) });
    } catch (error) {
      blockers.push(`Could not inspect ${name}: ${error instanceof Error ? error.message : 'unknown error'}.`);
    }
  }

  const warnings: string[] = [];
  if (live && live.totals.destinationOnlyKeys > 0) {
    warnings.push(
      `${live.totals.destinationOnlyKeys} unified record(s) have no legacy source. They are not deleted by retirement, but confirm they are intentional.`,
    );
  }
  if (live && live.totals.destinationDocuments < live.totals.validSourceKeys) {
    warnings.push('The unified collection contains fewer records than the verified legacy source.');
  }

  return {
    status: blockers.length === 0 ? 'ready' : 'blocked',
    blockers,
    warnings,
    migration: {
      id: USER_DATA_MIGRATION_ID,
      status: live?.status ?? 'blocked',
      validSourceKeys: live?.totals.validSourceKeys ?? 0,
      matchedKeys: live?.totals.matchedKeys ?? 0,
      pendingKeys: live?.totals.pendingKeys ?? 0,
      conflicts: live?.totals.conflicts ?? 0,
      checksum: live?.checksums.source ?? '',
    },
    collections,
  };
}

export interface LegacyRetirementResult extends Omit<LegacyRetirementInspection, 'status'> {
  status: 'retired';
  dropped: string[];
}

/**
 * Drop only the legacy learning-data collections. Operational collections,
 * account identity, sessions, tokens, and the consolidated collection are
 * never passed to `dropCollection`.
 */
export async function retireLegacyCollections(
  store: DataStore,
  confirmation: string,
  migrationArtifact: unknown,
  options: { backupConfirmed: boolean },
): Promise<LegacyRetirementResult> {
  if (confirmation !== LEGACY_RETIREMENT_CONFIRMATION) {
    throw Object.assign(
      new Error(`Exact confirmation phrase required: ${LEGACY_RETIREMENT_CONFIRMATION}`),
      { status: 400, code: 'CONFIRMATION_MISMATCH' },
    );
  }
  if (!options.backupConfirmed) {
    throw Object.assign(
      new Error('A verified backup must be confirmed before legacy collections can be retired.'),
      { status: 409, code: 'BACKUP_NOT_CONFIRMED' },
    );
  }
  const inspection = await inspectLegacyRetirement(store, migrationArtifact);
  if (inspection.status !== 'ready') {
    throw Object.assign(
      new Error(`Legacy retirement is blocked: ${inspection.blockers.join(' ')}`),
      { status: 409, code: 'RETIREMENT_BLOCKED', blockers: inspection.blockers },
    );
  }
  const dropCollection = store.adapter.dropCollection;
  if (!dropCollection) {
    throw Object.assign(new Error('Collection retirement is unavailable.'), { status: 503, code: 'RETIREMENT_UNAVAILABLE' });
  }
  const dropped: string[] = [];
  for (const collection of inspection.collections) {
    await dropCollection.call(store.adapter, collection.name);
    dropped.push(collection.name);
  }
  return { ...inspection, status: 'retired', dropped };
}
