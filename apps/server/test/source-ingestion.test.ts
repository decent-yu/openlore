import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SourceOptionsSchema, type ContentItem } from '@openlore/contracts';
import {
  initDatabase,
  getSqliteDatabase,
} from '../src/infrastructure/persistence/sqlite/db.js';
import {
  matchesSourceKeywords,
  collectionService,
} from '../src/modules/collection/service.js';
import { collectorRegistry } from '../src/modules/collection/registry.js';
import { sourcesService } from '../src/modules/sources/service.js';

const item = (id: string, title: string, body = 'Engineering details: implementation choices, performance measurements, failure handling and reproducible tests for this system.'): ContentItem => ({
  source_item_id: id,
  source_id: 'source',
  canonical_url: `https://example.com/${id}`,
  title,
  published_at: new Date().toISOString(),
  date_evidence: {verified:true},
  body: { value: body, format: 'html', completeness: 'full' },
  attachments: [],
  fetched_at: new Date().toISOString(),
  fetch_method: 'test',
  issues: [],
});
describe('Source-owned ingestion', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'openlore-source-test-'),
  );
  beforeAll(() => {
    process.env.OPENLORE_DATA_DIR = dataDir;
    initDatabase();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    getSqliteDatabase().close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  it('supports any/all, exclusions and unrestricted feeds', () => {
    expect(
      matchesSourceKeywords(
        item('1', 'Agent Engineering'),
        SourceOptionsSchema.parse({ keywords: ['agent', 'mcp'] }),
      ),
    ).toBe(true);
    expect(
      matchesSourceKeywords(
        item('1', 'Agent Engineering'),
        SourceOptionsSchema.parse({
          keywords: ['agent', 'mcp'],
          keyword_mode: 'all',
        }),
      ),
    ).toBe(false);
    expect(
      matchesSourceKeywords(
        item('1', 'Agent Engineering', '<p>MCP tools</p>'),
        SourceOptionsSchema.parse({
          keywords: ['agent', 'mcp'],
          keyword_mode: 'all',
        }),
      ),
    ).toBe(true);
    expect(
      matchesSourceKeywords(
        item('1', 'Agent advertising'),
        SourceOptionsSchema.parse({
          keywords: ['agent'],
          excluded_keywords: ['advertising'],
        }),
      ),
    ).toBe(false);
    expect(
      matchesSourceKeywords(
        item('1', 'Anything'),
        SourceOptionsSchema.parse({}),
      ),
    ).toBe(true);
    expect(
      SourceOptionsSchema.safeParse({ poll_interval_mins: 0 }).success,
    ).toBe(false);
  });
  it('filters before persistence and counts actual newly ingested articles', async () => {
    await sourcesService.saveSource({
      id: 'source',
      name: 'Source',
      url: 'https://example.com/feed',
      options: { poll_interval_mins: 15, keywords: ['agent'],keyword_policy:'strict' },
    });
    vi.spyOn(collectorRegistry, 'get').mockReturnValue({
      id: 'web_feed',
      supportedOperations: ['discover'],
      collect: async (request) => ({
        run_id: request.run_id,
        source_id: 'source',
        capability_id: 'web_feed',
        status: 'success',
        items: [item('1', 'Agent engineering'), item('2', 'Frontend CSS')],
        next_state: { etag: 'version' },
        scan: 'complete',
        errors: [],
        observed_at: new Date().toISOString(),
        stats: { requests: 1, items_observed: 2, items_returned: 2 },
      }),
    });
    const first = await collectionService.discoverSource('source');
    expect(first.stats).toMatchObject({
      items_new: 1,
      items_filtered: 1,
      items_returned: 2,
    });
    const second = await collectionService.discoverSource('source');
    expect(second.stats.items_new).toBe(0);
    expect(
      getSqliteDatabase()
        .prepare('SELECT count(*) AS count FROM articles')
        .get(),
    ).toEqual({ count: 1 });
    await sourcesService.saveSource({
      id: 'source',
      name: 'Renamed',
      url: 'https://example.com/feed',
    });
    expect(
      (await sourcesService.getSource('source'))?.options.poll_interval_mins,
    ).toBe(15);
    await sourcesService.saveSource({
      id: 'source',
      name: 'Renamed',
      url: 'https://example.com/feed',
      options: { keywords: ['css'] },
    });
    expect(
      getSqliteDatabase()
        .prepare('SELECT count(*) AS count FROM source_states')
        .get(),
    ).toEqual({ count: 0 });
  });
});
