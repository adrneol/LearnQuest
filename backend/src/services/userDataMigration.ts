import { createHash } from 'node:crypto';
import type { CollectionAdapter } from '../db/adapter.js';
import {
  UNIFIED_USER_DATA_COLLECTION,
  USER_COLLECTIONS,
  type DataStore,
  type UserCollectionName,
} from '../store.js';
import { validateRecordValue } from './userData.js';

/**
 * Versioned, non-destructive migration from the legacy per-domain
 * `lq_data_*` collections to the consolidated `lq_user_data` collection.
 *
 * The source collections are only ever read. `inspectUserDataMigration` is a
 * deterministic dry-run. `applyUserDataMigration` refuses to write when the
 * plan contains a duplicate, malformed record, or a destination conflict, and
 * verifies the destination after copying. Every copy is an idempotent insert:
 * rerunning an interrupted apply resumes by skipping records that already
 * match. No source document is updated or deleted by this module.
 */
export const USER_DATA_MIGRATION_ID = 'lq-data-to-user-data-v1';
export const USER_DATA_MIGRATION_VERSION = 1;
export const USER_DATA_MIGRATION_DEFAULT_BATCH_SIZE = 500;
export const USER_DATA_MIGRATION_MAX_BATCH_SIZE = 5_000;

const ISSUE_SAMPLE_LIMIT = 50;
const MAX_KEY_LENGTH = 500;

export interface UserDataMigrationOptions {
  /** Restrict the run to these accounts. Omit to discover every source owner. */
  userIds?: string[];
  /** Restrict to a subset of the canonical legacy domains. */
  domains?: UserCollectionName[];
  /** Bounded database read batch size (1-5000, default 500). */
  batchSize?: number;
}

export interface MigrationIssue {
  /** Record key, or null when the record has no usable key. */
  key: string | null;
  reason: string;
}

export interface MigrationGlobalIssue {
  collection: string;
  key: string | null;
  reason: string;
}

export interface DomainMigrationReport {
  domain: UserCollectionName;
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
  conflictKeys: number;
  sourceChecksum: string;
  matchedDestinationChecksum: string;
  destinationOnlyChecksum: string;
  allDestinationChecksum: string;
  issues: {
    duplicateSourceKeys: string[];
    duplicateDestinationKeys: string[];
    conflicts: MigrationIssue[];
    invalidSource: MigrationIssue[];
    invalidDestination: MigrationIssue[];
    destinationOnlyKeys: string[];
  };
}

export interface UserMigrationReport {
  userId: string;
  status: 'ready' | 'blocked';
  domains: DomainMigrationReport[];
  sourceDocuments: number;
  validSourceKeys: number;
  destinationDocuments: number;
  matchedKeys: number;
  pendingKeys: number;
  destinationOnlyKeys: number;
  blockingIssues: number;
  sourceChecksum: string;
  matchedDestinationChecksum: string;
}

export interface UserDataMigrationReport {
  migration: {
    id: string;
    version: number;
    mode: 'dry-run';
    targetCollection: string;
    batchSize: number;
    domains: UserCollectionName[];
    userIds: string[] | null;
  };
  status: 'ready' | 'blocked';
  users: UserMigrationReport[];
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
  checksums: {
    source: string;
    matchedDestination: string;
  };
  globalIssues: MigrationGlobalIssue[];
  warnings: string[];
}

export interface UserDataMigrationApplyReport {
  status: 'blocked' | 'applied' | 'incomplete';
  ok: boolean;
  before: UserDataMigrationReport;
  after: UserDataMigrationReport | null;
  applied: {
    users: number;
    domains: number;
    copied: number;
    alreadyPresent: number;
  };
  error?: string;
  warnings: string[];
}

interface NormalizedRecord {
  key: string;
  checksum: string;
}

type RecordInspection =
  | { ok: true; record: NormalizedRecord }
  | { ok: false; issue: MigrationIssue };

function migrationError(message: string): Error {
  return Object.assign(new Error(message), { code: 'MIGRATION_INVALID_OPTIONS' });
}

function selectedDomains(options: UserDataMigrationOptions): UserCollectionName[] {
  if (options.domains === undefined) return [...USER_COLLECTIONS];
  const requested = new Set(options.domains);
  if (requested.size === 0) {
    throw migrationError('At least one migration domain is required when domains are supplied.');
  }
  for (const domain of requested) {
    if (!USER_COLLECTIONS.includes(domain)) {
      throw migrationError(`Unknown migration domain "${String(domain)}".`);
    }
  }
  // Canonical order makes reports and checksums deterministic.
  return USER_COLLECTIONS.filter((domain) => requested.has(domain));
}

function selectedBatchSize(options: UserDataMigrationOptions): number {
  const value = options.batchSize ?? USER_DATA_MIGRATION_DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > USER_DATA_MIGRATION_MAX_BATCH_SIZE) {
    throw migrationError(
      `batchSize must be an integer from 1 to ${USER_DATA_MIGRATION_MAX_BATCH_SIZE}.`,
    );
  }
  return value;
}

function selectedUserIds(options: UserDataMigrationOptions): string[] | null {
  if (options.userIds === undefined) return null;
  if (!Array.isArray(options.userIds) || options.userIds.length === 0) {
    throw migrationError('userIds must contain at least one account identifier when supplied.');
  }
  const ids = new Set<string>();
  for (const id of options.userIds) {
    if (typeof id !== 'string' || id.trim() === '' || id.length > 300) {
      throw migrationError('Every userId must be a non-empty string of at most 300 characters.');
    }
    ids.add(id);
  }
  return [...ids].sort();
}

/** Scan a collection in `_id` order so duplicate keys are still observed. */
async function scanCollection(
  collection: CollectionAdapter,
  filter: Record<string, unknown>,
  batchSize: number,
  visit: (doc: Record<string, any>) => void | Promise<void>,
): Promise<void> {
  let lastId: unknown;
  for (;;) {
    const query: Record<string, unknown> = { ...filter };
    if (lastId !== undefined) query._id = { $gt: lastId };
    const docs = await collection.find(query, { sort: { _id: 1 }, limit: batchSize });
    if (docs.length === 0) return;
    for (const doc of docs) await visit(doc);
    const nextId = docs[docs.length - 1]?._id;
    if (nextId === undefined || nextId === lastId) {
      throw migrationError('A source record has no usable _id; migration cannot continue safely.');
    }
    lastId = nextId;
    if (docs.length < batchSize) return;
  }
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const fields = Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedTimestamp(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  return null;
}

function normalizedOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Canonical destination document. Only known fields are copied; legacy `_id`
 * values and unknown operational fields are not part of the learning contract.
 */
function destinationDocument(
  domain: UserCollectionName,
  source: Record<string, any>,
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    userId: source.userId,
    domain,
    key: String(source.key),
    value: source.value ?? null,
    updatedAt: normalizedTimestamp(source.updatedAt),
    order: normalizedOrder(source.order),
  };
  if (typeof source.playlistId === 'string') doc.playlistId = source.playlistId;
  if (typeof source.version === 'number' && Number.isFinite(source.version)) {
    doc.version = source.version;
  }
  return doc;
}

/** Integrity fingerprint for one record; includes preserved timestamps/order. */
function recordChecksum(domain: UserCollectionName, doc: Record<string, any>): string {
  const canonical = destinationDocument(domain, doc);
  return createHash('sha256').update(stableStringify(canonical), 'utf8').digest('hex');
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function checksumOfRecords(records: NormalizedRecord[]): string {
  const sorted = [...records].sort((a, b) => (
    a.key === b.key ? compareText(a.checksum, b.checksum) : compareText(a.key, b.key)
  ));
  const body = sorted.map((record) => `${record.key}\t${record.checksum}\n`).join('');
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function issueSample<T>(items: T[]): T[] {
  return items.slice(0, ISSUE_SAMPLE_LIMIT);
}

function inspectSourceRecord(
  domain: UserCollectionName,
  userId: string,
  doc: Record<string, any>,
): RecordInspection {
  if (doc.userId !== userId) {
    return { ok: false, issue: { key: null, reason: 'Record ownership does not match the requested account.' } };
  }
  if (typeof doc.key !== 'string' || doc.key === '' || doc.key.length > MAX_KEY_LENGTH) {
    return { ok: false, issue: { key: null, reason: `Record key must be a non-empty string of at most ${MAX_KEY_LENGTH} characters.` } };
  }
  if (!Object.prototype.hasOwnProperty.call(doc, 'value') || doc.value === undefined) {
    return { ok: false, issue: { key: doc.key, reason: 'Record has no value field.' } };
  }
  try {
    validateRecordValue(domain, doc.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payload failed validation.';
    return { ok: false, issue: { key: doc.key, reason: message } };
  }
  if (doc.updatedAt !== undefined && doc.updatedAt !== null && normalizedTimestamp(doc.updatedAt) === null) {
    return { ok: false, issue: { key: doc.key, reason: 'updatedAt is not a valid timestamp.' } };
  }
  if (doc.playlistId !== undefined && typeof doc.playlistId !== 'string') {
    return { ok: false, issue: { key: doc.key, reason: 'playlistId must be a string when present.' } };
  }
  if (doc.order !== undefined && !(typeof doc.order === 'number' && Number.isFinite(doc.order))) {
    return { ok: false, issue: { key: doc.key, reason: 'order must be a finite number when present.' } };
  }
  if (doc.version !== undefined && !(typeof doc.version === 'number' && Number.isFinite(doc.version))) {
    return { ok: false, issue: { key: doc.key, reason: 'version must be a finite number when present.' } };
  }
  return { ok: true, record: { key: doc.key, checksum: recordChecksum(domain, doc) } };
}

function inspectDestinationRecord(
  domain: UserCollectionName,
  userId: string,
  doc: Record<string, any>,
): RecordInspection {
  if (doc.userId !== userId || doc.domain !== domain) {
    return { ok: false, issue: { key: null, reason: 'Destination record ownership/domain does not match the query.' } };
  }
  if (typeof doc.key !== 'string' || doc.key === '' || doc.key.length > MAX_KEY_LENGTH) {
    return { ok: false, issue: { key: null, reason: 'Destination record has an invalid key.' } };
  }
  if (!Object.prototype.hasOwnProperty.call(doc, 'value') || doc.value === undefined) {
    return { ok: false, issue: { key: doc.key, reason: 'Destination record has no value field.' } };
  }
  try {
    validateRecordValue(domain, doc.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payload failed validation.';
    return { ok: false, issue: { key: doc.key, reason: `Destination payload is incompatible: ${message}` } };
  }
  if (doc.updatedAt !== undefined && doc.updatedAt !== null && normalizedTimestamp(doc.updatedAt) === null) {
    return { ok: false, issue: { key: doc.key, reason: 'Destination updatedAt is not a valid timestamp.' } };
  }
  if (doc.playlistId !== undefined && typeof doc.playlistId !== 'string') {
    return { ok: false, issue: { key: doc.key, reason: 'Destination playlistId must be a string when present.' } };
  }
  if (doc.order !== undefined && !(typeof doc.order === 'number' && Number.isFinite(doc.order))) {
    return { ok: false, issue: { key: doc.key, reason: 'Destination order must be a finite number when present.' } };
  }
  if (doc.version !== undefined && !(typeof doc.version === 'number' && Number.isFinite(doc.version))) {
    return { ok: false, issue: { key: doc.key, reason: 'Destination version must be a finite number when present.' } };
  }
  return { ok: true, record: { key: doc.key, checksum: recordChecksum(domain, doc) } };
}

async function inspectDomain(
  store: DataStore,
  userId: string,
  domain: UserCollectionName,
  batchSize: number,
): Promise<DomainMigrationReport> {
  const sourceByKey = new Map<string, string>();
  const sourceEntries: NormalizedRecord[] = [];
  const duplicateSource = new Set<string>();
  const invalidSource: MigrationIssue[] = [];
  let sourceDocuments = 0;

  await scanCollection(store.data(domain), { userId }, batchSize, (doc) => {
    sourceDocuments += 1;
    const inspected = inspectSourceRecord(domain, userId, doc);
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
  const destinationEntries: NormalizedRecord[] = [];
  const duplicateDestination = new Set<string>();
  const invalidDestination: MigrationIssue[] = [];
  let destinationDocuments = 0;

  await scanCollection(store.userData, { userId, domain }, batchSize, (doc) => {
    destinationDocuments += 1;
    const inspected = inspectDestinationRecord(domain, userId, doc);
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

  const matchedEntries: NormalizedRecord[] = [];
  const destinationOnlyEntries: NormalizedRecord[] = [];
  const conflicts: MigrationIssue[] = [];
  for (const [key, checksum] of destinationByKey) {
    const sourceChecksum = sourceByKey.get(key);
    if (sourceChecksum === undefined) {
      destinationOnlyEntries.push({ key, checksum });
    } else if (sourceChecksum !== checksum) {
      conflicts.push({
        key,
        reason: 'Destination record differs from the legacy source; it was not overwritten.',
      });
    } else {
      matchedEntries.push({ key, checksum });
    }
  }
  const pendingKeys = [...sourceByKey.keys()].filter((key) => !destinationByKey.has(key));

  return {
    domain,
    sourceDocuments,
    validSourceKeys: sourceByKey.size,
    destinationDocuments,
    matchedKeys: matchedEntries.length,
    pendingKeys: pendingKeys.length,
    destinationOnlyKeys: destinationOnlyEntries.length,
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
      duplicateSourceKeys: issueSample([...duplicateSource].sort()),
      duplicateDestinationKeys: issueSample([...duplicateDestination].sort()),
      conflicts: issueSample(conflicts.sort((a, b) => compareText(String(a.key), String(b.key)))),
      invalidSource: issueSample(invalidSource),
      invalidDestination: issueSample(invalidDestination),
      destinationOnlyKeys: issueSample(destinationOnlyEntries.map((entry) => entry.key).sort()),
    },
  };
}

function blockingIssuesForDomain(domain: DomainMigrationReport): number {
  return domain.duplicateSourceKeys
    + domain.duplicateDestinationKeys
    + domain.invalidSourceDocuments
    + domain.invalidDestinationDocuments
    + domain.conflictKeys;
}

/**
 * Legacy data must belong to a live, active account. This prevents an
 * orphaned record set from being promoted into the consolidated store and,
 * together with the pre/post-insert checks in `copyDomain`, prevents a
 * migration that races an account deletion from resurrecting that account's
 * records after the deletion saga has verified zero residuals.
 */
async function accountMigrationIssue(
  store: DataStore,
  userId: string,
): Promise<MigrationGlobalIssue | null> {
  const account = (await store.accounts.findOne({ userId })) as { status?: string } | null;
  if (!account) {
    return {
      collection: 'lq_accounts',
      key: userId,
      reason: 'Legacy learning data has no owning account. It was not migrated.',
    };
  }
  if (account.status !== 'active') {
    return {
      collection: 'lq_accounts',
      key: userId,
      reason: `The owning account is not active (status "${String(account.status ?? 'unknown')}"). It was not migrated.`,
    };
  }
  const deletionJob = await store.accountDeletions.findOne({ userId });
  if (deletionJob) {
    return {
      collection: 'lq_account_deletions',
      key: userId,
      reason: 'An account-deletion job exists for this owner. Migration is blocked until the job is resolved.',
    };
  }
  return null;
}

async function assertAccountMigratable(store: DataStore, userId: string): Promise<void> {
  const issue = await accountMigrationIssue(store, userId);
  if (issue) throw migrationError(issue.reason);
}

async function discoverUserIds(
  store: DataStore,
  domains: UserCollectionName[],
  batchSize: number,
): Promise<{ userIds: string[]; globalIssues: MigrationGlobalIssue[] }> {
  const userIds = new Set<string>();
  const globalIssues: MigrationGlobalIssue[] = [];
  for (const domain of domains) {
    await scanCollection(store.data(domain), {}, batchSize, (doc) => {
      if (typeof doc.userId !== 'string' || doc.userId.trim() === '') {
        globalIssues.push({
          collection: `lq_data_${domain}`,
          key: typeof doc.key === 'string' ? doc.key : null,
          reason: 'Record has a missing or invalid userId and cannot be migrated safely.',
        });
        return;
      }
      userIds.add(doc.userId);
    });
  }
  return { userIds: [...userIds].sort(), globalIssues: issueSample(globalIssues) };
}

/** Deterministic dry-run. No source or destination document is modified. */
export async function inspectUserDataMigration(
  store: DataStore,
  options: UserDataMigrationOptions = {},
): Promise<UserDataMigrationReport> {
  const domains = selectedDomains(options);
  const batchSize = selectedBatchSize(options);
  const scopedUserIds = selectedUserIds(options);
  const discovery = scopedUserIds === null
    ? await discoverUserIds(store, domains, batchSize)
    : { userIds: scopedUserIds, globalIssues: [] as MigrationGlobalIssue[] };

  const accountIssues: MigrationGlobalIssue[] = [];
  for (const userId of discovery.userIds) {
    const issue = await accountMigrationIssue(store, userId);
    if (issue) accountIssues.push(issue);
  }
  const globalIssues = [...discovery.globalIssues, ...accountIssues];

  const users: UserMigrationReport[] = [];
  for (const userId of discovery.userIds) {
    const domainReports: DomainMigrationReport[] = [];
    for (const domain of domains) {
      domainReports.push(await inspectDomain(store, userId, domain, batchSize));
    }
    const blockingIssues = domainReports.reduce((sum, domain) => sum + blockingIssuesForDomain(domain), 0);
    users.push({
      userId,
      status: blockingIssues === 0 ? 'ready' : 'blocked',
      domains: domainReports,
      sourceDocuments: domainReports.reduce((sum, domain) => sum + domain.sourceDocuments, 0),
      validSourceKeys: domainReports.reduce((sum, domain) => sum + domain.validSourceKeys, 0),
      destinationDocuments: domainReports.reduce((sum, domain) => sum + domain.destinationDocuments, 0),
      matchedKeys: domainReports.reduce((sum, domain) => sum + domain.matchedKeys, 0),
      pendingKeys: domainReports.reduce((sum, domain) => sum + domain.pendingKeys, 0),
      destinationOnlyKeys: domainReports.reduce((sum, domain) => sum + domain.destinationOnlyKeys, 0),
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
    duplicateSourceKeys: users.reduce((sum, user) => sum + user.domains.reduce((n, domain) => n + domain.duplicateSourceKeys, 0), 0),
    duplicateDestinationKeys: users.reduce((sum, user) => sum + user.domains.reduce((n, domain) => n + domain.duplicateDestinationKeys, 0), 0),
    invalidSourceDocuments: users.reduce((sum, user) => sum + user.domains.reduce((n, domain) => n + domain.invalidSourceDocuments, 0), 0),
    invalidDestinationDocuments: users.reduce((sum, user) => sum + user.domains.reduce((n, domain) => n + domain.invalidDestinationDocuments, 0), 0),
    conflicts: users.reduce((sum, user) => sum + user.domains.reduce((n, domain) => n + domain.conflictKeys, 0), 0),
    blockingIssues: users.reduce((sum, user) => sum + user.blockingIssues, 0) + globalIssues.length,
  };

  const warnings: string[] = [];
  if (totals.destinationOnlyKeys > 0) {
    warnings.push(
      `The destination contains ${totals.destinationOnlyKeys} record(s) with no matching legacy source. They were reported but never overwritten or deleted.`,
    );
  }
  if (discovery.globalIssues.length > 0) {
    warnings.push(
      `${discovery.globalIssues.length} legacy record(s) have invalid ownership and block the migration.`,
    );
  }
  if (accountIssues.length > 0) {
    warnings.push(
      `${accountIssues.length} legacy owner(s) are missing, inactive, or have a deletion job; those records are not migrated.`,
    );
  }

  return {
    migration: {
      id: USER_DATA_MIGRATION_ID,
      version: USER_DATA_MIGRATION_VERSION,
      mode: 'dry-run',
      targetCollection: UNIFIED_USER_DATA_COLLECTION,
      batchSize,
      domains,
      userIds: scopedUserIds,
    },
    status: totals.blockingIssues === 0 ? 'ready' : 'blocked',
    users,
    totals,
    checksums: {
      source: checksumOfRecords(
        users.map((user) => ({ key: user.userId, checksum: user.sourceChecksum })),
      ),
      matchedDestination: checksumOfRecords(
        users.map((user) => ({ key: user.userId, checksum: user.matchedDestinationChecksum })),
      ),
    },
    globalIssues,
    warnings,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 11000 || code === 11001;
}

async function copyDomain(
  store: DataStore,
  userId: string,
  domain: UserCollectionName,
  batchSize: number,
  stats: { copied: number; alreadyPresent: number },
): Promise<void> {
  // Fail closed before reading/copying if the owner is already gone or being
  // deleted. The per-record checks below close the remaining race window.
  await assertAccountMigratable(store, userId);
  await scanCollection(store.data(domain), { userId }, batchSize, async (doc) => {
    const inspected = inspectSourceRecord(domain, userId, doc);
    if (!inspected.ok) {
      throw migrationError(
        `Source changed during migration in domain "${domain}" for key "${inspected.issue.key ?? '(unknown)'}": ${inspected.issue.reason}`,
      );
    }
    const existing = await store.userData.findOne({ userId, domain, key: inspected.record.key });
    if (existing) {
      const existingChecksum = recordChecksum(domain, existing);
      if (existingChecksum !== inspected.record.checksum) {
        throw migrationError(
          `Destination conflict in domain "${domain}" for key "${inspected.record.key}". The existing record was not overwritten.`,
        );
      }
      stats.alreadyPresent += 1;
      return;
    }
    await assertAccountMigratable(store, userId);
    try {
      await store.userData.insertOne(destinationDocument(domain, doc));
      stats.copied += 1;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // A concurrent run inserted the same unique key. Accept only an exact
      // checksum match; never overwrite a differing record.
      const raced = await store.userData.findOne({ userId, domain, key: inspected.record.key });
      if (!raced || recordChecksum(domain, raced) !== inspected.record.checksum) {
        throw migrationError(
          `Destination conflict in domain "${domain}" for key "${inspected.record.key}" after a concurrent write.`,
        );
      }
      stats.alreadyPresent += 1;
      return;
    }
    // If deletion started while this record was being written, remove the
    // newly copied record before surfacing the failure. A later deletion-saga
    // retry also sees and removes it, but removing it here makes the race
    // harmless even if the saga already completed its final verification.
    try {
      await assertAccountMigratable(store, userId);
    } catch (error) {
      await store.userData.deleteOne({ userId, domain, key: inspected.record.key });
      stats.copied = Math.max(0, stats.copied - 1);
      throw error;
    }
  });
}

function verifyApplied(report: UserDataMigrationReport): boolean {
  return report.status === 'ready'
    && report.totals.pendingKeys === 0
    && report.totals.matchedKeys === report.totals.validSourceKeys
    && report.checksums.source === report.checksums.matchedDestination;
}

/**
 * Copy eligible legacy records into `lq_user_data`. If the dry-run plan has any
 * conflict, duplicate, malformed source, or malformed destination, nothing is
 * written. Success is returned only after a post-copy verification proves that
 * every valid source key exists in the destination with an identical checksum.
 */
export async function applyUserDataMigration(
  store: DataStore,
  options: UserDataMigrationOptions = {},
): Promise<UserDataMigrationApplyReport> {
  const before = await inspectUserDataMigration(store, options);
  const emptyApplied = { users: 0, domains: 0, copied: 0, alreadyPresent: 0 };
  if (before.status === 'blocked') {
    return {
      status: 'blocked',
      ok: false,
      before,
      after: null,
      applied: emptyApplied,
      warnings: before.warnings,
    };
  }

  const stats = { copied: 0, alreadyPresent: 0 };
  let skippedMatched = 0;
  let appliedUsers = 0;
  let appliedDomains = 0;
  let failure: string | undefined;
  try {
    for (const user of before.users) {
      let userCopied = false;
      for (const domain of user.domains) {
        if (domain.pendingKeys === 0) {
          // A skipped domain still contributes its already-matching records to
          // the idempotency evidence for this run.
          skippedMatched += domain.matchedKeys;
          continue;
        }
        userCopied = true;
        appliedDomains += 1;
        await copyDomain(store, user.userId, domain.domain, before.migration.batchSize, stats);
      }
      if (userCopied) appliedUsers += 1;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Migration stopped during copy.';
  }

  let after: UserDataMigrationReport | null = null;
  try {
    after = await inspectUserDataMigration(store, options);
  } catch {
    // A failed verification is reported as incomplete, never as success.
  }

  const verified = after !== null && verifyApplied(after);
  const sourceStable = after !== null
    && before.totals.sourceDocuments === after.totals.sourceDocuments
    && before.totals.validSourceKeys === after.totals.validSourceKeys
    && before.checksums.source === after.checksums.source;
  const stableVerified = verified && sourceStable;
  const alreadyPresent = stats.alreadyPresent + skippedMatched;
  const verificationFailure = stableVerified
    ? undefined
    : after === null
      ? 'Post-copy verification could not read the destination.'
      : !sourceStable
        ? 'The legacy source changed during the copy, so the verification snapshot is not stable.'
        : 'Post-copy verification did not confirm that every source record is present and identical.';
  const failureMessage = failure ?? verificationFailure;
  const warnings = [...before.warnings];
  if (after && after.totals.destinationOnlyKeys > 0) {
    warnings.push(
      `Verification found ${after.totals.destinationOnlyKeys} destination record(s) with no legacy source; they were left untouched.`,
    );
  }
  if (stats.copied === 0 && alreadyPresent > 0) {
    warnings.push('No copy was needed; every eligible source record was already present and identical.');
  }
  if (failure) warnings.push(`Copy stopped: ${failure}`);
  if (verificationFailure && !failure) warnings.push(verificationFailure);

  return {
    status: stableVerified ? 'applied' : 'incomplete',
    ok: stableVerified,
    before,
    after,
    applied: {
      users: appliedUsers,
      domains: appliedDomains,
      copied: stats.copied,
      alreadyPresent,
    },
    ...(failureMessage ? { error: 'Migration did not finish; inspect the report and rerun after resolving the listed issues.' } : {}),
    warnings,
  };
}
