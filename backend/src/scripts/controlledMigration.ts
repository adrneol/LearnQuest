import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { closeMongo, getMongoAdapter, mongoTargetDescription } from '../db/mongo.js';
import { env } from '../config/env.js';
import { createDataStore, USER_COLLECTIONS, type UserCollectionName } from '../store.js';
import {
  MIGRATION_FORWARD_DIRECTION,
  MIGRATION_REVERSE_DIRECTION,
  acquireMigrationFence,
  drainAccountWriters,
  getMigrationStatus,
  readMigrationFence,
  releaseMigrationFence,
  runStorageSmokeTest,
  type MigrationDirection,
  type MigrationFenceRecord,
} from '../services/migrationControl.js';
import {
  USER_DATA_MIGRATION_DEFAULT_BATCH_SIZE,
  USER_DATA_MIGRATION_ID,
  USER_DATA_MIGRATION_MAX_BATCH_SIZE,
  USER_DATA_MIGRATION_VERSION,
  applyUserDataMigration,
  inspectUserDataMigration,
  type UserDataMigrationApplyReport,
  type UserDataMigrationOptions,
  type UserDataMigrationReport,
} from '../services/userDataMigration.js';
import {
  applyReverseUserDataMigration,
  inspectReverseUserDataMigration,
  type ReverseMigrationOptions,
  type ReverseUserDataMigrationApplyReport,
  type ReverseUserDataMigrationReport,
} from '../services/userDataReverseMigration.js';

/**
 * Controlled Legacy <-> Unified migration operator entry point.
 *
 * The only automatic safety the application provides is the durable fence: an
 * active fence blocks every identified learning-data mutation route in every
 * process that runs this version. This tool never changes LQ_USER_DATA_STORE,
 * never drops legacy collections, and never decides a cutover. It records the
 * evidence an owner needs to decide.
 */
type Command = 'status' | 'forward' | 'reverse' | 'release' | 'smoke';

interface CliOptions {
  command: Command;
  apply: boolean;
  confirm: string | null;
  direction: MigrationDirection | null;
  reason: 'cutover' | 'rollback' | 'aborted' | null;
  allowStaleDestination: boolean;
  userIds?: string[];
  domains?: UserCollectionName[];
  batchSize: number;
  out: string | null;
  json: boolean;
  verbose: boolean;
}

const HELP = `LearnQuest controlled storage migration (${USER_DATA_MIGRATION_ID} v${USER_DATA_MIGRATION_VERSION})

This tool never switches LQ_USER_DATA_STORE and never drops legacy data.
Dry run is the default. An apply command acquires a durable cross-process fence,
drains admitted account writes, copies, verifies, and leaves the fence active.
Release is a separate, explicit step after the deployment mode is confirmed.

Usage:
  npm run migrate:controlled -- <command> [options]

Commands:
  status                       Show the active fence and journal progress.
  forward [--apply]            Inspect (default) or copy Legacy -> Unified.
  reverse [--apply]            Inspect (default) or copy Unified -> Legacy.
  release --reason <reason>    Smoke-test the selected mode, then release the fence.
  smoke                        Run a read/write smoke test on LQ_USER_DATA_STORE.

Options:
  --apply                      Write records for forward/reverse.
  --confirm <id>               Required with --apply: ${USER_DATA_MIGRATION_ID}
  --reason <reason>            cutover | rollback | aborted (release only)
  --allow-stale-destination    Reverse: explicitly remove legacy records that
                               no longer exist in Unified. Never implicit.
  --user <id[,id]>             Scope to account id(s).
  --domain <name[,name]>       Scope to logical domain(s).
  --batch-size <n>             1..${USER_DATA_MIGRATION_MAX_BATCH_SIZE} (default ${USER_DATA_MIGRATION_DEFAULT_BATCH_SIZE})
  --out <path>                 Write the JSON evidence report.
  --json                       Print JSON instead of the human summary.
  --verbose                    Include per-account/domain evidence.
  --help, -h                   Show this help.
`;

function fail(message: string): never {
  throw new Error(message);
}

function nextValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} requires a value.`);
  return value;
}

function parseList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function parseArgs(args: string[]): CliOptions {
  const command = args[0] as Command | undefined;
  if (!command || !['status', 'forward', 'reverse', 'release', 'smoke'].includes(command)) {
    fail('Choose one command: status, forward, reverse, release, smoke. Use --help for usage.');
  }
  const options: CliOptions = {
    command,
    apply: false,
    confirm: null,
    direction: command === 'forward'
      ? MIGRATION_FORWARD_DIRECTION
      : command === 'reverse'
        ? MIGRATION_REVERSE_DIRECTION
        : null,
    reason: null,
    allowStaleDestination: false,
    batchSize: USER_DATA_MIGRATION_DEFAULT_BATCH_SIZE,
    out: null,
    json: false,
    verbose: false,
  };
  const userIds: string[] = [];
  const domains: string[] = [];
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--confirm':
        options.confirm = nextValue(args, i, '--confirm');
        i += 1;
        break;
      case '--reason': {
        const reason = nextValue(args, i, '--reason');
        if (reason !== 'cutover' && reason !== 'rollback' && reason !== 'aborted') {
          fail('--reason must be cutover, rollback, or aborted.');
        }
        options.reason = reason;
        i += 1;
        break;
      }
      case '--allow-stale-destination':
        options.allowStaleDestination = true;
        break;
      case '--user':
        userIds.push(...parseList(nextValue(args, i, '--user')));
        i += 1;
        break;
      case '--domain':
        domains.push(...parseList(nextValue(args, i, '--domain')));
        i += 1;
        break;
      case '--batch-size': {
        const raw = nextValue(args, i, '--batch-size');
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value < 1 || value > USER_DATA_MIGRATION_MAX_BATCH_SIZE) {
          fail(`--batch-size must be an integer from 1 to ${USER_DATA_MIGRATION_MAX_BATCH_SIZE}.`);
        }
        options.batchSize = value;
        i += 1;
        break;
      }
      case '--out':
        options.out = nextValue(args, i, '--out');
        i += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        fail(`Unknown option "${arg}". Use --help for usage.`);
    }
  }
  if (options.apply && options.command !== 'forward' && options.command !== 'reverse') {
    fail('--apply is only valid with forward or reverse.');
  }
  if (options.apply && options.confirm !== USER_DATA_MIGRATION_ID) {
    fail(`--apply requires --confirm ${USER_DATA_MIGRATION_ID}. Run a dry run first and obtain owner approval.`);
  }
  if (options.command === 'release' && !options.reason) {
    fail('release requires --reason cutover, rollback, or aborted.');
  }
  if (options.command !== 'release' && options.reason) {
    fail('--reason is only valid with release.');
  }
  if (options.command !== 'reverse' && options.allowStaleDestination) {
    fail('--allow-stale-destination is only valid with reverse.');
  }
  if (userIds.length > 0) options.userIds = [...new Set(userIds)];
  if (domains.length > 0) {
    for (const domain of domains) {
      if (!USER_COLLECTIONS.includes(domain as UserCollectionName)) {
        fail(`Unknown domain "${domain}". Available: ${USER_COLLECTIONS.join(', ')}.`);
      }
    }
    options.domains = [...new Set(domains)] as UserCollectionName[];
  }
  return options;
}

function printFence(fence: MigrationFenceRecord | null): void {
  if (!fence) {
    console.log('Fence: none');
    return;
  }
  console.log(
    `Fence: ${fence.phase.toUpperCase()} migration=${fence.migrationId} direction=${fence.direction} `
    + `generation=${fence.generation} source=${fence.sourceStore} target=${fence.targetStore} `
    + `started=${fence.startedAt} updated=${fence.updatedAt}`,
  );
  if (fence.phase === 'released') {
    console.log(`Release: reason=${fence.releaseReason ?? '(none)'} at=${fence.releasedAt ?? '(none)'}`);
  }
  console.log(`Domains (${fence.domains.length}): ${fence.domains.join(', ')}`);
  console.log(`Scope: ${fence.userIds ? `${fence.userIds.length} account(s)` : 'all accounts'}`);
  if (fence.smoke) {
    console.log(
      `Release smoke: ${fence.smoke.passed ? 'PASS' : 'FAIL'} mode=${fence.smoke.mode} `
      + `operations=${fence.smoke.operations.join(',')} elapsedMs=${fence.smoke.elapsedMs}`
      + (fence.smoke.error ? ` error=${fence.smoke.error}` : ''),
    );
  }
}

function printDryRunForward(report: UserDataMigrationReport, verbose: boolean): void {
  console.log(`Mode: FORWARD DRY RUN — no source or destination record was written.`);
  console.log(`Database: ${mongoTargetDescription()} (credentials are never printed)`);
  console.log(`Target collection: ${report.migration.targetCollection}`);
  printFence(null);
  console.log(
    `Records: source=${report.totals.sourceDocuments} validSourceKeys=${report.totals.validSourceKeys} `
    + `destination=${report.totals.destinationDocuments} matched=${report.totals.matchedKeys} `
    + `pending=${report.totals.pendingKeys} destinationOnly=${report.totals.destinationOnlyKeys}`,
  );
  console.log(
    `Blocking: conflicts=${report.totals.conflicts} duplicateSource=${report.totals.duplicateSourceKeys} `
    + `duplicateDestination=${report.totals.duplicateDestinationKeys} `
    + `invalidSource=${report.totals.invalidSourceDocuments} invalidDestination=${report.totals.invalidDestinationDocuments}`,
  );
  console.log(`Source checksum:          ${report.checksums.source}`);
  console.log(`Matched destination hash: ${report.checksums.matchedDestination}`);
  if (verbose) {
    for (const user of report.users) {
      console.log(`Account ${user.userId}: source=${user.validSourceKeys} matched=${user.matchedKeys} pending=${user.pendingKeys} blocking=${user.blockingIssues}`);
      for (const domain of user.domains) {
        if (domain.sourceDocuments === 0 && domain.destinationDocuments === 0) continue;
        console.log(
          `  ${domain.domain}: source=${domain.sourceDocuments} matched=${domain.matchedKeys} `
          + `pending=${domain.pendingKeys} conflicts=${domain.conflictKeys}`,
        );
      }
    }
  }
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  console.log(`Status: ${report.status === 'ready' ? 'READY (dry run only)' : 'BLOCKED'}`);
}

function printApplyForward(report: UserDataMigrationApplyReport, verbose: boolean): void {
  console.log('Mode: FORWARD APPLY — legacy lq_data_* collections remain untouched.');
  console.log(`Database: ${mongoTargetDescription()} (credentials are never printed)`);
  console.log(
    `Copied: ${report.applied.copied}; already present: ${report.applied.alreadyPresent}; `
    + `resumed domains: ${report.applied.resumedDomains}; accounts=${report.applied.users}; domains=${report.applied.domains}`,
  );
  if (report.after) {
    console.log(
      `Verification: sourceKeys=${report.after.totals.validSourceKeys} matched=${report.after.totals.matchedKeys} `
      + `pending=${report.after.totals.pendingKeys} conflicts=${report.after.totals.conflicts} `
      + `destinationOnly=${report.after.totals.destinationOnlyKeys}`,
    );
    console.log(`Source checksum:          ${report.after.checksums.source}`);
    console.log(`Matched destination hash: ${report.after.checksums.matchedDestination}`);
  }
  if (verbose && report.after) {
    for (const user of report.after.users) {
      console.log(`Account ${user.userId}: source=${user.validSourceKeys} matched=${user.matchedKeys} pending=${user.pendingKeys} blocking=${user.blockingIssues}`);
    }
  }
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  console.log(report.status === 'applied'
    ? 'Status: APPLIED AND VERIFIED. The fence is still ACTIVE; writes stay blocked.'
    : report.status === 'blocked'
      ? 'Status: BLOCKED — nothing was written.'
      : 'Status: INCOMPLETE — no success is claimed; fix the cause and rerun.');
}

function printDryRunReverse(report: ReverseUserDataMigrationReport, verbose: boolean): void {
  console.log('Mode: REVERSE DRY RUN — no record was written.');
  console.log(`Database: ${mongoTargetDescription()} (credentials are never printed)`);
  console.log(`Source collection: ${report.migration.sourceCollection}`);
  console.log(`Target collections: ${report.migration.targetCollections.join(', ')}`);
  console.log(
    `Records: source=${report.totals.sourceDocuments} validSourceKeys=${report.totals.validSourceKeys} `
    + `destination=${report.totals.destinationDocuments} matched=${report.totals.matchedKeys} `
    + `pending=${report.totals.pendingKeys} staleDestination=${report.totals.destinationOnlyKeys} `
    + `conflicts=${report.totals.conflicts}`,
  );
  console.log(`Source checksum:          ${report.checksums.source}`);
  console.log(`Matched destination hash: ${report.checksums.matchedDestination}`);
  if (verbose) {
    for (const user of report.users) {
      console.log(`Account ${user.userId}: source=${user.validSourceKeys} matched=${user.matchedKeys} pending=${user.pendingKeys} blocking=${user.blockingIssues}`);
      for (const domain of user.domains) {
        if (domain.sourceDocuments === 0 && domain.destinationDocuments === 0) continue;
        console.log(
          `  ${domain.domain}: source=${domain.sourceDocuments} matched=${domain.matchedKeys} `
          + `pending=${domain.pendingKeys} stale=${domain.destinationOnlyKeys} conflicts=${domain.conflictKeys}`,
        );
      }
    }
  }
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  console.log(`Status: ${report.status === 'ready' ? 'READY (dry run only)' : 'BLOCKED'}`);
}

function printApplyReverse(report: ReverseUserDataMigrationApplyReport, verbose: boolean): void {
  console.log('Mode: REVERSE APPLY — Unified is the source of truth for this copy.');
  console.log(`Database: ${mongoTargetDescription()} (credentials are never printed)`);
  console.log(
    `Copied: ${report.applied.copied}; updated: ${report.applied.updated}; `
    + `already present: ${report.applied.alreadyPresent}; stale removed: ${report.applied.staleRemoved}; `
    + `resumed domains: ${report.applied.resumedDomains}`,
  );
  if (report.after) {
    console.log(
      `Verification: sourceKeys=${report.after.totals.validSourceKeys} matched=${report.after.totals.matchedKeys} `
      + `pending=${report.after.totals.pendingKeys} conflicts=${report.after.totals.conflicts} `
      + `staleDestination=${report.after.totals.destinationOnlyKeys}`,
    );
    console.log(`Source checksum:          ${report.after.checksums.source}`);
    console.log(`Matched destination hash: ${report.after.checksums.matchedDestination}`);
  }
  if (verbose && report.after) {
    for (const user of report.after.users) {
      console.log(`Account ${user.userId}: source=${user.validSourceKeys} matched=${user.matchedKeys} pending=${user.pendingKeys} blocking=${user.blockingIssues}`);
    }
  }
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  console.log(report.status === 'applied'
    ? 'Status: APPLIED AND VERIFIED. The fence is still ACTIVE; writes stay blocked.'
    : report.status === 'blocked'
      ? 'Status: BLOCKED — nothing was written.'
      : 'Status: INCOMPLETE — no success is claimed; fix the cause and rerun.');
}

function migrationOptions(options: CliOptions): UserDataMigrationOptions {
  return {
    ...(options.userIds ? { userIds: options.userIds } : {}),
    ...(options.domains ? { domains: options.domains } : {}),
    batchSize: options.batchSize,
  };
}

/**
 * Re-read source and destination immediately before a cutover/rollback release.
 * Journal entries prove what an earlier apply observed; this proves the live
 * stores still match, including any Legacy/Unified write that bypassed the
 * fence via an older deployment. A destination-only record blocks a cutover
 * because it has no reconciled legacy source.
 */
async function inspectLiveReleaseParity(
  store: ReturnType<typeof createDataStore>,
  reason: 'cutover' | 'rollback',
): Promise<UserDataMigrationReport | ReverseUserDataMigrationReport> {
  const report = reason === 'cutover'
    ? await inspectUserDataMigration(store)
    : await inspectReverseUserDataMigration(store);
  const direction = reason === 'cutover' ? 'forward' : 'reverse';
  const failures: string[] = [];
  if (report.status !== 'ready') failures.push('the dry-run plan is blocked');
  if (report.totals.pendingKeys !== 0) failures.push(`pendingKeys=${report.totals.pendingKeys}`);
  if (report.totals.conflicts !== 0) failures.push(`conflicts=${report.totals.conflicts}`);
  if (report.totals.destinationOnlyKeys !== 0) {
    failures.push(`destinationOnly=${report.totals.destinationOnlyKeys}`);
  }
  if (report.totals.matchedKeys !== report.totals.validSourceKeys) {
    failures.push(`matchedKeys=${report.totals.matchedKeys}/${report.totals.validSourceKeys}`);
  }
  if (report.checksums.source !== report.checksums.matchedDestination) {
    failures.push('source and matched-destination checksums differ');
  }
  if (failures.length > 0) {
    fail(
      `Live ${direction} parity check failed (${failures.join('; ')}). `
      + 'The fence remains active and writes stay blocked. Resolve the report and rerun.',
    );
  }
  console.log(
    `Live ${direction} parity: users=${report.totals.users} sourceKeys=${report.totals.validSourceKeys} `
    + `matched=${report.totals.matchedKeys} pending=0 conflicts=0 destinationOnly=0; checksums match.`,
  );
  return report;
}

function reverseOptions(options: CliOptions): ReverseMigrationOptions {
  return {
    ...migrationOptions(options),
    allowStaleDestinationRemoval: options.allowStaleDestination,
  };
}

async function ensureFence(
  store: ReturnType<typeof createDataStore>,
  options: CliOptions,
): Promise<MigrationFenceRecord> {
  if (!options.direction) fail('This command has no migration direction.');
  const direction = options.direction;
  const sourceStore = direction === MIGRATION_FORWARD_DIRECTION ? 'legacy' : 'unified';
  const targetStore = direction === MIGRATION_FORWARD_DIRECTION ? 'unified' : 'legacy';
  const existing = await readMigrationFence(store);
  if (existing && existing.phase !== 'released') {
    const domains = options.domains ?? [...USER_COLLECTIONS];
    const expectedIds = options.userIds ? [...options.userIds].sort() : null;
    const sameScope = existing.userIds === null
      ? expectedIds === null
      : expectedIds !== null
        && existing.userIds.length === expectedIds.length
        && existing.userIds.every((id, index) => id === expectedIds[index]);
    const sameDomains = existing.domains.length === domains.length
      && domains.every((domain) => existing.domains.includes(domain));
    if (existing.migrationId !== USER_DATA_MIGRATION_ID
      || existing.direction !== direction
      || existing.sourceStore !== sourceStore
      || existing.targetStore !== targetStore
      || !sameScope
      || !sameDomains) {
      fail(
        `An active fence belongs to a different migration (${existing.migrationId}, ${existing.direction}). `
        + 'Resolve it explicitly; this command did not take it over.',
      );
    }
    console.log(`Resuming the existing ${direction} fence generation ${existing.generation}.`);
    return existing;
  }
  return acquireMigrationFence(store, {
    migrationId: USER_DATA_MIGRATION_ID,
    direction,
    sourceStore,
    targetStore,
    domains: options.domains ?? [...USER_COLLECTIONS],
    userIds: options.userIds ?? null,
  });
}

async function writeEvidence(path: string | null, value: unknown): Promise<void> {
  if (!path) return;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' });
  console.log(`Evidence written to ${path}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  // A dry run must not create indexes or collections. Apply/release use the
  // normal adapter so the fence, journal, and target indexes exist.
  const needsIndexes = options.apply || options.command === 'release';
  const store = createDataStore(getMongoAdapter({ ensureIndexes: needsIndexes }));

  if (options.command === 'status') {
    const forward = await getMigrationStatus(store, USER_DATA_MIGRATION_ID, MIGRATION_FORWARD_DIRECTION);
    const reverse = await getMigrationStatus(store, USER_DATA_MIGRATION_ID, MIGRATION_REVERSE_DIRECTION);
    if (options.json) {
      console.log(JSON.stringify({ forward, reverse }, null, 2));
    } else {
      console.log(`Selected data store: ${env.userDataStore}`);
      printFence(forward.fence);
      for (const [direction, status] of [
        [MIGRATION_FORWARD_DIRECTION, forward],
        [MIGRATION_REVERSE_DIRECTION, reverse],
      ] as const) {
        console.log(
          `Journal (${direction}): total=${status.journal.total} verified=${status.journal.verified} `
          + `copied=${status.journal.copied} pending=${status.journal.pending} failed=${status.journal.failed}`,
        );
      }
    }
    return;
  }

  if (options.command === 'smoke') {
    const smoke = await runStorageSmokeTest(store);
    if (options.json) console.log(JSON.stringify(smoke, null, 2));
    else {
      console.log(`Storage smoke: ${smoke.passed ? 'PASS' : 'FAIL'} mode=${smoke.mode} operations=${smoke.operations.join(',')} elapsedMs=${smoke.elapsedMs}`);
      if (smoke.error) console.log(`Error: ${smoke.error}`);
    }
    if (!smoke.passed) process.exitCode = 1;
    return;
  }

  if (options.command === 'release') {
    const existing = await readMigrationFence(store);
    if (!existing) fail('No migration fence exists to release.');
    const expectedMode = options.reason === 'cutover'
      ? 'unified'
      : options.reason === 'rollback'
        ? 'legacy'
        : env.userDataStore;
    if (env.userDataStore !== expectedMode) {
      fail(
        `LQ_USER_DATA_STORE is "${env.userDataStore}", but a ${options.reason} release requires "${expectedMode}". `
        + 'Change the deployment configuration first; the fence stays active and no data was changed.',
      );
    }
    if (existing.phase === 'released') {
      console.log('The fence is already released; no change was made.');
      printFence(existing);
      return;
    }
    if (existing.migrationId !== USER_DATA_MIGRATION_ID) {
      fail('The active fence belongs to a different migration id; it was not released.');
    }
    const releaseReason = options.reason!;
    const parity = releaseReason === 'aborted'
      ? null
      : await inspectLiveReleaseParity(store, releaseReason);
    const released = await releaseMigrationFence(store, {
      migrationId: existing.migrationId,
      reason: releaseReason,
    });
    await writeEvidence(options.out, { reason: releaseReason, fence: released, parity });
    console.log(
      `Fence released: reason=${releaseReason} migration=${released.migrationId} generation=${released.generation}. `
      + `Smoke mode=${released.smoke?.mode} passed=${released.smoke?.passed}.`,
    );
    if (options.json) console.log(JSON.stringify(released, null, 2));
    return;
  }

  if (options.command === 'forward' && options.apply && env.userDataStore !== 'legacy') {
    fail('Forward migration must run while LQ_USER_DATA_STORE=legacy. Nothing was acquired or copied.');
  }
  if (options.command === 'reverse' && options.apply && env.userDataStore !== 'unified') {
    fail('Reverse migration must run while LQ_USER_DATA_STORE=unified (the source). Nothing was acquired or copied.');
  }

  if (options.command === 'forward') {
    if (!options.apply) {
      const report = await inspectUserDataMigration(store, migrationOptions(options));
      await writeEvidence(options.out, report);
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printDryRunForward(report, options.verbose);
      process.exitCode = report.status === 'ready' ? 0 : 1;
      return;
    }
    const fence = await ensureFence(store, options);
    printFence(fence);
    const drained = await drainAccountWriters(store);
    console.log(
      `Write drain: scanned=${drained.scanned} activeWriters=${drained.activeWriters} `
      + `staleLeasesReset=${drained.staleLeasesReset} waitedMs=${drained.waitedMs}`,
    );
    const report = await applyUserDataMigration(store, migrationOptions(options));
    await writeEvidence(options.out, { fence, drain: drained, report });
    if (options.json) console.log(JSON.stringify({ fence, drain: drained, report }, null, 2));
    else printApplyForward(report, options.verbose);
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  if (options.command === 'reverse') {
    if (!options.apply) {
      const report = await inspectReverseUserDataMigration(store, reverseOptions(options));
      await writeEvidence(options.out, report);
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printDryRunReverse(report, options.verbose);
      process.exitCode = report.status === 'ready' ? 0 : 1;
      return;
    }
    const fence = await ensureFence(store, options);
    printFence(fence);
    const drained = await drainAccountWriters(store);
    console.log(
      `Write drain: scanned=${drained.scanned} activeWriters=${drained.activeWriters} `
      + `staleLeasesReset=${drained.staleLeasesReset} waitedMs=${drained.waitedMs}`,
    );
    const report = await applyReverseUserDataMigration(store, reverseOptions(options));
    await writeEvidence(options.out, { fence, drain: drained, report });
    if (options.json) console.log(JSON.stringify({ fence, drain: drained, report }, null, 2));
    else printApplyReverse(report, options.verbose);
    process.exitCode = report.ok ? 0 : 1;
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Migration command failed.';
    console.error(`Migration error: ${message}`);
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeMongo().catch(() => undefined);
  });
