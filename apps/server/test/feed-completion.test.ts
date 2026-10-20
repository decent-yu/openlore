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
  db.prepare("INSERT OR IGNORE INTO sources(id,name,url) VALUES ('source','Source','https://example.com/feed')").run();
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
