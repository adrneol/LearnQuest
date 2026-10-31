import { readFile } from 'node:fs/promises';
import {
  compareMigrationReports,
  type MigrationReportLike,
} from '../services/migrationReportComparison.js';

/**
 * Compare two controlled migration inspection reports for restore verification.
 * See `migrationReportComparison.ts` for the exact fields checked. It never
 * prints record values, emails, notes, tokens, or connection strings.
 *
 * Usage:
 *   npm run compare:migration-reports -- <baseline.json> <restored.json>
 */
async function load(path: string): Promise<MigrationReportLike> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  try {
    return JSON.parse(text) as MigrationReportLike;
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

async function main(): Promise<void> {
  const [baselinePath, restoredPath] = process.argv.slice(2);
  if (!baselinePath || !restoredPath) {
    console.error('Usage: npm run compare:migration-reports -- <baseline.json> <restored.json>');
    process.exitCode = 2;
    return;
  }
  const baseline = await load(baselinePath);
  const restored = await load(restoredPath);
  const result = compareMigrationReports(baseline, restored);
  if (!result.ok) {
    for (const failure of result.failures) console.error(`Restore comparison: FAIL — ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('Restore comparison: PASS');
  console.log(`Direction: ${result.direction}`);
  console.log(`Source documents: ${result.sourceDocuments}`);
  console.log(`Valid source keys: ${result.validSourceKeys}`);
  console.log(`Canonical checksum: ${result.sourceChecksum}`);
  console.log(`Account/domain units compared: ${result.comparedUnits}`);
  console.log('No record payloads were printed.');
}

main().catch((error: unknown) => {
  console.error(`Restore comparison: FAIL — ${error instanceof Error ? error.message : 'comparison failed'}`);
  process.exitCode = 2;
});
