import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
process.env.NODE_ENV = 'production';
process.env.PORT ||= '3000';
process.env.SERVE_FRONTEND = 'true';
process.env.CLERK_USE_CONFIGURED_KEY = 'true';
process.env.DEPLOYMENT_PROVIDER = 'render';
process.env.FRONTEND_DIST ||= path.resolve('artifacts/ragies-imports/dist/public');
process.env.TRUST_PROXY_HOPS ||= '1';
process.env.OBJECT_STORAGE_PROVIDER ||= 'volume';
for (const name of ['DATABASE_URL', 'CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'SESSION_SECRET']) {
  if (!process.env[name]) throw new Error(`Missing required variable: ${name}`);
}
if (process.env.OBJECT_STORAGE_PROVIDER === 'volume') {
  if (!process.env.OBJECT_STORAGE_DIR) throw new Error('Set OBJECT_STORAGE_DIR to a persistent volume directory.');
  await mkdir(process.env.OBJECT_STORAGE_DIR, { recursive: true });
  await access(process.env.OBJECT_STORAGE_DIR, 6);
}
await access(path.join(process.env.FRONTEND_DIST, 'index.html'));
await import(pathToFileURL(path.resolve('artifacts/api-server/dist/index.mjs')).href);
