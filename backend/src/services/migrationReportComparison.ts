/**
 * Compare two migration inspection reports for restore verification.
 *
 * Reports come from the controlled forward dry run (Legacy source) or reverse
 * dry run (Unified source). The comparison uses only per-account/per-domain
 * counts and canonical checksums. It never reads, prints, or stores record
 * payloads, emails, notes, tokens, or connection strings.
 */
export interface MigrationReportDomainLike {
  domain: string;
  sourceDocuments: number;
  validSourceKeys: number;
  sourceChecksum: string;
}

export interface MigrationReportUserLike {
  userId: string;
  domains: MigrationReportDomainLike[];
}

export interface MigrationReportLike {
  migration?: { id?: string; direction?: string; mode?: string; domains?: string[] };
  totals?: { sourceDocuments?: number; validSourceKeys?: number };
  checksums?: { source?: string };
  users?: MigrationReportUserLike[];
  status?: string;
}

export interface RestoreComparisonResult {
  ok: boolean;
  failures: string[];
  direction: string;
  sourceDocuments: number;
  validSourceKeys: number;
  sourceChecksum: string;
  comparedUnits: number;
}

function reportDirection(report: MigrationReportLike): string {
  if (typeof report.migration?.direction === 'string') return report.migration.direction;
  if (report.migration?.mode === 'reverse-dry-run') return 'reverse';
  if (report.migration?.mode === 'dry-run') return 'forward';
  return 'unknown';
}

function indexDomains(report: MigrationReportLike): Map<string, MigrationReportDomainLike> {
  const out = new Map<string, MigrationReportDomainLike>();
  for (const user of report.users ?? []) {
    if (typeof user.userId !== 'string') continue;
    for (const domain of user.domains ?? []) {
      if (domain && typeof domain.domain === 'string') {
        out.set(`${user.userId}\u0000${domain.domain}`, domain);
      }
    }
  }
  return out;
}

/**
 * Pure comparison. Failure messages contain account ids and domain names only;
 * they never include a record key, value, email, or note. Account ids are
 * opaque application ids, not personal data.
 */
export function compareMigrationReports(
  baseline: MigrationReportLike,
  restored: MigrationReportLike,
): RestoreComparisonResult {
  const failures: string[] = [];
  if (!baseline.migration || !restored.migration) {
    return {
      ok: false,
      failures: ['a report is missing its migration block'],
      direction: 'unknown',
      sourceDocuments: 0,
      validSourceKeys: 0,
      sourceChecksum: '',
      comparedUnits: 0,
    };
  }
  const direction = reportDirection(baseline);
  if (direction !== reportDirection(restored)) {
    failures.push(`direction mismatch (${direction} vs ${reportDirection(restored)})`);
  }
  if (baseline.totals?.sourceDocuments !== restored.totals?.sourceDocuments) {
    failures.push(
      `source document count mismatch (${baseline.totals?.sourceDocuments} vs ${restored.totals?.sourceDocuments})`,
    );
  }
  if (baseline.totals?.validSourceKeys !== restored.totals?.validSourceKeys) {
    failures.push(
      `valid source key count mismatch (${baseline.totals?.validSourceKeys} vs ${restored.totals?.validSourceKeys})`,
    );
  }
  if (baseline.checksums?.source !== restored.checksums?.source) {
    failures.push(
      `canonical source checksum mismatch (${baseline.checksums?.source} vs ${restored.checksums?.source})`,
    );
  }
  const baselineDomains = indexDomains(baseline);
  const restoredDomains = indexDomains(restored);
  if (baselineDomains.size !== restoredDomains.size) {
    failures.push(`account/domain unit count mismatch (${baselineDomains.size} vs ${restoredDomains.size})`);
  }
  for (const [key, expected] of baselineDomains) {
    const actual = restoredDomains.get(key);
    const label = key.replace('\u0000', ' / ');
    if (!actual) {
      failures.push(`missing restored account/domain unit: ${label}`);
      continue;
    }
    if (actual.sourceDocuments !== expected.sourceDocuments) {
      failures.push(`document count mismatch for ${label} (${expected.sourceDocuments} vs ${actual.sourceDocuments})`);
    }
    if (actual.validSourceKeys !== expected.validSourceKeys) {
      failures.push(`valid key count mismatch for ${label} (${expected.validSourceKeys} vs ${actual.validSourceKeys})`);
    }
    if (actual.sourceChecksum !== expected.sourceChecksum) {
      failures.push(`checksum mismatch for ${label}`);
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    direction,
    sourceDocuments: baseline.totals?.sourceDocuments ?? 0,
    validSourceKeys: baseline.totals?.validSourceKeys ?? 0,
    sourceChecksum: baseline.checksums?.source ?? '',
    comparedUnits: baselineDomains.size,
  };
}
