import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Run before application imports: the secrets singleton captures this path at import time.
const previousDataDir = process.env.OPENLORE_DATA_DIR;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlore-test-'));
process.env.OPENLORE_DATA_DIR = dataDir;

afterAll(async () => {
  try {
    const { getSqliteDatabase } = await import('../src/infrastructure/persistence/sqlite/db.js');
    const db = getSqliteDatabase();
    if (db.open) db.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.OPENLORE_DATA_DIR;
    else process.env.OPENLORE_DATA_DIR = previousDataDir;
  }
});
