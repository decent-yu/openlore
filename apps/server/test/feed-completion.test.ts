import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import {
  initDatabase,
  getSqliteDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";
import { groupsService } from "../src/modules/groups/service.js";
import { feedService } from "../src/modules/feed/service.js";
let db: ReturnType<typeof getSqliteDatabase>;
beforeAll(async () => {
  initDatabase();
  db = getSqliteDatabase();
  await groupsService.saveGroup({
    id: "task",
    name: "Task",
    repository_connection_id: "repo",
    base_path: "docs/task",
    source_ids: ["source"],
    deep_analysis_count: 1,
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T04:00:00Z"));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  db.exec(
    "DELETE FROM articles;DELETE FROM group_items;DELETE FROM research_tasks;DELETE FROM runs;DELETE FROM source_items;DELETE FROM deliveries;DELETE FROM artifact_bundles;DELETE FROM article_reviews",
  );
  db.prepare("DELETE FROM groups WHERE id <> 'task'").run();
});
function report(id: string, article: string, archived: string | null) {
  db.prepare("INSERT OR IGNORE INTO articles(id,title) VALUES (?,?)").run(
    article,
    `Article ${article}`,
  );
  db.prepare(
    "INSERT OR IGNORE INTO source_items(id,source_id,article_id) VALUES (?,'source',?)",
  ).run(article, article);
  db.prepare(
    "INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status,report_markdown,archived_at) VALUES (?,'task',?,'rev','succeeded',?,?)",
  ).run(id, article, `# Report ${id}`, archived);
}
it("shows progress but only publishes completed archived research on the workspace archive day", async () => {
  report("report", "article", null);
  db.prepare(
    "INSERT INTO runs(id,group_id,snapshot_json,status,stage) VALUES ('run','task','{}','running','delivery')",
  ).run();
  const pending = await feedService.getDailyFeed("task");
  expect(pending.current_run?.stage).toBe("delivery");
  expect(pending.deep_articles).toEqual([]);
  expect(pending).not.toHaveProperty("candidate_articles");
  db.prepare(
    "UPDATE research_tasks SET archived_at='2026-10-18T17:00:00Z'",
  ).run();
  const feed = await feedService.getDailyFeed("task");
  expect(feed.date).toBe("2026-10-19");
  expect(feed.deep_articles[0].research?.report_markdown).toBe(
    "# Report report",
  );
  expect(
    (await feedService.getDailyFeed("task", "2026-10-18")).deep_articles,
  ).toHaveLength(0);
});
it("does not cap published results by the per-run research quota", async () => {
  report("first", "one", "2026-10-19T01:00:00Z");
  report("second", "two", "2026-10-19T02:00:00Z");
  const feed = await feedService.getDailyFeed("task");
  expect(feed.deep_articles).toHaveLength(2);
  expect(feed.stats.deep_analyzed_count).toBe(2);
});
it("includes the original publication time and deduplicated collection source names", async () => {
  report("report", "article", "2026-10-19T01:00:00Z");
  db.exec(`INSERT INTO sources(id,name,url) VALUES
    ('source','Cloudflare Blog','https://blog.cloudflare.com'),
    ('other-source','Other feed','https://example.com/feed');
    UPDATE articles SET published_at='2026-10-18T19:00:00Z' WHERE id='article';
    INSERT INTO source_items(id,source_id,article_id) VALUES
    ('duplicate','source','article'),('other','other-source','article')`);
  const article = (await feedService.getDailyFeed()).deep_articles[0];
  expect(article.published_at).toBe("2026-10-18T19:00:00Z");
  expect(article.sources).toEqual([
    { id: "source", name: "Cloudflare Blog" },
    { id: "other-source", name: "Other feed" },
  ]);
});
it("keeps the archive date even if source metadata or scoring is updated later", async () => {
  report("report", "article", "2026-10-18T17:00:00Z");
  db.prepare("UPDATE articles SET updated_at='2026-10-21T00:00:00Z'").run();
  expect(
    (await feedService.getDailyFeed("task", "2026-10-19")).deep_articles,
  ).toHaveLength(1);
  expect(
    (await feedService.getDailyFeed("task", "2026-10-21")).deep_articles,
  ).toHaveLength(0);
});
it("shows one latest archived report per article while excluding newer unarchived output", async () => {
  report("first", "article", "2026-10-19T01:00:00Z");
  report("second", "article", "2026-10-19T02:00:00Z");
  report("unpublished", "article", null);
  const feed = await feedService.getDailyFeed("task");
  expect(feed.deep_articles).toHaveLength(1);
  expect(feed.deep_articles[0].research?.id).toBe("second");
});

it("defaults to all tasks, counts shared pool articles once, and retains task-specific reports and dates", async () => {
  await groupsService.saveGroup({
    id: "other",
    name: "Other task",
    repository_connection_id: "repo",
    base_path: "docs/other",
    source_ids: ["source"],
    deep_analysis_count: 1,
  });
  report("first", "shared", "2026-10-19T01:00:00Z");
  report("second", "shared", "2026-10-19T02:00:00Z");
  report("older", "older", "2026-10-18T02:00:00Z");
  report("pending", "pending", null);
  db.prepare(
    "UPDATE research_tasks SET group_id='other' WHERE id IN ('second','older','pending')",
  ).run();
  db.exec(`INSERT INTO runs(id,group_id,snapshot_json,status,stage,started_at)
    VALUES ('active','other','{}','running','research','2026-10-19T00:00:00Z'),
           ('finished','task','{}','succeeded','completed','2026-10-19T03:00:00Z')`);

  const feed = await feedService.getDailyFeed();
  expect(feed.group).toBeNull();
  expect(feed.groups).toHaveLength(2);
  expect(feed.current_run?.id).toBe("active");
  expect(
    feed.deep_articles.map((article) => [
      article.group_id,
      article.research?.id,
    ]),
  ).toEqual([
    ["other", "second"],
    ["task", "first"],
  ]);
  expect(feed.stats.pool_count).toBe(3);
  expect(feed.stats.deep_analyzed_count).toBe(2);
  expect(feed.available_dates).toEqual(["2026-10-19", "2026-10-18"]);
  expect(
    (await feedService.getDailyFeed(undefined, "2026-10-18")).deep_articles[0]
      .group_id,
  ).toBe("other");

  const scoped = await feedService.getDailyFeed("other");
  expect(scoped.group?.id).toBe("other");
  expect(scoped.deep_articles.map((article) => article.research?.id)).toEqual([
    "second",
  ]);
  expect(
    (await feedService.getDailyFeed("task")).deep_articles.map(
      (article) => article.research?.id,
    ),
  ).toEqual(["first"]);
});

it("includes an unfiltered task's entire content pool in the overview", async () => {
  await groupsService.saveGroup({
    id: "unfiltered",
    name: "All sources",
    repository_connection_id: "repo",
    base_path: "docs/all",
    source_ids: [],
    deep_analysis_count: 1,
  });
  db.prepare(
    "INSERT INTO articles(id,title) VALUES ('unassigned','Unassigned')",
  ).run();
  expect((await feedService.getDailyFeed()).stats.pool_count).toBe(1);
  expect((await feedService.getDailyFeed("task")).stats.pool_count).toBe(0);
});
