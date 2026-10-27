import { describe, expect, it } from 'vitest';
import {
  classifyMongoError,
  describeMongoFailure,
  isRetryableMongoFailure,
  mongoDiagnosticSignals,
  sanitizeMongoError,
  tlsAlertDescription,
} from '../src/db/mongoErrors.js';

function namedError(
  name: string,
  message: string,
  extra: Record<string, unknown> = {},
): Error {
  const error = new Error(message);
  error.name = name;
  return Object.assign(error, extra);
}

describe('sanitized MongoDB failure classification', () => {
  it('classifies a TLS alert without exposing the driver message', () => {
    const error = namedError(
      'MongoServerSelectionError',
      'connection to ac-secret-host.mongodb.net:27017 closed: SSL routines:ssl3_read_bytes:tlsv1 alert internal error',
      { cause: namedError('MongoNetworkError', 'tlsv1 alert internal error') },
    );
    expect(classifyMongoError(error)).toBe('TLS_FAILURE');
    expect(tlsAlertDescription(error)).toBe('internal_error');
    expect(mongoDiagnosticSignals(error)).toContain('tls_alert');
    expect(describeMongoFailure(error)).toContain('classification=TLS_FAILURE');
    expect(describeMongoFailure(error)).not.toContain('ac-secret-host');
  });

  it('distinguishes DNS, timeout, authentication, authorization, and Atlas access failures', () => {
    const dns = namedError('MongoNetworkError', 'getaddrinfo ENOTFOUND cluster.example', { code: 'ENOTFOUND' });
    expect(classifyMongoError(dns)).toBe('DNS_SRV_FAILURE');

    const timeout = namedError('MongoServerSelectionError', 'Server selection timed out after 7000 ms');
    expect(classifyMongoError(timeout)).toBe('NETWORK_TIMEOUT');
    expect(isRetryableMongoFailure('NETWORK_TIMEOUT')).toBe(true);

    const auth = namedError('MongoServerError', 'Authentication failed.', { code: 18 });
    expect(classifyMongoError(auth)).toBe('AUTHENTICATION_FAILED');
    expect(isRetryableMongoFailure('AUTHENTICATION_FAILED')).toBe(false);

    const authorization = namedError('MongoServerError', 'not authorized on learnquest', { code: 13 });
    expect(classifyMongoError(authorization)).toBe('AUTHORIZATION_FAILED');

    const atlas = namedError(
      'MongoServerSelectionError',
      'Could not connect: your IP address is not whitelisted in Atlas Network Access.',
    );
    expect(classifyMongoError(atlas)).toBe('ATLAS_ACCESS_DENIED');
  });

  it('classifies invalid URIs, closed clients, and unknown errors', () => {
    expect(classifyMongoError(namedError('MongoParseError', 'invalid connection string'))).toBe('INVALID_URI');
    expect(classifyMongoError(namedError('MongoTopologyClosedError', 'topology is closed'))).toBe('CLIENT_LIFECYCLE_ERROR');
    expect(classifyMongoError(new Error('something unexpected'))).toBe('UNKNOWN_ERROR');
  });

  it('never copies a secret-bearing exception message into sanitized output', () => {
    const error = namedError(
      'MongoParseError',
      'mongodb+srv://alice:supersecret@example.invalid/learnquest?retryWrites=true',
    );
    const sanitized = sanitizeMongoError(error);
    const description = describeMongoFailure(error);
    const serialized = JSON.stringify({ sanitized, description, signals: mongoDiagnosticSignals(error) });
    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('supersecret');
    expect(serialized).not.toContain('example.invalid');
    expect(serialized).not.toContain('mongodb+srv');
    expect(serialized).not.toContain('retryWrites');
  });

  it('extracts a TLS alert from a nested cause only as a description', () => {
    const error = namedError('MongoNetworkError', 'outer message', {
      cause: namedError('Error', 'write EPROTO tlsv1 alert handshake failure'),
    });
    expect(tlsAlertDescription(error)).toBe('handshake_failure');
    expect(classifyMongoError(error)).toBe('TLS_FAILURE');
  });
});
