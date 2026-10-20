import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { calendarDayBounds } from '../src/infrastructure/time/calendar.js';
import { getSqliteDatabase, initDatabase } from '../src/infrastructure/persistence/sqlite/db.js';
import { libraryRoutes } from '../src/http/routes/library.js';

describe('Workspace calendar days', () => {
  it.each([
    ['2026-10-15T18:00:00Z', 'Asia/Shanghai', '2026-10-15T16:00:00.000Z', '2026-10-16T16:00:00.000Z'],
    ['2026-10-16T12:00:00Z', 'UTC', '2026-10-16T00:00:00.000Z', '2026-10-17T00:00:00.000Z'],
    ['2026-03-08T12:00:00Z', 'America/New_York', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01T12:00:00Z', 'America/New_York', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ['2026-12-31T20:00:00Z', 'Asia/Kathmandu', '2026-12-31T18:15:00.000Z', '2027-01-01T18:15:00.000Z'],
  ])('finds the day containing %s in %s', (now, timezone, start, end) => {
    expect(calendarDayBounds(new Date(now), timezone)).toEqual({ start, end });
  });
});

describe('Library ingestion time filtering', () => {
  const app = Fastify();
  const previousDataDir = process.env.OPENLORE_DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlore-library-time-'));

  beforeAll(async () => {
    process.env.OPENLORE_DATA_DIR = dataDir;
    initDatabase();
    const db = getSqliteDatabase();
    db.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('timezone', 'Asia/Shanghai');
    const insert = db.prepare("INSERT INTO articles (id, title, created_at, published_at) VALUES (?, ?, ?, ?)");
    insert.run('yesterday', '昨天入库、今天发文', '2026-10-15T15:59:59.999Z', '2026-10-16T01:00:00Z');
    insert.run('midnight', '零点入库的旧文章', '2026-10-15T16:00:00.000Z', '2020-01-01T00:00:00Z');
    insert.run('morning', '凌晨入库', '2026-10-15T23:59:59.999Z', '2020-01-01T00:00:00Z');
    insert.run('daytime', '上午入库', '2026-10-16T03:00:00.000Z', '2020-01-01T00:00:00Z');
    insert.run('tomorrow', '次日零点入库', '2026-10-16T16:00:00.000Z', '2020-01-01T00:00:00Z');
    await app.register(libraryRoutes);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T04:00:00Z'));
  });

  afterAll(async () => {
    vi.useRealTimers();
    await app.close();
    getSqliteDatabase().close();
    if (previousDataDir === undefined) delete process.env.OPENLORE_DATA_DIR;
    else process.env.OPENLORE_DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('counts and lists local-day arrivals regardless of publication date', async () => {
    const response = await app.inject('/library?quality_filter=all&time_range=today');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.filter_meta.today_count).toBe(3);
    expect(body.pagination.total_count).toBe(3);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['daytime', 'morning', 'midnight']);
  });

  it('lists the pool directly and never lists backend candidates', async () => {
    const db=getSqliteDatabase();
    db.prepare("INSERT INTO collection_candidates(source_id,item_id,article_id,item_json,rule_revision,status,updated_at) VALUES ('s','hidden','not-an-article','{}','v','pending',?)").run(new Date().toISOString());
    const response=await app.inject('/library');
    expect(response.json().pagination.total_count).toBe(5);
    expect(response.json().items[0].id).toBe('yesterday');
    expect(response.json().items.some((item:any)=>item.id==='not-an-article')).toBe(false);
    expect(response.json().filter_meta).not.toHaveProperty('quality_counts');
  });

  it('filters repository studies separately and never classifies them as unreviewed articles', async () => {
    const db = getSqliteDatabase();
    db.prepare("INSERT INTO articles(id,title,created_at,published_at,date_evidence_json) VALUES ('repository','Orca study',?,?,?)").run('2026-10-16T03:00:00Z','2026-10-16T03:00:00Z',JSON.stringify({repository_study:{repository_url:'https://github.com/stablyai/orca'}}));
    try {
      const repositories = (await app.inject('/library?task_type=repository_research')).json();
      expect(repositories.items.map((item:any)=>item.id)).toEqual(['repository']);
      expect(repositories.items[0].published_at).toBeNull();
      expect(repositories.filter_meta.total_count).toBe(1);
      expect(repositories.filter_meta.unreviewed_count).toBe(0);
      const rejected = await app.inject({method:'POST',url:'/library/review',payload:{article_ids:['repository']}});
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().message).toContain('无需初审');
      const articles = (await app.inject('/library?task_type=article_research')).json();
      expect(articles.pagination.total_count).toBe(5);
      expect(articles.items.some((item:any)=>item.id==='repository')).toBe(false);
      const unreviewed = (await app.inject('/library?status_filter=unreviewed')).json();
      expect(unreviewed.items.some((item:any)=>item.id==='repository')).toBe(false);
      const page = (await app.inject('/library?task_type=repository_research&page_size=1&page=2')).json();
      expect(page.items).toHaveLength(0);
      expect(page.pagination.total_count).toBe(1);
    } finally { db.prepare("DELETE FROM articles WHERE id='repository'").run(); }
  });

  it('uses the current workspace timezone for both count and results', async () => {
    getSqliteDatabase().prepare("UPDATE workspace_settings SET value = 'UTC' WHERE key = 'timezone'").run();
    const response = await app.inject('/library?quality_filter=all&time_range=today');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.filter_meta.today_count).toBe(2);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['tomorrow', 'daytime']);
  });

  it('filters articles by source_id', async () => {
    const db = getSqliteDatabase();
    db.prepare("INSERT INTO source_items (id, source_id, article_id) VALUES ('si_1', 'source_a', 'daytime')").run();
    db.prepare("INSERT INTO source_items (id, source_id, article_id) VALUES ('si_2', 'source_b', 'morning')").run();

    const response = await app.inject('/library?quality_filter=all&source_id=source_a');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items.map((i: any) => i.id)).toEqual(['daytime']);
    expect(body.filter_meta.total_count).toBe(1);
  });
});
