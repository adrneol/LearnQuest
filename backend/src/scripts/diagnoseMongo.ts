import 'dotenv/config';
import { promises as dns } from 'node:dns';
import { connect as tlsConnect } from 'node:tls';
import { MongoClient } from 'mongodb';
import { env } from '../config/env.js';
import {
  classifyMongoError,
  describeMongoFailure,
  isRetryableMongoFailure,
  mongoDiagnosticSignals,
  sanitizeMongoError,
  tlsAlertDescription,
  type MongoFailureClass,
} from '../db/mongoErrors.js';

/**
 * Short-lived, read-only MongoDB connectivity diagnostic.
 *
 * It uses the same environment loader and MongoDB driver as the application,
 * performs exactly one `ping`, and closes the client. It never creates an
 * index or collection, never writes, and never prints the URI, host, database
 * user, password, or a raw driver exception.
 *
 * Usage:
 *   npm run diagnose:mongo
 *   npm run diagnose:mongo -- --probe-tls
 */

type DiagnosticClassification =
  | 'CONNECTED'
  | 'NOT_CONFIGURED'
  | 'INVALID_URI'
  | 'INVALID_DATABASE_NAME'
  | MongoFailureClass;

/**
 * Inspect only option names and non-secret booleans. No URI, host, user, or
 * option value is copied into the output.
 */
function uriShape(uri: string): Record<string, unknown> {
  const shape: Record<string, unknown> = {
    hasCredentials: false,
    hasDatabasePath: false,
    optionKeys: [] as string[],
    tlsOption: 'unset',
    sslOption: 'unset',
    directConnection: false,
    replicaSet: false,
  };
  try {
    const parsed = new URL(uri);
    shape.hasCredentials = Boolean(parsed.username || parsed.password);
    shape.hasDatabasePath = parsed.pathname.length > 1;
    shape.optionKeys = [...parsed.searchParams.keys()].sort();
    shape.tlsOption = parsed.searchParams.get('tls')?.toLowerCase() ?? 'unset';
    shape.sslOption = parsed.searchParams.get('ssl')?.toLowerCase() ?? 'unset';
    shape.directConnection = parsed.searchParams.get('directConnection')?.toLowerCase() === 'true';
    shape.replicaSet = parsed.searchParams.has('replicaSet');
  } catch {
    // env.mongodbUri already validates the scheme; leave the shape empty if
    // the platform URL parser cannot represent it.
  }
  return shape;
}

function srvHost(uri: string): { srv: boolean; host: string } | null {
  try {
    const parsed = new URL(uri);
    return {
      srv: parsed.protocol === 'mongodb+srv:',
      host: parsed.hostname,
    };
  } catch {
    return null;
  }
}

/** One sanitized TLS handshake attempt. No MongoDB command is sent. */
async function tlsAttempt(
  host: string,
  port: number,
  servername: string | undefined,
  sniMode: 'srv_target' | 'cluster_host' | 'none',
): Promise<Record<string, unknown>> {
  const started = Date.now();
  return new Promise<Record<string, unknown>>((resolve) => {
    const socket = tlsConnect({
      host,
      port,
      ...(servername ? { servername } : {}),
      timeout: 7_000,
      // TLS verification stays enabled; disabling it would hide the defect.
      rejectUnauthorized: true,
    });
    let settled = false;
    const finish = (value: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ sniMode, ...value, elapsedMs: Date.now() - started });
    };
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      finish({
        tlsHandshake: 'succeeded',
        authorized: socket.authorized,
        authorizationError: socket.authorizationError || null,
        protocol: socket.getProtocol(),
        certificateIssuerCn: typeof certificate.issuer?.CN === 'string' ? certificate.issuer.CN : null,
        certificateValidTo: typeof certificate.valid_to === 'string' ? certificate.valid_to : null,
      });
    });
    socket.once('error', (error: Error) => {
      finish({
        tlsHandshake: 'failed',
        error: sanitizeMongoError(error),
        signals: mongoDiagnosticSignals(error),
        tlsAlert: tlsAlertDescription(error),
      });
    });
    socket.once('timeout', () => {
      finish({ tlsHandshake: 'timeout' });
    });
  });
}

/**
 * DNS/TLS probes against the already-configured endpoint. This is still
 * read-only: it opens TLS sockets, records whether each certificate handshake
 * succeeds, and closes them. No MongoDB command, account lookup, or write is
 * performed.
 */
async function probeEndpoint(uri: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  const probe: Record<string, unknown> = { attempted: true };
  const target = srvHost(uri);
  if (!target) {
    probe.error = 'URI could not be parsed for probing';
    return probe;
  }

  let records: Array<{ name: string; port: number }> = [{ name: target.host, port: 27017 }];
  if (target.srv) {
    try {
      const resolved = await dns.resolveSrv(`_mongodb._tcp.${target.host}`);
      probe.srvResolved = resolved.length > 0;
      probe.srvRecordCount = resolved.length;
      if (resolved.length === 0) {
        probe.error = 'No SRV records returned';
        probe.elapsedMs = Date.now() - started;
        return probe;
      }
      records = resolved.map((record) => ({ name: record.name, port: record.port }));
    } catch (error: unknown) {
      probe.srvResolved = false;
      probe.error = sanitizeMongoError(error);
      probe.signals = mongoDiagnosticSignals(error);
      probe.elapsedMs = Date.now() - started;
      return probe;
    }
    try {
      const txt = await dns.resolveTxt(target.host);
      probe.txtResolved = txt.length > 0;
      probe.txtRecordCount = txt.length;
    } catch {
      probe.txtResolved = false;
      probe.txtRecordCount = 0;
    }
  }

  const attempts: Array<Record<string, unknown>> = [];
  for (const record of records) {
    attempts.push(await tlsAttempt(record.name, record.port, record.name, 'srv_target'));
  }
  if (target.srv) {
    // Some Atlas front ends expect the original cluster hostname as SNI even
    // though the driver connects to an SRV target. Test it without changing
    // the configured URI.
    attempts.push(await tlsAttempt(records[0].name, records[0].port, target.host, 'cluster_host'));
  }
  probe.attempts = attempts;
  probe.elapsedMs = Date.now() - started;
  return probe;
}

async function main(): Promise<void> {
  const probeRequested = process.argv.includes('--probe-tls');
  const started = Date.now();
  const result: Record<string, unknown> = {
    diagnostic: 'mongo-read-only-connectivity',
    readOnly: true,
    runtime: { node: process.version },
    database: { expected: 'learnquest', matches: false },
  };

  let client: MongoClient | null = null;
  let configuredUri: string | null = null;
  try {
    const configured = env.mongodbConfigured;
    result.configured = configured;
    if (!configured) {
      result.classification = 'NOT_CONFIGURED' satisfies DiagnosticClassification;
      result.retryable = false;
      result.elapsedMs = Date.now() - started;
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    const uri = env.mongodbUri;
    configuredUri = uri;
    const dbName = env.mongodbDbName;
    const scheme = uri.startsWith('mongodb+srv://') ? 'mongodb+srv' : 'mongodb';
    result.uri = { scheme, structurallyValid: true, options: uriShape(uri) };
    result.database = { expected: 'learnquest', matches: dbName === 'learnquest' };
    if (dbName !== 'learnquest') {
      result.classification = 'INVALID_DATABASE_NAME' satisfies DiagnosticClassification;
      result.retryable = false;
      result.elapsedMs = Date.now() - started;
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 7_000,
      connectTimeoutMS: 7_000,
      maxPoolSize: 1,
      retryWrites: false,
      // One diagnostic attempt: do not hide the first failure behind retries.
      retryReads: false,
    });
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    result.classification = 'CONNECTED' satisfies DiagnosticClassification;
    result.connected = true;
    result.ping = true;
    result.retryable = false;
    result.elapsedMs = Date.now() - started;
    console.log(JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    const classification = classifyMongoError(error);
    result.classification = classification satisfies DiagnosticClassification;
    result.connected = false;
    result.ping = false;
    result.retryable = isRetryableMongoFailure(classification);
    result.elapsedMs = Date.now() - started;
    result.error = sanitizeMongoError(error);
    result.signals = mongoDiagnosticSignals(error);
    result.tlsAlert = tlsAlertDescription(error);
    result.detail = describeMongoFailure(error);
    if (probeRequested && configuredUri) {
      result.networkProbe = await probeEndpoint(configuredUri);
    }
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    await client?.close().catch(() => undefined);
  }
}

void main();
