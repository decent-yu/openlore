import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AppPaths {
  dataDir: string;
  dbPath: string;
  secretsPath: string;
  blobsDir: string;
  jobsDir: string;
  bundlesDir: string;
  logsDir: string;
  backupsDir: string;
}

export function getAppPaths(): AppPaths {
  const dataDir =
    process.env.OPENLORE_DATA_DIR || path.join(os.homedir(), '.openlore');

  const blobsDir = path.join(dataDir, 'blobs');
  const jobsDir = path.join(dataDir, 'jobs');
  const bundlesDir = path.join(dataDir, 'bundles');
  const logsDir = path.join(dataDir, 'logs');
  const backupsDir = path.join(dataDir, 'backups');

  // Ensure directories exist
  for (const dir of [dataDir, blobsDir, jobsDir, bundlesDir, logsDir, backupsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  return {
    dataDir,
    dbPath: path.join(dataDir, 'openlore.db'),
    secretsPath: path.join(dataDir, 'secrets.json'),
    blobsDir,
    jobsDir,
    bundlesDir,
    logsDir,
    backupsDir,
  };
}
