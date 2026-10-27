import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { closeMongo, getMongoAdapter, mongoTargetDescription } from '../db/mongo.js';
import { createDataStore } from '../store.js';
import {
  LEGACY_RETIREMENT_CONFIRMATION,
  inspectLegacyRetirement,
  retireLegacyCollections,
} from '../services/legacyRetirement.js';

/**
 * Explicit legacy-collection retirement. Dry run is the default. This command
 * is never invoked by application startup, a health check, or a deployment
 * script, and the coding task that introduced it did not run it against live
 * Atlas.
 */
const HELP = `LearnQuest legacy learning-collection retirement

Dry run is the default. Nothing is dropped without every precondition below.

Usage:
  npm run retire:legacy-data -- --report <verified-migration.json> [--json]
  npm run retire:legacy-data -- --apply --report <verified-migration.json> \\
    --backup-confirmed --confirm "${LEGACY_RETIREMENT_CONFIRMATION}"

Options:
  --report <path>       A JSON report written by migrate:user-data --apply --out.
  --apply               Drop the legacy lq_data_* collections.
  --confirm <phrase>    Exact destructive confirmation phrase.
  --backup-confirmed    Confirm a verified backup exists and was tested.
  --json                Print the inspection/result as JSON.
  --help                Show this message.

Preconditions enforced:
  * LQ_USER_DATA_STORE=unified and LQ_USER_DATA_CUTOVER_ACK are set.
  * The reviewed report proves a verified apply with matching checksums.
  * A fresh inspection still finds zero pending/conflicting records.
  * Every legacy collection is listed before the explicit drop.
  * Operational collections, lq_accounts, and lq_user_data are never dropped.
`;

interface Options {
  apply: boolean;
  report: string | null;
  confirm: string | null;
  backupConfirmed: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, report: null, confirm: null, backupConfirmed: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--apply': options.apply = true; break;
      case '--report': options.report = next(); break;
      case '--confirm': options.confirm = next(); break;
      case '--backup-confirmed': options.backupConfirmed = true; break;
      case '--json': options.json = true; break;
      case '--help':
      case '-h': console.log(HELP); process.exit(0); break;
      default: throw new Error(`Unknown option "${arg}". Use --help.`);
    }
  }
  if (options.apply) {
    if (!options.report) throw new Error('--apply requires --report <verified-migration.json>.');
    if (!options.backupConfirmed) throw new Error('--apply requires --backup-confirmed.');
    if (options.confirm !== LEGACY_RETIREMENT_CONFIRMATION) {
      throw new Error(`--apply requires --confirm "${LEGACY_RETIREMENT_CONFIRMATION}".`);
    }
  }
  return options;
}

function printInspection(report: Awaited<ReturnType<typeof inspectLegacyRetirement>>): void {
  console.log(`Target: ${mongoTargetDescription()}`);
  console.log(`Status: ${report.status.toUpperCase()}`);
  console.log(`Migration: ${report.migration.id} — source=${report.migration.validSourceKeys} matched=${report.migration.matchedKeys} pending=${report.migration.pendingKeys} conflicts=${report.migration.conflicts}`);
  console.log('Legacy collections in scope:');
  for (const collection of report.collections) {
    console.log(`  ${collection.name}: ${collection.documents} record(s)`);
  }
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  for (const blocker of report.blockers) console.log(`Blocked: ${blocker}`);
  if (report.status === 'ready') {
    console.log(`Ready only after a verified backup. Apply with --apply --backup-confirmed --confirm "${LEGACY_RETIREMENT_CONFIRMATION}".`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const store = createDataStore(getMongoAdapter());
  let artifact: unknown = null;
  if (options.report) {
    artifact = JSON.parse(await readFile(options.report, 'utf8'));
  }

  if (!options.apply) {
    const report = await inspectLegacyRetirement(store, artifact);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printInspection(report);
    process.exitCode = report.status === 'ready' ? 0 : 1;
    return;
  }

  const result = await retireLegacyCollections(store, options.confirm!, artifact, {
    backupConfirmed: options.backupConfirmed,
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Retired ${result.dropped.length} legacy learning collection(s) on ${mongoTargetDescription()}:`);
    for (const name of result.dropped) console.log(`  dropped ${name}`);
    console.log('The consolidated lq_user_data collection, account records, sessions, tokens, and operational collections were not touched.');
  }
}

main()
  .catch((error: unknown) => {
    console.error(`Retirement error: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => undefined);
  });
