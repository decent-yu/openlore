import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { LibraryResponseSchema } from "@openlore/contracts";
import { createServer } from "../src/http/server.js";
import {
  initDatabase,
  getSqliteDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";

let app: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => {
  initDatabase();
  app = await createServer();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T04:00:00Z"));
});
afterAll(async () => {
  vi.useRealTimers();
  await app.close();
});
beforeEach(() => {
  const db = getSqliteDatabase();
  db.exec(
    "DELETE FROM article_reviews; DELETE FROM group_items; DELETE FROM research_tasks; DELETE FROM source_items; DELETE FROM articles; DELETE FROM groups; DELETE FROM ai_execution_logs;",
  );
  db.prepare(
    "INSERT OR REPLACE INTO workspace_settings(key,value) VALUES ('timezone','Asia/Shanghai')",
  ).run();
  const add = db.prepare(
    "INSERT INTO articles(id,title,created_at,published_at,user_interested) VALUES (?,?,?,?,?)",
  );
  add.run(
    "unselected",
    "Unselected",
    "2026-10-18T16:00:00Z",
    "2026-10-17T01:00:00Z",
    1,
  );
  add.run(
    "selected",
    "Selected",
    "2026-10-19T02:00:00Z",
    "2026-10-19T01:00:00Z",
    0,
  );
  add.run("deep", "Deep", "2026-10-19T03:00:00Z", "2026-10-18T16:00:00Z", 1);
  add.run(
    "research-only",
    "Independent research",
    "2026-10-18T00:00:00Z",
    "2026-10-19T02:00:00Z",
    0,
  );
  add.run(
    "excluded",
    "Excluded",
    "2026-10-18T01:00:00Z",
    "2026-10-01T00:00:00Z",
    0,
  );
  add.run("deferred", "Deferred", "2026-10-17T00:00:00Z", null, 0);
  add.run("old", "Old", "2026-10-15T00:00:00Z", "2026-10-01T00:00:00Z", 0);
  add.run(
    "tomorrow",
    "Tomorrow",
    "2026-10-19T16:00:00Z",
    "2026-10-19T16:00:00Z",
    0,
  );
  const mark = db.prepare(
    "INSERT INTO group_items(id,group_id,article_id,revision_hash,rules_revision,decision,is_deep_analyzed) VALUES (?,'task',?,'rev','v1',?,?)",
  );
  mark.run("selected", "selected", "qualified", 0);
  score("selected", 85);
  mark.run("deep", "deep", "selected", 1);
  mark.run("excluded", "excluded", "excluded", 0);
  mark.run("deferred", "deferred", "deferred", 0);
  db.prepare(
    "INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status,archived_at) VALUES ('research','task','research-only','rev','succeeded','2026-10-19T03:00:00Z')",
  ).run();
  db.prepare(
    "INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status,archived_at) VALUES ('deep','task','deep','rev','succeeded','2026-10-19T03:00:00Z')",
  ).run();
  for (const id of ["unselected", "selected", "deep"])
    db.prepare(
      "INSERT INTO source_items(id,source_id,article_id) VALUES (?,'source',?)",
    ).run(id, id);
});
async function list(query = "") {
  const response = await app.inject(
    `/api/v1/library${query ? "?" + query : ""}`,
  );
  expect(response.statusCode).toBe(200);
  return LibraryResponseSchema.parse(response.json());
}
const ids = (data: Awaited<ReturnType<typeof list>>) =>
  data.items.map((item) => item.id).sort();

it("partitions all articles into unselected, selected without research, and completed deep analysis", async () => {
  const all = await list();
  expect(all.filter_meta).toMatchObject({
    total_count: 8,
    scored_count: 1,
    deep_count: 2,
    interested_count: 2,
  });
  expect(ids(await list("status_filter=unreviewed"))).toEqual([
    "deferred",
    "excluded",
    "old",
    "tomorrow",
    "unselected",
  ]);
  expect(ids(await list("status_filter=scored"))).toEqual(["selected"]);
  expect(ids(await list("status_filter=deep"))).toEqual([
    "deep",
    "research-only",
  ]);
  expect(all.items.find((item) => item.id === "deep")).toMatchObject({
    is_deep_analyzed: true,
  });
});

it("intersects the independent interest flag with every article state", async () => {
  expect(ids(await list("interested_only=true"))).toEqual([
    "deep",
    "unselected",
  ]);
  expect(ids(await list("interested_only=true&status_filter=deep"))).toEqual([
    "deep",
  ]);
  expect(
    ids(await list("interested_only=true&status_filter=unreviewed")),
  ).toEqual(["unselected"]);
  expect(ids(await list("interested_only=true&status_filter=scored"))).toEqual(
    [],
  );
});

it("filters discovery and publication independently and combines them by intersection", async () => {
  expect(ids(await list("time_range=today"))).toEqual([
    "deep",
    "selected",
    "unselected",
  ]);
  expect(ids(await list("published_range=today"))).toEqual([
    "deep",
    "research-only",
    "selected",
  ]);
  expect(ids(await list("time_range=today&published_range=today"))).toEqual([
    "deep",
    "selected",
  ]);
  expect(ids(await list("time_range=3days"))).toEqual([
    "deep",
    "deferred",
    "excluded",
    "research-only",
    "selected",
    "unselected",
  ]);
  expect(ids(await list("published_range=3days"))).toEqual([
    "deep",
    "research-only",
    "selected",
    "unselected",
  ]);
});

it("includes both selected date endpoints and supports a single local calendar day", async () => {
  expect(
    ids(
      await list(
        "time_range=custom&discovered_from=2026-10-18&discovered_to=2026-10-19",
      ),
    ),
  ).toEqual(["deep", "excluded", "research-only", "selected", "unselected"]);
  expect(
    ids(
      await list(
        "time_range=custom&discovered_from=2026-10-19&discovered_to=2026-10-19",
      ),
    ),
  ).toEqual(["deep", "selected", "unselected"]);
  expect(
    ids(
      await list(
        "published_range=custom&published_from=2026-10-01&published_to=2026-10-01",
      ),
    ),
  ).toEqual(["excluded", "old"]);
  expect(
    ids(
      await list(
        "time_range=custom&discovered_from=2026-10-19&discovered_to=2026-10-19&published_range=custom&published_from=2026-10-17&published_to=2026-10-17",
      ),
    ),
  ).toEqual(["unselected"]);
});

it("computes state counters within the active date scope and preserves pagination totals", async () => {
  const data = await list("time_range=today&status_filter=deep&page_size=1");
  expect(data.filter_meta).toMatchObject({
    scored_count: 1,
    deep_count: 1,
  });
  expect(data.pagination).toMatchObject({ total_count: 1, total_pages: 1 });
  expect(ids(data)).toEqual(["deep"]);
});

it("intersects source, group and search scopes for both counts and results", async () => {
  const data = await list("source_id=source&group_id=task");
  expect(ids(data)).toEqual(["deep", "selected"]);
  expect(data.filter_meta).toMatchObject({
    total_count: 2,
    scored_count: 1,
    deep_count: 1,
  });
  expect(ids(await list("source_id=source&search=Deep"))).toEqual(["deep"]);
});

it("handles selected local dates across DST transitions without losing edge records", async () => {
  const db = getSqliteDatabase();
  db.prepare(
    "UPDATE workspace_settings SET value='America/New_York' WHERE key='timezone'",
  ).run();
  db.exec("DELETE FROM articles");
  for (const [id, date] of [
    ["before", "2026-03-08T04:59:59.999Z"],
    ["start", "2026-03-08T05:00:00Z"],
    ["end", "2026-03-09T03:59:59.999Z"],
    ["after", "2026-03-09T04:00:00Z"],
  ]) {
    db.prepare(
      "INSERT INTO articles(id,title,created_at,published_at) VALUES (?,?,?,?)",
    ).run(id, id, date, date);
  }
  const query =
    "time_range=custom&discovered_from=2026-03-08&discovered_to=2026-03-08";
  expect(ids(await list(query))).toEqual(["end", "start"]);
  expect(
    ids(
      await list(
        "published_range=custom&published_from=2026-03-08&published_to=2026-03-08",
      ),
    ),
  ).toEqual(["end", "start"]);
});

it("rejects invalid enums, malformed dates, reversed and incomplete ranges", async () => {
  for (const query of [
    "time_range=published7",
    "status_filter=interested",
    "interested_only=yes",
    "time_range=custom",
    "time_range=custom&discovered_from=2026-02-30&discovered_to=2026-03-01",
    "time_range=custom&discovered_from=2026-10-20&discovered_to=2026-10-19",
    "published_range=custom&published_from=2026-10-19",
    "published_range=custom&published_from=2026-10-20&published_to=2026-10-19",
  ])
    expect((await app.inject(`/api/v1/library?${query}`)).statusCode).toBe(400);
});

function score(articleId: string, quality: number) {
  const db = getSqliteDatabase();
  db.prepare("UPDATE articles SET latest_revision='rev' WHERE id=?").run(articleId);
  db.prepare("INSERT OR REPLACE INTO article_reviews(article_id,revision_hash,status,result_json,created_at,assessed_at) VALUES (?,'rev','succeeded',?,?,?)")
    .run(articleId, JSON.stringify({quality, positioning: '工程知识', summary: '问题、方法与结论', tags: ['工程'], reason: '原文证据充分', evidence_refs: ['A verifiable sentence from the original content.']}), '2026-10-19T03:00:00Z', '2026-10-19T03:00:00Z');
}

it("shares one content assessment independently of task selection and preserves zero scores", async () => {
  score('excluded', 0); score('deferred', 90); score('deep', 93); score('unselected', 89);
  const all = await list();
  expect(all.filter_meta).toMatchObject({unreviewed_count: 2, scored_count: 4, deep_count: 2});
  expect(ids(await list('status_filter=scored'))).toEqual(['deferred', 'excluded', 'selected', 'unselected']);
  const zero = all.items.find(item => item.id === 'excluded')!;
  expect(zero.review?.result?.quality).toBe(0);
  expect(zero).not.toHaveProperty('assessments');
  expect((await list('group_id=task')).items.find(item => item.id === 'excluded')?.review).toEqual(zero.review);
  expect(all.items.find(item => item.id === 'deep')?.review?.result?.quality).toBe(93);
});

it("only uses the current body revision and does not count queued, failed or running reviews as scored", async () => {
  const db = getSqliteDatabase();
  score('old', 95);
  db.prepare("UPDATE articles SET latest_revision='new-revision' WHERE id='old'").run();
  for (const [id, status] of [['excluded', 'failed'], ['deferred', 'running'], ['tomorrow', 'queued']]) {
    db.prepare("UPDATE articles SET latest_revision='rev' WHERE id=?").run(id);
    db.prepare("INSERT INTO article_reviews(article_id,revision_hash,status,created_at) VALUES (?,'rev',?,'2026-10-19T03:00:00Z')").run(id, status);
  }
  expect(ids(await list('status_filter=scored'))).toEqual(['selected']);
  expect((await list()).items.find(item => item.id === 'old')?.review).toBeNull();
});

it("combines shared reviews with dates, source, interest and pagination", async () => {
  score('unselected', 80);
  const data = await list('time_range=today&source_id=source&status_filter=scored&interested_only=true&page_size=1');
  expect(ids(data)).toEqual(['unselected']);
  expect(data.pagination.total_count).toBe(1);
  expect(data.filter_meta).toMatchObject({unreviewed_count: 0, scored_count: 2, deep_count: 1});
});
