import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { getAppPaths } from '../src/infrastructure/config/paths.js';
import { getSqliteDatabase, initDatabase } from '../src/infrastructure/persistence/sqlite/db.js';
import { GitHubClient } from '../src/infrastructure/repositories/github/client.js';
import { settingsService } from '../src/modules/settings/service.js';

it('isolates repository records and the imported secrets singleton before application code loads', async () => {
  const paths = getAppPaths();
  expect(path.dirname(paths.dataDir)).toBe(os.tmpdir());
  expect(path.basename(paths.dataDir)).toMatch(/^openlore-test-/);
  initDatabase();
  expect(getSqliteDatabase().name).toBe(paths.dbPath);
  expect(await settingsService.listRepositoryConnections()).toEqual([]);

  const testConnection = vi.spyOn(GitHubClient, 'testConnection').mockResolvedValue({
    ok: true,
    message: 'Test repository',
    defaultBranch: 'main',
  });
  try {
    const repo = await settingsService.saveRepositoryConnection({
      url: 'https://github.com/example/test-isolation.git',
      token: 'test_token',
    });
    expect(await settingsService.listRepositoryConnections()).toEqual([repo]);
    expect(JSON.parse(fs.readFileSync(paths.secretsPath, 'utf8'))).toEqual({
      [repo.credential_ref]: 'test_token',
    });
    await settingsService.deleteRepositoryConnection(repo.id);
    expect(await settingsService.listRepositoryConnections()).toEqual([]);
    expect(JSON.parse(fs.readFileSync(paths.secretsPath, 'utf8'))).toEqual({});
  } finally {
    testConnection.mockRestore();
  }
});
