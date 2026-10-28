import { createApp } from './app.js';
import { env, assertProductionConfig, configStatus } from './config/env.js';
import { closeMongo, getMongoAdapter, mongoTargetDescription } from './db/mongo.js';
import { createMongoSupervisor } from './db/mongoSupervisor.js';
import { createDataStore } from './store.js';
import { resumePendingAccountDeletions } from './services/accountDeletion.js';
import { resumeDeletionFences } from './auth/writeLease.js';
import { purgeExpiredSecurityRecords } from './services/securityMaintenance.js';

const entry = (process.argv[1] ?? '').replace(/\\/g, '/');
if (entry.endsWith('/dist/server.js') || entry.endsWith('/src/server.ts')) {
  assertProductionConfig();
  const status = configStatus();
  const store = createDataStore(getMongoAdapter());

  const supervisor = createMongoSupervisor({
    configured: env.mongodbConfigured,
    label: `MongoDB (${mongoTargetDescription()})`,
    log: (message) => console.log(message),
    logError: (message) => console.error(message),
    onFirstReady: async () => {
      // This callback is deliberately outside the reconnect loop. It runs at
      // most once per process, after the first fully ready connection, and
      // preserves the existing startup deletion-recovery policy. A later
      // network reconnect never resumes destructive maintenance.
      try {
        const resumed = await resumePendingAccountDeletions(store);
        if (resumed.attempted > 0) {
          console.log(`Account-deletion sweep: attempted=${resumed.attempted} completed=${resumed.completed} failed=${resumed.failed}.`);
        }
        const fences = await resumeDeletionFences(store);
        if (fences.scanned > 0) {
          console.log(`Account-deletion fence sweep: scanned=${fences.scanned} cleaned=${fences.cleaned} removed=${fences.removed}.`);
        }
        const expired = await purgeExpiredSecurityRecords(store);
        const expiredTotal = expired.sessions + expired.actionTokens + expired.oauthStates + expired.rateLimits;
        if (expiredTotal > 0) {
          console.log(`Expired security-record sweep: removed=${expiredTotal}.`);
        }
      } catch {
        console.error('MongoDB is ready but the account-deletion sweep failed. No deletion is reported complete; review pending deletion jobs before the next restart.');
      }
    },
  });

  const maintenanceTimer = setInterval(() => {
    void purgeExpiredSecurityRecords(store).catch(() => {
      // Best-effort housekeeping; readiness and request correctness do not
      // depend on it. The next interval or startup sweep retries.
    });
  }, 15 * 60_000);
  const unrefMaintenance = (maintenanceTimer as { unref?: () => void }).unref;
  if (typeof unrefMaintenance === 'function') unrefMaintenance.call(maintenanceTimer);

  const app = createApp({
    store,
    readiness: supervisor,
    onMongoFailure: (error) => supervisor.markUnavailable(error),
  });

  const server = app.listen(env.port, () => {
    console.log(`LearnQuest API listening on :${env.port} (CORS: ${env.corsOrigin.join(',')})`);
    if (status.setupRequired) {
      console.log(`LearnQuest setup required — missing: ${status.missing.join(', ')}. Auth stays fail-closed until configured.`);
    }
    if (!env.mongodbConfigured) {
      console.log('MongoDB is not configured. Auth and account data endpoints are disabled.');
      return;
    }
    // The listener is live immediately; readiness is reported separately at
    // /api/ready and becomes true only after ping + index initialization.
    void supervisor.start().catch(() => {
      console.error('MongoDB supervisor did not start cleanly; readiness remains unavailable.');
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; closing LearnQuest API.`);
    clearInterval(maintenanceTimer);
    supervisor.stop();
    server.close(() => {
      void closeMongo().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
