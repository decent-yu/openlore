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
    "DELETE FROM article_assessments; DELETE FROM group_items; DELETE FROM research_tasks; DELETE FROM source_items; DELETE FROM articles; DELETE FROM groups; DELETE FROM ai_execution_logs;",
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
  db.prepare("UPDATE group_items SET scores_json=? WHERE id=?").run(
    '{"relevance":85,"quality":85}',
    "selected",
  );
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

function score(articleId: string, relevance: number, quality: number) {
  getSqliteDatabase()
    .prepare(
      "UPDATE group_items SET scores_json=?,updated_at=? WHERE article_id=?",
    )
    .run(
      JSON.stringify({ relevance, quality, overall: 999 }),
      "2026-10-19T03:00:00Z",
      articleId,
    );
}

it("splits unselected articles by effective scoring and keeps scores for selected and deep articles too", async () => {
  const db = getSqliteDatabase();
  db.prepare(
    "INSERT INTO groups(id,name,repository_connection_id,base_path) VALUES ('task','Agent 工程','repo','docs/agent')",
  ).run();
  score("excluded", 50, 60);
  score("deferred", 88, 90);
  score("selected", 95, 80);
  score("deep", 91, 93);
  db.prepare("INSERT INTO article_assessments VALUES (?,?,?,?,?)").run(
    "cached",
    "unselected",
    "task",
    JSON.stringify({
      relevance: 90.4,
      quality: 89.6,
      reason: "已完成审核，但流水线后续中断",
    }),
    "2026-10-19T03:01:00Z",
  );
  const all = await list();
  expect(all.filter_meta).toMatchObject({
    unreviewed_count: 2,
    scored_count: 4,
  });
  expect(ids(await list("status_filter=unreviewed"))).toEqual([
    "old",
    "tomorrow",
  ]);
  expect(ids(await list("status_filter=scored"))).toEqual([
    "deferred",
    "excluded",
    "selected",
    "unselected",
  ]);
  const cached = all.items.find((item) => item.id === "unselected")!;
  expect(cached.assessments).toEqual([
    {
      group_id: "task",
      group_name: "Agent 工程",
      relevance: 90,
      quality: 90,
      overall: 90,
      reason: "已完成审核，但流水线后续中断",
      assessed_at: "2026-10-19T03:01:00Z",
    },
  ]);
  expect(
    (await list("status_filter=scored")).items[0].assessments[0].overall,
  ).toBe(90.5);
  expect(
    (await list("status_filter=deep")).items.find((item) => item.id === "deep")
      ?.assessments[0].overall,
  ).toBe(91.6);
});

it("does not treat malformed, incomplete or failed calls as scored and accepts genuine zero scores", async () => {
  const db = getSqliteDatabase();
  for (const [key, article, raw] of [
    ["bad", "old", "not-json"],
    ["missing", "excluded", '{"relevance":80}'],
    ["wrong-type", "deferred", '{"relevance":"80","quality":90}'],
    ["infinite", "tomorrow", '{"relevance":1e999,"quality":90}'],
  ]) {
    db.prepare("INSERT INTO article_assessments VALUES (?,?,?,?,?)").run(
      key,
      article,
      "task",
      raw,
      "2026-10-19T03:00:00Z",
    );
  }
  db.prepare(
    "INSERT INTO ai_execution_logs(id,job_id,article_id,task_type,started_at,status,input_json) VALUES ('failed','job','unselected','assess','2026-10-19T03:00:00Z','failed','{}')",
  ).run();
  expect((await list()).filter_meta).toMatchObject({
    unreviewed_count: 5,
    scored_count: 1,
  });
  db.prepare("UPDATE group_items SET scores_json=? WHERE article_id=?").run(
    '{"relevance":0,"quality":0}',
    "excluded",
  );
  db.prepare("UPDATE group_items SET scores_json=? WHERE article_id=?").run(
    "invalid-json",
    "deferred",
  );
  const data = await list("status_filter=scored");
  expect(ids(data)).toEqual(["excluded", "selected"]);
  expect(
    data.items.find((item) => item.id === "excluded")!.assessments[0],
  ).toMatchObject({
    relevance: 0,
    quality: 0,
    overall: 0,
  });
});

it("keeps latest valid scores per pipeline separate and uses the pipeline scope consistently", async () => {
  const db = getSqliteDatabase();
  for (const [key, group, relevance, time] of [
    ["first", "task", 30, "2026-10-18T01:00:00Z"],
    ["second", "task", 80, "2026-10-19T01:00:00Z"],
    ["third", "other", 90, "2026-10-19T02:00:00Z"],
  ]) {
    db.prepare("INSERT INTO article_assessments VALUES (?,?,?,?,?)").run(
      key,
      "excluded",
      group,
      JSON.stringify({
        relevance: Number(relevance),
        quality: 70,
        reason: group,
      }),
      time,
    );
  }
  const all = await list("status_filter=scored");
  expect(
    all.items
      .find((item) => item.id === "excluded")!
      .assessments.map((a) => [a.group_id, a.relevance]),
  ).toEqual([
    ["other", 90],
    ["task", 80],
  ]);
  const scoped = await list("group_id=task&status_filter=scored");
  expect(ids(scoped)).toEqual(["excluded", "selected"]);
  expect(scoped.items[0].assessments).toHaveLength(1);
  expect(scoped.items[0].assessments[0].group_id).toBe("task");
  expect(scoped.filter_meta).toMatchObject({
    unreviewed_count: 1,
    scored_count: 2,
  });
});

it("combines review filters with date, source, interest and pagination without changing state totals", async () => {
  const db = getSqliteDatabase();
  db.prepare("INSERT INTO article_assessments VALUES (?,?,?,?,?)").run(
    "cache",
    "unselected",
    "task",
    '{"relevance":90,"quality":80}',
    "2026-10-19T03:00:00Z",
  );
  const data = await list(
    "time_range=today&source_id=source&status_filter=scored&interested_only=true&page_size=1",
  );
  expect(ids(data)).toEqual(["unselected"]);
  expect(data.pagination.total_count).toBe(1);
  expect(data.filter_meta).toMatchObject({
    unreviewed_count: 0,
    scored_count: 2,
    deep_count: 1,
  });
  expect(
    (await app.inject("/api/v1/library?status_filter=failed")).statusCode,
  ).toBe(400);
});
