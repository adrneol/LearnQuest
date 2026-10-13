import { createApp } from './app.js';
import { env } from './config/env.js';

const entry = (process.argv[1] ?? '').replace(/\\/g, '/');
if (entry.endsWith('/dist/server.js') || entry.endsWith('/src/server.ts')) {
  createApp().listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`LearnQuest API listening on :${env.port} (CORS: ${env.corsOrigin.join(',')})`);
  });
}
