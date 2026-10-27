import { createApp } from './app.js';
import { env, assertProductionConfig, configStatus } from './config/env.js';
import { closeMongo, getMongoAdapter, getMongoDb, mongoTargetDescription } from './db/mongo.js';
import { createDataStore } from './store.js';
import { resumePendingAccountDeletions } from './services/accountDeletion.js';

const entry = (process.argv[1] ?? '').replace(/\\/g, '/');
if (entry.endsWith('/dist/server.js') || entry.endsWith('/src/server.ts')) {
  assertProductionConfig();
  const status = configStatus();
  const store = createDataStore(getMongoAdapter());
  const server = createApp({ store }).listen(env.port, async () => {
    console.log(`LearnQuest API listening on :${env.port} (CORS: ${env.corsOrigin.join(',')})`);
    if (status.setupRequired) {
      console.log(`LearnQuest setup required — missing: ${status.missing.join(', ')}. Auth stays fail-closed until configured.`);
    }
    if (env.mongodbConfigured) {
      try {
        await getMongoDb();
        console.log(`MongoDB connected (${mongoTargetDescription()}).`);
        // Complete deletion sagas interrupted by a crash/restart. Only
        // accounts already marked `deleting` are eligible; active accounts are
        // never touched by this sweep.
        const resumed = await resumePendingAccountDeletions(store);
        if (resumed.attempted > 0) {
          console.log(`Account-deletion sweep: attempted=${resumed.attempted} completed=${resumed.completed} failed=${resumed.failed}.`);
        }
      } catch {
        console.error(`MongoDB is configured but unreachable (${mongoTargetDescription()}). Auth/data endpoints will return a setup/unavailable error; no local fallback is enabled.`);
      }
    } else {
      console.log('MongoDB is not configured. Auth and account data endpoints are disabled.');
    }
  });
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}; closing LearnQuest API.`);
    server.close(() => {
      void closeMongo().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
