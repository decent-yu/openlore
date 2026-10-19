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
    "DELETE FROM group_items; DELETE FROM research_tasks; DELETE FROM source_items; DELETE FROM articles;",
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
  mark.run("selected", "selected", "selected", 0);
  mark.run("deep", "deep", "selected", 1);
  mark.run("excluded", "excluded", "excluded", 0);
  mark.run("deferred", "deferred", "deferred", 0);
  db.prepare(
    "INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status) VALUES ('research','task','research-only','rev','succeeded')",
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
    unselected_count: 5,
    selected_count: 1,
    deep_count: 2,
    interested_count: 2,
  });
  expect(ids(await list("status_filter=unselected"))).toEqual([
    "deferred",
    "excluded",
    "old",
    "tomorrow",
    "unselected",
  ]);
  expect(ids(await list("status_filter=selected"))).toEqual(["selected"]);
  expect(ids(await list("status_filter=deep"))).toEqual([
    "deep",
    "research-only",
  ]);
  expect(all.items.find((item) => item.id === "deep")).toMatchObject({
    is_selected: false,
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
    ids(await list("interested_only=true&status_filter=unselected")),
  ).toEqual(["unselected"]);
  expect(
    ids(await list("interested_only=true&status_filter=selected")),
  ).toEqual([]);
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
    unselected_count: 1,
    selected_count: 1,
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
    unselected_count: 0,
    selected_count: 1,
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
