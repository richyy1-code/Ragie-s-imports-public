import { createRequire } from 'node:module';
import { readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const require = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { buildSync } = require('esbuild');
const output = 'artifacts/api-server/dist/tests';
mkdirSync(output, { recursive: true });
const tests = [];
for (const directory of ['artifacts/api-server/src/lib', 'artifacts/ragies-imports/src/lib']) {
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.test.ts') || name.includes('.integration.') || name === 'abuse-capacity.test.ts') continue;
    const target = path.join(output, `${directory.includes('api-server') ? 'server' : 'frontend'}-${name.replace(/\.ts$/, '.cjs')}`);
    buildSync({ entryPoints: [path.join(directory, name)], bundle: true, platform: 'node', format: 'cjs', external: ['pg-native', '@google-cloud/*', 'pino', 'pino-pretty'], outfile: target, logLevel: 'warning' });
    tests.push(target);
  }
}
const result = spawnSync(process.execPath, ['--test', ...tests], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', OWNER_EMAILS: 'owner@example.com', DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/synthetic' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
