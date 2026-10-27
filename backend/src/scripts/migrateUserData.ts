import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { closeMongo, getMongoAdapter, mongoTargetDescription } from '../db/mongo.js';
import { createDataStore, USER_COLLECTIONS, type UserCollectionName } from '../store.js';
import {
  USER_DATA_MIGRATION_DEFAULT_BATCH_SIZE,
  USER_DATA_MIGRATION_ID,
  USER_DATA_MIGRATION_MAX_BATCH_SIZE,
  applyUserDataMigration,
  inspectUserDataMigration,
  type UserDataMigrationApplyReport,
  type UserDataMigrationOptions,
  type UserDataMigrationReport,
} from '../services/userDataMigration.js';

interface CliOptions {
  apply: boolean;
  confirm: string | null;
  userIds?: string[];
  domains?: UserCollectionName[];
  batchSize: number;
  json: boolean;
  verbose: boolean;
  out: string | null;
}

const HELP = `LearnQuest user-data migration (${USER_DATA_MIGRATION_ID})

Dry run is the default. No legacy lq_data_* source record is ever modified or
deleted by this tool.

Usage:
  npm run migrate:user-data -- [options]

Options:
  --apply                  Copy eligible records into lq_user_data.
                           Requires --confirm ${USER_DATA_MIGRATION_ID}
  --confirm <id>           Typed safety confirmation for --apply.
  --user <id>              Restrict to one account; repeat or comma-separate.
  --domain <name>          Restrict to one domain; repeat or comma-separate.
                           Available: ${USER_COLLECTIONS.join(', ')}
  --batch-size <n>         Database read batch size (default ${USER_DATA_MIGRATION_DEFAULT_BATCH_SIZE}, max ${USER_DATA_MIGRATION_MAX_BATCH_SIZE}).
  --json                   Print the complete report as JSON.
  --out <path>             Write the complete report as JSON to a file.
  --verbose                Print per-domain counts.
  --help                   Show this message.

Safety:
  * The source collections are read-only.
  * A blocked plan (duplicate, malformed record, or destination conflict)
    writes nothing.
  * Success is reported only after post-copy checksum/count verification.
  * Rerunning an interrupted apply is safe and resumes idempotently.
`;

function parseList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    confirm: null,
    batchSize: USER_DATA_MIGRATION_DEFAULT_BATCH_SIZE,
    json: false,
    verbose: false,
    out: null,
  };
  const userIds: string[] = [];
  const domains: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const nextValue = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}.`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--confirm':
        options.confirm = nextValue();
        break;
      case '--user':
        userIds.push(...parseList(nextValue()));
        break;
      case '--domain':
        domains.push(...parseList(nextValue()));
        break;
      case '--batch-size': {
        const raw = nextValue();
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value < 1 || value > USER_DATA_MIGRATION_MAX_BATCH_SIZE) {
          throw new Error(`--batch-size must be an integer from 1 to ${USER_DATA_MIGRATION_MAX_BATCH_SIZE}.`);
        }
        options.batchSize = value;
        break;
      }
      case '--json':
        options.json = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--out':
        options.out = nextValue();
        break;
      case '--help':
      case '-h':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option "${arg}". Use --help for usage.`);
    }
  }

  if (options.apply && options.confirm !== USER_DATA_MIGRATION_ID) {
    throw new Error(
      `--apply requires --confirm ${USER_DATA_MIGRATION_ID}. Run a dry run first and obtain owner approval.`,
    );
  }
  if (userIds.length > 0) options.userIds = userIds;
  if (domains.length > 0) {
    for (const domain of domains) {
      if (!USER_COLLECTIONS.includes(domain as UserCollectionName)) {
        throw new Error(`Unknown domain "${domain}". Available: ${USER_COLLECTIONS.join(', ')}.`);
      }
    }
    options.domains = [...new Set(domains)] as UserCollectionName[];
  }
  return options;
}

function migrationOptions(options: CliOptions): UserDataMigrationOptions {
  return {
    ...(options.userIds ? { userIds: options.userIds } : {}),
    ...(options.domains ? { domains: options.domains } : {}),
    batchSize: options.batchSize,
  };
}

function printDryRun(report: UserDataMigrationReport, verbose: boolean): void {
  console.log(`Migration: ${report.migration.id} (version ${report.migration.version})`);
  console.log('Mode: DRY RUN — no source or destination records were written.');
  console.log(`Target: ${mongoTargetDescription()}, collection ${report.migration.targetCollection}`);
  console.log(`Scope: ${report.totals.users} account(s); domains: ${report.migration.domains.join(', ')}`);
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
          + `pending=${domain.pendingKeys} conflicts=${domain.conflictKeys} `
          + `duplicateSource=${domain.duplicateSourceKeys} invalidSource=${domain.invalidSourceDocuments}`,
        );
      }
    }
  }
  if (report.globalIssues.length > 0) {
    console.log('Global ownership issues:');
    for (const issue of report.globalIssues) {
      console.log(`  ${issue.collection} key=${issue.key ?? '(none)'}: ${issue.reason}`);
    }
  }
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  console.log(`Status: ${report.status === 'ready' ? 'READY (dry run only)' : 'BLOCKED — resolve the listed issues before applying'}`);
  if (report.status === 'ready' && report.totals.pendingKeys > 0) {
    console.log(
      `Next: review this report, back up MongoDB, then run with --apply --confirm ${USER_DATA_MIGRATION_ID} during a maintenance window.`,
    );
  }
}

function printApply(report: UserDataMigrationApplyReport, verbose: boolean): void {
  console.log(`Migration: ${report.before.migration.id} (version ${report.before.migration.version})`);
  console.log(`Mode: APPLY — target ${mongoTargetDescription()}, collection ${report.before.migration.targetCollection}`);
  console.log(
    `Copied: ${report.applied.copied}; already present: ${report.applied.alreadyPresent}; `
    + `accounts with pending work: ${report.applied.users}; domains with pending work: ${report.applied.domains}`,
  );
  if (report.after) {
    console.log(
      `Verification: sourceKeys=${report.after.totals.validSourceKeys} matched=${report.after.totals.matchedKeys} `
      + `pending=${report.after.totals.pendingKeys} conflicts=${report.after.totals.conflicts}`,
    );
    console.log(`Source checksum:          ${report.after.checksums.source}`);
    console.log(`Matched destination hash: ${report.after.checksums.matchedDestination}`);
    if (verbose) {
      for (const user of report.after.users) {
        console.log(`Account ${user.userId}: source=${user.validSourceKeys} matched=${user.matchedKeys} pending=${user.pendingKeys} blocking=${user.blockingIssues}`);
      }
    }
  } else {
    console.log('Verification: unavailable (the post-copy inspection failed).');
  }
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  if (report.error) console.log(report.error);
  console.log(
    report.status === 'applied'
      ? 'Status: APPLIED AND VERIFIED. Legacy lq_data_* collections were left intact for rollback and owner-approved retirement.'
      : report.status === 'blocked'
        ? 'Status: BLOCKED — nothing was written.'
        : 'Status: INCOMPLETE — deletion of legacy data is not authorized and no success is claimed.',
  );
  console.log('Retirement of legacy collections requires explicit owner approval after backup and independent verification.');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  // A dry run must not create indexes or collections. The apply path uses the
  // normal adapter so the unified collection's unique/lookup indexes exist
  // before any record is copied.
  const store = createDataStore(getMongoAdapter({ ensureIndexes: options.apply }));
  const report = options.apply
    ? await applyUserDataMigration(store, migrationOptions(options))
    : await inspectUserDataMigration(store, migrationOptions(options));

  if (options.out) {
    await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8' });
    if (!options.json) console.log(`Report written to ${options.out}`);
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (options.apply) {
    printApply(report as UserDataMigrationApplyReport, options.verbose);
  } else {
    printDryRun(report as UserDataMigrationReport, options.verbose);
  }

  const ok = options.apply
    ? (report as UserDataMigrationApplyReport).ok
    : (report as UserDataMigrationReport).status === 'ready';
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Migration failed.';
    console.error(`Migration error: ${message}`);
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeMongo().catch(() => undefined);
  });
