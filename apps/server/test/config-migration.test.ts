import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  getSqliteDatabase,
  initDatabase,
} from '../src/infrastructure/persistence/sqlite/db.js';
import { groupsService } from '../src/modules/groups/service.js';
import { sourcesService } from '../src/modules/sources/service.js';
import { reportService } from '../src/modules/reports/service.js';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlore-migration-'));
beforeAll(() => {
  process.env.OPENLORE_DATA_DIR = dataDir;
  initDatabase();
});
afterAll(() => {
  getSqliteDatabase().close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
it('moves collection rules to sources, task schedules to tasks, and report settings to reporting without losing pool data', async () => {
  const db = getSqliteDatabase();
  await sourcesService.saveSource({
    id: 'source',
    name: 'Source',
    url: 'https://example.com/feed',
    options: { poll_interval_mins: 15 },
  });
  await groupsService.saveGroup({
    id: 'agent',
    name: 'Agent',
    repository_connection_id: 'repo',
    base_path: 'docs/agent',
  });
  db.exec(
    'ALTER TABLE groups ADD COLUMN notification_connection_id TEXT; CREATE TABLE group_source_rules (id TEXT, group_id TEXT, source_id TEXT, keywords_json TEXT, excluded_keywords_json TEXT)',
  );
  db.prepare('INSERT INTO group_source_rules VALUES (?, ?, ?, ?, ?)').run(
    'rule',
    'agent',
    'source',
    '["agent","mcp"]',
    '["ads"]',
  );
  for (const [key, value] of Object.entries({
    pipeline_run_cron: '0 7 * * *',
    daily_push_enabled: 'true',
    daily_push_cron: '0 10 * * *',
    daily_push_webhook_id: 'channel',
    timezone: 'Asia/Shanghai',
  }))
    db.prepare(
      'INSERT OR REPLACE INTO workspace_settings (key, value) VALUES (?, ?)',
    ).run(key, value);
  db.prepare('INSERT INTO articles (id, title) VALUES (?, ?)').run(
    'existing',
    'Existing article',
  );
  initDatabase();
  expect((await sourcesService.getSource('source'))?.options).toMatchObject({
    poll_interval_mins: 15,
    keywords: ['agent', 'mcp'],
    excluded_keywords: ['ads'],
    keyword_mode: 'any',
  });
  expect(await groupsService.getGroup('agent')).toMatchObject({
    schedule_cron: '0 7 * * *',
    source_ids: ['source'],
  });
  expect(await reportService.getPlan('report_default')).toMatchObject({
    enabled: true,
    pipeline_ids: ['agent'],
    schedule_cron: '0 10 * * *',
    notification_connection_id: 'channel',
  });
  expect(
    db.prepare('SELECT title FROM articles WHERE id = ?').get('existing'),
  ).toEqual({ title: 'Existing article' });
  expect(
    db
      .prepare("SELECT name FROM sqlite_master WHERE name='group_source_rules'")
      .get(),
  ).toBeUndefined();
  expect(
    db
      .prepare(
        "SELECT key FROM workspace_settings WHERE key='pipeline_run_cron'",
      )
      .get(),
  ).toBeUndefined();
  initDatabase(); // The migration must be safe on subsequent application starts.
  expect((await groupsService.getGroup('agent'))?.source_ids).toEqual([
    'source',
  ]);
});
