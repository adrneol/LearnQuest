import {
  type DataStore,
  type UserCollectionName,
} from '../store.js';
import {
  MIGRATION_REVERSE_DIRECTION,
  readMigrationJournal,
  writeMigrationJournal,
} from './migrationControl.js';
import {
  USER_DATA_MIGRATION_ID,
  USER_DATA_MIGRATION_VERSION,
  accountMigrationIssue,
  checksumOfRecords,
  destinationDocument,
  inspectDestinationRecord,
  inspectSourceRecord,
  recordChecksum,
  scanCollection,
  selectedBatchSize,
  selectedDomains,
  selectedUserIds,
  type DomainMigrationReport,
  type MigrationGlobalIssue,
  type MigrationIssue,
  type UserDataMigrationOptions,
  type UserMigrationReport,
} from './userDataMigration.js';

/**
 * Controlled reverse migration. Unified is the authoritative source while the
 * fence is active; the legacy per-domain collections become the destination.
 *
 * A rollback must include Unified-era writes, so differing legacy records are
 * overwritten from Unified after a verified backup. Legacy-only records are
 * reported explicitly and are only removed when the operator opts into
 * reconciliation; otherwise the run is blocked. Every domain is verified after
 * copy and journaled for resumability.
 */
export interface ReverseMigrationOptions extends UserDataMigrationOptions {
  /**
   * Remove legacy records that no longer exist in Unified. This is required
   * when records were intentionally deleted after cutover; it is never implicit.
   */
  allowStaleDestinationRemoval?: boolean;
}

export interface ReverseDomainReport extends DomainMigrationReport {
  staleDestinationKeys: number;
}

export interface ReverseUserMigrationReport extends UserMigrationReport {
  domains: ReverseDomainReport[];
  staleDestinationKeys: number;
}

export interface ReverseUserDataMigrationReport {
  migration: {
    id: string;
    version: number;
    mode: 'reverse-dry-run';
    direction: 'reverse';
    sourceCollection: string;
    targetCollections: string[];
    batchSize: number;
    domains: UserCollectionName[];
    userIds: string[] | null;
    allowStaleDestinationRemoval: boolean;
  };
  status: 'ready' | 'blocked';
  users: ReverseUserMigrationReport[];
  totals: {
    users: number;
    domains: number;
    sourceDocuments: number;
    validSourceKeys: number;
    destinationDocuments: number;
    matchedKeys: number;
    pendingKeys: number;
    destinationOnlyKeys: number;
    duplicateSourceKeys: number;
    duplicateDestinationKeys: number;
    invalidSourceDocuments: number;
    invalidDestinationDocuments: number;
    conflicts: number;
    blockingIssues: number;
  };
  checksums: { source: string; matchedDestination: string };
  globalIssues: MigrationGlobalIssue[];
  warnings: string[];
}

export interface ReverseUserDataMigrationApplyReport {
  status: 'blocked' | 'applied' | 'incomplete';
  ok: boolean;
  before: ReverseUserDataMigrationReport;
  after: ReverseUserDataMigrationReport | null;
  applied: {
    users: number;
    domains: number;
    copied: number;
    updated: number;
    alreadyPresent: number;
    staleRemoved: number;
    resumedDomains: number;
  };
  error?: string;
  warnings: string[];
}

function blockingIssuesForDomain(domain: ReverseDomainReport, allowStaleDestinationRemoval: boolean): number {
  return domain.duplicateSourceKeys
    + domain.duplicateDestinationKeys
    + domain.invalidSourceDocuments
    + domain.invalidDestinationDocuments
    + (allowStaleDestinationRemoval ? 0 : domain.destinationOnlyKeys);
}

async function discoverReverseUserIds(
  store: DataStore,
  domains: UserCollectionName[],
  batchSize: number,
): Promise<{ userIds: string[]; globalIssues: MigrationGlobalIssue[] }> {
  const userIds = new Set<string>();
  const globalIssues: MigrationGlobalIssue[] = [];
  for (const domain of domains) {
    await scanCollection(store.userData, { domain }, batchSize, (doc) => {
      if (typeof doc.userId !== 'string' || doc.userId.trim() === '') {
        globalIssues.push({
          collection: 'lq_user_data',
          key: typeof doc.key === 'string' ? doc.key : null,
          reason: `Unified record in domain "${domain}" has a missing or invalid userId.`,
        });
        return;
      }
      userIds.add(doc.userId);
    });
    await scanCollection(store.data(domain), {}, batchSize, (doc) => {
      if (typeof doc.userId !== 'string' || doc.userId.trim() === '') {
        globalIssues.push({
          collection: `lq_data_${domain}`,
          key: typeof doc.key === 'string' ? doc.key : null,
          reason: 'Legacy record has a missing or invalid userId and cannot be reconciled safely.',
        });
        return;
      }
      userIds.add(doc.userId);
    });
  }
  return { userIds: [...userIds].sort(), globalIssues };
}

async function inspectReverseDomain(
  store: DataStore,
  userId: string,
  domain: UserCollectionName,
  batchSize: number,
): Promise<ReverseDomainReport> {
  const sourceByKey = new Map<string, string>();
  const sourceEntries: Array<{ key: string; checksum: string }> = [];
  const duplicateSource = new Set<string>();
  const invalidSource: MigrationIssue[] = [];
  let sourceDocuments = 0;
  await scanCollection(store.userData, { userId, domain }, batchSize, (doc) => {
    sourceDocuments += 1;
    const inspected = inspectDestinationRecord(domain, userId, doc);
    if (!inspected.ok) {
      invalidSource.push(inspected.issue);
      return;
    }
    if (sourceByKey.has(inspected.record.key)) {
      duplicateSource.add(inspected.record.key);
      return;
    }
    sourceByKey.set(inspected.record.key, inspected.record.checksum);
    sourceEntries.push(inspected.record);
  });

  const destinationByKey = new Map<string, string>();
  const destinationEntries: Array<{ key: string; checksum: string }> = [];
  const duplicateDestination = new Set<string>();
  const invalidDestination: MigrationIssue[] = [];
  let destinationDocuments = 0;
  await scanCollection(store.data(domain), { userId }, batchSize, (doc) => {
    destinationDocuments += 1;
    const inspected = inspectSourceRecord(domain, userId, doc);
    if (!inspected.ok) {
      invalidDestination.push(inspected.issue);
      return;
    }
    if (destinationByKey.has(inspected.record.key)) {
      duplicateDestination.add(inspected.record.key);
      return;
    }
    destinationByKey.set(inspected.record.key, inspected.record.checksum);
    destinationEntries.push(inspected.record);
  });

  const matchedEntries: Array<{ key: string; checksum: string }> = [];
  const destinationOnlyEntries: Array<{ key: string; checksum: string }> = [];
  const conflicts: MigrationIssue[] = [];
  for (const [key, checksum] of destinationByKey) {
    const sourceChecksum = sourceByKey.get(key);
    if (sourceChecksum === undefined) {
      destinationOnlyEntries.push({ key, checksum });
    } else if (sourceChecksum !== checksum) {
      conflicts.push({
        key,
        reason: 'Legacy record differs from Unified; reverse apply will replace it with the authoritative Unified value.',
      });
    } else {
      matchedEntries.push({ key, checksum });
    }
  }
  const pendingKeys = [...sourceByKey.keys()].filter((key) => !destinationByKey.has(key));
  const staleDestinationKeys = destinationOnlyEntries.length;
  const report: ReverseDomainReport = {
    domain,
    sourceDocuments,
    validSourceKeys: sourceByKey.size,
    destinationDocuments,
    matchedKeys: matchedEntries.length,
    pendingKeys: pendingKeys.length,
    destinationOnlyKeys: staleDestinationKeys,
    duplicateSourceKeys: duplicateSource.size,
    duplicateDestinationKeys: duplicateDestination.size,
    invalidSourceDocuments: invalidSource.length,
    invalidDestinationDocuments: invalidDestination.length,
    conflictKeys: conflicts.length,
    sourceChecksum: checksumOfRecords(sourceEntries),
    matchedDestinationChecksum: checksumOfRecords(matchedEntries),
    destinationOnlyChecksum: checksumOfRecords(destinationOnlyEntries),
    allDestinationChecksum: checksumOfRecords(destinationEntries),
    issues: {
      duplicateSourceKeys: [...duplicateSource].sort().slice(0, 50),
      duplicateDestinationKeys: [...duplicateDestination].sort().slice(0, 50),
      conflicts: conflicts.slice(0, 50),
      invalidSource: invalidSource.slice(0, 50),
      invalidDestination: invalidDestination.slice(0, 50),
      destinationOnlyKeys: destinationOnlyEntries.map((entry) => entry.key).sort().slice(0, 50),
    },
    staleDestinationKeys,
  };
  return report;
}

export async function inspectReverseUserDataMigration(
  store: DataStore,
  options: ReverseMigrationOptions = {},
): Promise<ReverseUserDataMigrationReport> {
  const domains = selectedDomains(options);
  const batchSize = selectedBatchSize(options);
  const scopedUserIds = selectedUserIds(options);
  const allow = options.allowStaleDestinationRemoval === true;
  const discovery = scopedUserIds === null
    ? await discoverReverseUserIds(store, domains, batchSize)
    : { userIds: scopedUserIds, globalIssues: [] as MigrationGlobalIssue[] };

  const accountIssues: MigrationGlobalIssue[] = [];
  for (const userId of discovery.userIds) {
    const issue = await accountMigrationIssue(store, userId);
    if (issue) accountIssues.push(issue);
  }
  const globalIssues = [...discovery.globalIssues, ...accountIssues];

  const users: ReverseUserMigrationReport[] = [];
  for (const userId of discovery.userIds) {
    const domainReports: ReverseDomainReport[] = [];
    for (const domain of domains) {
      domainReports.push(await inspectReverseDomain(store, userId, domain, batchSize));
    }
    const blockingIssues = domainReports.reduce(
      (sum, domain) => sum + blockingIssuesForDomain(domain, allow),
      0,
    );
    const staleDestinationKeys = domainReports.reduce((sum, domain) => sum + domain.destinationOnlyKeys, 0);
    users.push({
      userId,
      status: blockingIssues === 0 ? 'ready' : 'blocked',
      domains: domainReports,
      sourceDocuments: domainReports.reduce((sum, domain) => sum + domain.sourceDocuments, 0),
      validSourceKeys: domainReports.reduce((sum, domain) => sum + domain.validSourceKeys, 0),
      destinationDocuments: domainReports.reduce((sum, domain) => sum + domain.destinationDocuments, 0),
      matchedKeys: domainReports.reduce((sum, domain) => sum + domain.matchedKeys, 0),
      pendingKeys: domainReports.reduce((sum, domain) => sum + domain.pendingKeys, 0),
      destinationOnlyKeys: staleDestinationKeys,
      staleDestinationKeys,
      blockingIssues,
      sourceChecksum: checksumOfRecords(
        domainReports.map((domain) => ({ key: domain.domain, checksum: domain.sourceChecksum })),
      ),
      matchedDestinationChecksum: checksumOfRecords(
        domainReports.map((domain) => ({ key: domain.domain, checksum: domain.matchedDestinationChecksum })),
      ),
    });
  }

  const totals = {
    users: users.length,
    domains: users.reduce((sum, user) => sum + user.domains.length, 0),
    sourceDocuments: users.reduce((sum, user) => sum + user.sourceDocuments, 0),
    validSourceKeys: users.reduce((sum, user) => sum + user.validSourceKeys, 0),
    destinationDocuments: users.reduce((sum, user) => sum + user.destinationDocuments, 0),
    matchedKeys: users.reduce((sum, user) => sum + user.matchedKeys, 0),
    pendingKeys: users.reduce((sum, user) => sum + user.pendingKeys, 0),
    destinationOnlyKeys: users.reduce((sum, user) => sum + user.destinationOnlyKeys, 0),
    duplicateSourceKeys: users.reduce((sum, user) => sum + user.domains.reduce((n, d) => n + d.duplicateSourceKeys, 0), 0),
    duplicateDestinationKeys: users.reduce((sum, user) => sum + user.domains.reduce((n, d) => n + d.duplicateDestinationKeys, 0), 0),
    invalidSourceDocuments: users.reduce((sum, user) => sum + user.domains.reduce((n, d) => n + d.invalidSourceDocuments, 0), 0),
    invalidDestinationDocuments: users.reduce((sum, user) => sum + user.domains.reduce((n, d) => n + d.invalidDestinationDocuments, 0), 0),
    conflicts: users.reduce((sum, user) => sum + user.domains.reduce((n, d) => n + d.conflictKeys, 0), 0),
    blockingIssues: users.reduce((sum, user) => sum + user.blockingIssues, 0) + globalIssues.length,
  };

  const warnings: string[] = [];
  if (totals.destinationOnlyKeys > 0) {
    warnings.push(
      `${totals.destinationOnlyKeys} legacy record(s) no longer exist in Unified. They are preserved unless --allow-stale-destination is explicitly supplied.`,
    );
  }
  if (totals.conflicts > 0) {
    warnings.push(
      `${totals.conflicts} legacy record(s) differ from Unified. Reverse apply replaces them with the authoritative Unified value after a verified backup.`,
    );
  }
  if (globalIssues.length > 0) {
    warnings.push(`${globalIssues.length} ownership/account issue(s) block the reverse migration.`);
  }

  return {
    migration: {
      id: USER_DATA_MIGRATION_ID,
      version: USER_DATA_MIGRATION_VERSION,
      mode: 'reverse-dry-run',
      direction: MIGRATION_REVERSE_DIRECTION,
      sourceCollection: 'lq_user_data',
      targetCollections: domains.map((domain) => `lq_data_${domain}`),
      batchSize,
      domains,
      userIds: scopedUserIds,
      allowStaleDestinationRemoval: allow,
    },
    status: totals.blockingIssues === 0 ? 'ready' : 'blocked',
    users,
    totals,
    checksums: {
      source: checksumOfRecords(users.map((user) => ({ key: user.userId, checksum: user.sourceChecksum }))),
      matchedDestination: checksumOfRecords(users.map((user) => ({ key: user.userId, checksum: user.matchedDestinationChecksum }))),
    },
    globalIssues,
    warnings,
  };
}

function journalFields(
  migrationId: string,
  userId: string,
  domain: ReverseDomainReport,
) {
  return {
    migrationId,
    direction: MIGRATION_REVERSE_DIRECTION,
    userId,
    domain: domain.domain,
    sourceDocuments: domain.sourceDocuments,
    sourceChecksum: domain.sourceChecksum,
    matchedKeys: domain.matchedKeys,
    pendingKeys: domain.pendingKeys,
    destinationOnlyKeys: domain.destinationOnlyKeys,
  };
}

async function copyReverseDomain(
  store: DataStore,
  userId: string,
  domain: UserCollectionName,
  batchSize: number,
  allowStaleDestinationRemoval: boolean,
  stats: { copied: number; updated: number; alreadyPresent: number; staleRemoved: number },
): Promise<void> {
  const issue = await accountMigrationIssue(store, userId);
  if (issue) throw Object.assign(new Error(issue.reason), { code: 'MIGRATION_ACCOUNT_BLOCKED' });
  const destination = store.data(domain);
  const sourceKeys = new Set<string>();
  await scanCollection(store.userData, { userId, domain }, batchSize, async (doc) => {
    const source = inspectDestinationRecord(domain, userId, doc);
    if (!source.ok) throw new Error(source.issue.reason);
    sourceKeys.add(source.record.key);
    const existing = await destination.findOne({ userId, key: source.record.key });
    if (existing) {
      const existingChecksum = recordChecksum(domain, existing);
      if (existingChecksum === source.record.checksum) {
        stats.alreadyPresent += 1;
        return;
      }
      const payload = destinationDocument(domain, doc);
      delete payload.domain;
      await destination.updateOne(
        { userId, key: source.record.key },
        { $set: payload },
      );
      stats.updated += 1;
      return;
    }
    const payload = destinationDocument(domain, doc);
    delete payload.domain;
    try {
      await destination.insertOne(payload);
      stats.copied += 1;
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== 11000) throw error;
      const raced = await destination.findOne({ userId, key: source.record.key });
      if (!raced || recordChecksum(domain, raced) !== source.record.checksum) {
        throw new Error(`Legacy destination conflict for key "${source.record.key}".`, { cause: error });
      }
      stats.alreadyPresent += 1;
    }
  });

  if (allowStaleDestinationRemoval) {
    const stale = await destination.find({ userId });
    for (const doc of stale) {
      if (typeof doc.key !== 'string') continue;
      if (!sourceKeys.has(doc.key)) {
        stats.staleRemoved += await destination.deleteOne({ userId, key: doc.key });
      }
    }
  }
}

function reverseVerified(report: ReverseUserDataMigrationReport): boolean {
  return report.status === 'ready'
    && report.totals.pendingKeys === 0
    && report.totals.conflicts === 0
    // A successful reverse copy must leave no stale legacy record, whether or
    // not the operator opted into removing them. Opt-in only changes whether
    // the dry-run is blocked, never whether final parity includes 0 stale.
    && report.totals.destinationOnlyKeys === 0
    && report.totals.matchedKeys === report.totals.validSourceKeys
    && report.checksums.source === report.checksums.matchedDestination;
}

/**
 * Copy Unified records back into Legacy. The caller must hold the durable
 * migration fence. The dry-run plan must be ready; no destination-only record
 * is removed unless `allowStaleDestinationRemoval` was explicitly set.
 */
export async function applyReverseUserDataMigration(
  store: DataStore,
  options: ReverseMigrationOptions = {},
): Promise<ReverseUserDataMigrationApplyReport> {
  const before = await inspectReverseUserDataMigration(store, options);
  const emptyApplied = {
    users: 0, domains: 0, copied: 0, updated: 0, alreadyPresent: 0,
    staleRemoved: 0, resumedDomains: 0,
  };
  if (before.status === 'blocked') {
    return {
      status: 'blocked', ok: false, before, after: null, applied: emptyApplied,
      warnings: before.warnings,
    };
  }
  const previousJournal = await readMigrationJournal(store, before.migration.id, MIGRATION_REVERSE_DIRECTION);
  const journalByKey = new Map(previousJournal.map((entry) => [`${entry.userId}\u0000${entry.domain}`, entry]));

  for (const user of before.users) {
    for (const domain of user.domains) {
      const prior = journalByKey.get(`${user.userId}\u0000${domain.domain}`);
      if (prior?.status === 'verified'
        && prior.sourceChecksum === domain.sourceChecksum
        && domain.pendingKeys === 0
        && domain.conflictKeys === 0
        && domain.destinationOnlyKeys === 0) {
        continue;
      }
      await writeMigrationJournal(store, {
        ...journalFields(before.migration.id, user.userId, domain),
        status: domain.pendingKeys === 0 && domain.conflictKeys === 0 && domain.destinationOnlyKeys === 0
          ? 'verified'
          : 'pending',
        copied: 0,
        verifiedAt: domain.pendingKeys === 0 && domain.conflictKeys === 0 && domain.destinationOnlyKeys === 0
          ? new Date().toISOString()
          : null,
      });
    }
  }

  const stats = { copied: 0, updated: 0, alreadyPresent: 0, staleRemoved: 0 };
  let appliedUsers = 0;
  let appliedDomains = 0;
  let resumedDomains = 0;
  let failure: string | undefined;
  try {
    for (const user of before.users) {
      let userCopied = false;
      for (const domain of user.domains) {
        const prior = journalByKey.get(`${user.userId}\u0000${domain.domain}`);
        if (prior?.status === 'verified'
          && prior.sourceChecksum === domain.sourceChecksum
          && domain.pendingKeys === 0
          && domain.conflictKeys === 0
          && domain.destinationOnlyKeys === 0) {
          resumedDomains += 1;
          continue;
        }
        if (domain.pendingKeys === 0 && domain.conflictKeys === 0 && domain.destinationOnlyKeys === 0) {
          await writeMigrationJournal(store, {
            ...journalFields(before.migration.id, user.userId, domain),
            status: 'verified',
            copied: 0,
            verifiedAt: new Date().toISOString(),
          });
          continue;
        }
        userCopied = true;
        appliedDomains += 1;
        const copiedBefore = stats.copied + stats.updated;
        await writeMigrationJournal(store, {
          ...journalFields(before.migration.id, user.userId, domain),
          status: 'copying',
          copied: 0,
          verifiedAt: null,
        });
        try {
          await copyReverseDomain(
            store,
            user.userId,
            domain.domain,
            before.migration.batchSize,
            options.allowStaleDestinationRemoval === true,
            stats,
          );
          const verified = await inspectReverseDomain(
            store,
            user.userId,
            domain.domain,
            before.migration.batchSize,
          );
          if (verified.pendingKeys !== 0
            || verified.conflictKeys !== 0
            || verified.destinationOnlyKeys !== 0
            || verified.matchedKeys !== verified.validSourceKeys
            || verified.sourceChecksum !== domain.sourceChecksum) {
            throw new Error(
              `The Unified source changed during the reverse copy or a legacy record differs for domain "${domain.domain}". No parity success is claimed.`,
            );
          }
          await writeMigrationJournal(store, {
            ...journalFields(before.migration.id, user.userId, verified),
            status: 'verified',
            copied: stats.copied + stats.updated - copiedBefore,
            verifiedAt: new Date().toISOString(),
          });
        } catch (error) {
          await writeMigrationJournal(store, {
            ...journalFields(before.migration.id, user.userId, domain),
            status: 'failed',
            copied: Math.max(0, stats.copied + stats.updated - copiedBefore),
            verifiedAt: null,
            error: error instanceof Error ? error.message.slice(0, 500) : 'Reverse domain copy failed.',
          });
          throw error;
        }
      }
      if (userCopied) appliedUsers += 1;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Reverse migration stopped during copy.';
  }

  let after: ReverseUserDataMigrationReport | null = null;
  try {
    after = await inspectReverseUserDataMigration(store, options);
  } catch {
    // A failed post-copy read is never reported as success.
  }
  const sourceStable = after !== null
    && before.totals.sourceDocuments === after.totals.sourceDocuments
    && before.totals.validSourceKeys === after.totals.validSourceKeys
    && before.checksums.source === after.checksums.source;
  const stableVerified = after !== null
    && sourceStable
    && reverseVerified(after);
  const failureMessage = failure
    ?? (!after
      ? 'Post-reverse verification could not read the legacy destination.'
      : !sourceStable
        ? 'The Unified source changed during the reverse copy, so verification is not stable.'
        : !stableVerified
          ? 'Post-reverse verification did not prove complete legacy parity.'
          : undefined);
  const warnings = [...before.warnings];
  if (failure) warnings.push(`Reverse copy stopped: ${failure}`);
  if (resumedDomains > 0) {
    warnings.push(`${resumedDomains} reverse account/domain unit(s) were resumed from a verified journal entry.`);
  }
  if (stats.staleRemoved > 0) {
    warnings.push(`${stats.staleRemoved} legacy-only record(s) were explicitly removed to match Unified.`);
  }
  return {
    status: stableVerified ? 'applied' : 'incomplete',
    ok: stableVerified,
    before,
    after,
    applied: {
      users: appliedUsers,
      domains: appliedDomains,
      copied: stats.copied,
      updated: stats.updated,
      alreadyPresent: stats.alreadyPresent,
      staleRemoved: stats.staleRemoved,
      resumedDomains,
    },
    ...(failureMessage ? { error: failureMessage } : {}),
    warnings,
  };
}
