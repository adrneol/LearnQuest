import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

// Keep OS/runtime paths, but do not pass through app credentials, proxies,
// dotenv overrides, or the opt-in MongoDB rehearsal configuration.
const osKeys = new Set([
  'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CI',
]);
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => osKeys.has(key.toUpperCase())));
env.NODE_ENV = 'test';
env.TZ = 'UTC';
const requireFromApp = createRequire(resolve('package.json'));
const manifest = requireFromApp.resolve('vitest/package.json');
const cli = resolve(dirname(manifest), requireFromApp(manifest).bin.vitest);
const result = spawnSync(process.execPath, [cli, 'run', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
