import { spawnSync } from 'node:child_process';
const key = process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;
if (!key) throw new Error('Set CLERK_PUBLISHABLE_KEY before building. It is embedded in the frontend.');
const env = { ...process.env, VITE_CLERK_PUBLISHABLE_KEY: key, PORT: process.env.PORT || '3000', BASE_PATH: '/', NODE_ENV: 'production', VITE_CLERK_USE_CONFIGURED_KEY: 'true' };
for (const args of [
  ['run', 'typecheck'],
  ['--filter', '@workspace/ragies-imports', 'run', 'build'],
  ['--filter', '@workspace/api-server', 'run', 'build'],
]) {
  const result = spawnSync('pnpm', args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
