import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { env } from '../config/env.js';
import { normalizeEmail, normalizeUsername } from '../auth/crypto.js';
import { USER_COLLECTIONS } from '../store.js';

/**
 * Read-only owner inspection. This script connects directly with the MongoDB
 * driver and never calls the application startup path, so it cannot create
 * indexes, migrate, delete, or otherwise mutate the database.
 *
 * Usage:
 *   npm run inspect:user-data -- --user <userId|username|email>
 *   npm run inspect:user-data -- --user <id> --store both --json
 */

interface DomainSummary {
  domain: string;
  store: 'unified' | 'legacy';
  records: number;
  playlists: number;
  latestUpdatedAt: string | null;
}

function help(): void {
  console.log(`LearnQuest read-only user-data inspection

Usage:
  npm run inspect:user-data -- --user <userId|username|email> [options]

Options:
  --user <value>        Required. Exact userId, username, or email.
  --store <mode>        active (default), unified, legacy, or both.
  --json                Print JSON instead of the tree summary.
  --help                Show this message.

This command only reads. It never prints emails, password hashes, OAuth
subjects, session identifiers, tokens, or learning-record payloads.`);
}

function parseArgs(argv: string[]): { user: string; store: 'active' | 'unified' | 'legacy' | 'both'; json: boolean } {
  let user: string | null = null;
  let store: 'active' | 'unified' | 'legacy' | 'both' = 'active';
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--user': user = next(); break;
      case '--store': {
        const value = next();
        if (!['active', 'unified', 'legacy', 'both'].includes(value)) {
          throw new Error('--store must be active, unified, legacy, or both.');
        }
        store = value as typeof store;
        break;
      }
      case '--json': json = true; break;
      case '--help':
      case '-h': help(); process.exit(0); break;
      default: throw new Error(`Unknown option "${arg}". Use --help.`);
    }
  }
  if (!user || !user.trim()) throw new Error('--user is required.');
  return { user: user.trim(), store, json };
}

function selectedStores(mode: 'active' | 'unified' | 'legacy' | 'both'): Array<'unified' | 'legacy'> {
  if (mode === 'both') return ['unified', 'legacy'];
  if (mode === 'active') return [env.userDataStore];
  return [mode];
}

function summaryRows(rows: Array<Record<string, any>>, store: 'unified' | 'legacy'): DomainSummary[] {
  return rows.map((row) => ({
    domain: String(row._id ?? 'unknown'),
    store,
    records: Number(row.records ?? 0),
    playlists: Array.isArray(row.playlists) ? row.playlists.filter((id) => typeof id === 'string' && id).length : 0,
    latestUpdatedAt: typeof row.latest === 'string' ? row.latest : null,
  })).sort((a, b) => a.domain.localeCompare(b.domain));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!env.mongodbConfigured) throw new Error('MONGODB_URI is not configured. The inspection made no changes.');
  const client = new MongoClient(env.mongodbUri, {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    maxPoolSize: 1,
  });
  try {
    await client.connect();
    const db = client.db(env.mongodbDbName);
    const raw = options.user;
    const account = await db.collection('lq_accounts').findOne({
      $or: [
        { userId: raw },
        { emailNormalized: normalizeEmail(raw) },
        { usernameNormalized: normalizeUsername(raw) },
      ],
    });
    if (!account) throw new Error('No account matched that exact userId, username, or email. Nothing was read.');
    const userId = String(account.userId);

    const stores = selectedStores(options.store);
    const domains: DomainSummary[] = [];
    for (const store of stores) {
      if (store === 'unified') {
        const rows = await db.collection('lq_user_data').aggregate([
          { $match: { userId } },
          {
            $group: {
              _id: '$domain',
              records: { $sum: 1 },
              playlists: { $addToSet: '$playlistId' },
              latest: { $max: '$updatedAt' },
            },
          },
        ]).toArray();
        domains.push(...summaryRows(rows as Array<Record<string, any>>, store));
      } else {
        for (const domain of USER_COLLECTIONS) {
          const rows = await db.collection(`lq_data_${domain}`).aggregate([
            { $match: { userId } },
            {
              $group: {
                _id: domain,
                records: { $sum: 1 },
                playlists: { $addToSet: '$playlistId' },
                latest: { $max: '$updatedAt' },
              },
            },
          ]).toArray();
          domains.push(...summaryRows(rows as Array<Record<string, any>>, store));
        }
      }
    }

    const output = {
      readOnly: true,
      target: `database "${env.mongodbDbName}"`,
      account: {
        userId,
        username: typeof account.username === 'string' ? account.username : null,
        displayName: typeof account.displayName === 'string' ? account.displayName : null,
      },
      stores,
      totalRecords: domains.reduce((sum, domain) => sum + domain.records, 0),
      domains,
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }
    console.log(`LearnQuest read-only user-data inspection — ${output.target}`);
    console.log(`Account: ${output.account.username ?? '(no username)'} — ${userId}`);
    console.log(`Stores: ${stores.join(', ')} — ${output.totalRecords} learning record(s)`);
    for (const domain of domains) {
      console.log(
        `  ${domain.store}/${domain.domain}: ${domain.records} record(s), ${domain.playlists} playlist reference(s)`
        + (domain.latestUpdatedAt ? `, latest ${domain.latestUpdatedAt}` : ''),
      );
    }
    if (domains.length === 0) console.log('  No learning records found in the selected store(s).');
    console.log('No record was created, updated, deleted, migrated, or retired.');
  } finally {
    await client.close().catch(() => undefined);
  }
}

main()
  .catch((error: unknown) => {
    console.error(`Inspection error: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
