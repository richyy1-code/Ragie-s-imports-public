import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(new URL('../lib/db/package.json', import.meta.url));
const { Client } = require('pg');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(await readFile(new URL('../lib/db/migrations/shipment-closing.sql', import.meta.url), 'utf8'));
  console.log('Shipment closing date migration applied successfully.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally { await client.end(); }
