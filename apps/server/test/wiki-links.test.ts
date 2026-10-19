import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { buildWikiUrl, WikiDisplayConfigSchema } from "@openlore/contracts";
import {
  initDatabase,
  getSqliteDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";
import { settingsService } from "../src/modules/settings/service.js";
import { groupsService } from "../src/modules/groups/service.js";
import { feedService } from "../src/modules/feed/service.js";
import { reportService } from "../src/modules/reports/service.js";
import {
  getPublishedWikiLinks,
  wikiLinkKey,
} from "../src/modules/delivery/wiki-links.js";
import { createServer } from "../src/http/server.js";
import { GitHubClient } from "../src/infrastructure/repositories/github/client.js";
import * as aiAdapters from "../src/infrastructure/ai/fallback_runner.js";
import { GenericWebhookSender } from "../src/infrastructure/notifications/generic_webhook/sender.js";
import { secretsStore } from "../src/infrastructure/secrets/local_file/secrets_store.js";

const base = "https://wiki.mua5201314.com/raven/openlore-knowledge-vault";
const directory = "20261015-02/01-deno-is-joining-cloudflare";
const prefix = `docs/agent-leaning/${directory}`;
const expected = `${base}/agent-leaning/${directory}`;
const wiki = { wiki_base_url: base, wiki_root_path: "docs" };
let app: Awaited<ReturnType<typeof createServer>>;

beforeAll(async () => {
  initDatabase();
  app = await createServer();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});
beforeEach(async () => {
  vi.spyOn(GitHubClient, "testConnection").mockResolvedValue({
    ok: true,
    defaultBranch: "main",
  });
  const db = getSqliteDatabase();
  db.exec(
    "DELETE FROM artifact_bundles; DELETE FROM deliveries; DELETE FROM article_locations; DELETE FROM collections; DELETE FROM research_tasks; DELETE FROM group_items; DELETE FROM runs; DELETE FROM groups; DELETE FROM repository_connections; DELETE FROM articles; DELETE FROM report_plans",
  );
  await settingsService.saveRepositoryConnection({
    id: "repo",
    owner: "raven",
    repo: "vault",
    wikiBaseUrl: base,
    wikiRootPath: "docs",
  });
  await groupsService.saveGroup({
    id: "task",
    name: "Task",
    repository_connection_id: "repo",
    base_path: "docs/agent-leaning",
  });
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO articles(id,title) VALUES ('article','Deno joins Cloudflare')",
  ).run();
  db.prepare(
    "INSERT INTO group_items(id,group_id,article_id,revision_hash,rules_revision,decision,is_deep_analyzed) VALUES ('item','task','article','rev','v1','selected',1)",
  ).run();
  db.prepare(
    "INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status,report_markdown) VALUES ('research','task','article','rev','succeeded','# Research')",
  ).run();
  db.prepare(
    "INSERT INTO collections(id,group_id,date_sequence) VALUES ('collection','task','20261015-02')",
  ).run();
  db.prepare(
    "INSERT INTO article_locations(id,group_id,article_id,collection_id,order_seq,slug,directory) VALUES ('loc','task','article','collection',1,'deno',?)",
  ).run(directory);
  db.prepare(
    "INSERT INTO artifact_bundles(id,group_id,run_id,collection_id,batch_id,snapshot_ref,kind,bundle_json) VALUES ('bundle','task','run','collection','batch','snapshot','collection',?)",
  ).run(
    JSON.stringify({
      files: [
        { path: `${prefix}/article.md` },
        { path: `${prefix}/research.md` },
      ],
    }),
  );
  db.prepare(
    "INSERT INTO deliveries(id,group_id,batch_id,target_kind,status,changed_paths_json) VALUES ('delivery','task','batch','github','updated',?)",
  ).run(JSON.stringify([`${prefix}/article.md`, `${prefix}/research.md`]));
  db.prepare(
    "INSERT INTO runs(id,group_id,snapshot_json,status,stage,started_at,finished_at,output_json) VALUES ('run','task','{}','succeeded','completed',?,?,?)",
  ).run(
    now,
    now,
    JSON.stringify({
      entries: [
        {
          article_id: "article",
          title: "Deno",
          summary: "Summary",
          is_deep_analyzed: true,
          document_url: "https://github.com/raven/vault/blob/main/article.md",
        },
      ],
    }),
  );
});

it("maps the requested repository paths to extension-free Wiki pages", () => {
  expect(buildWikiUrl(wiki, `${prefix}/research.md`)).toBe(
    `${expected}/research`,
  );
  expect(buildWikiUrl(wiki, `${prefix}/article.md`)).toBe(
    `${expected}/article`,
  );
  expect(
    buildWikiUrl(
      { wiki_base_url: `${base}/`, wiki_root_path: "/docs/" },
      `${prefix}/research.md`,
    ),
  ).toBe(`${expected}/research`);
  expect(
    buildWikiUrl(
      { wiki_base_url: base, wiki_root_path: "" },
      "目录/报告 #1.md",
    ),
  ).toBe(
    `${base}/${encodeURIComponent("目录")}/${encodeURIComponent("报告 #1")}`,
  );
});

it("rejects unsafe or out-of-scope paths and unsafe Wiki URLs", () => {
  for (const file of [
    "docs-other/a.md",
    "other/a.md",
    "docs/../a.md",
    "docs/a.png",
    "docs/a\\b.md",
  ])
    expect(buildWikiUrl(wiki, file)).toBeUndefined();
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/wiki",
    `${base}?token=x`,
    `${base}#anchor`,
    "https://user:pass@example.com/wiki",
  ]) {
    expect(
      WikiDisplayConfigSchema.safeParse({ ...wiki, wiki_base_url: url })
        .success,
    ).toBe(false);
  }
  expect(
    buildWikiUrl(
      { wiki_base_url: "", wiki_root_path: "docs" },
      `${prefix}/research.md`,
    ),
  ).toBeUndefined();
});

it("saves, lists, preserves omitted fields and explicitly clears Wiki configuration", async () => {
  const connection = vi
    .spyOn(GitHubClient, "testConnection")
    .mockResolvedValue({ ok: true, defaultBranch: "main" });
  const saved = await app.inject({
    method: "POST",
    url: "/api/v1/settings/connections/repository",
    payload: {
      id: "repo",
      owner: "raven",
      repo: "vault",
      token: "test-token",
      wikiBaseUrl: `${base}/`,
      wikiRootPath: "/docs/",
    },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject(wiki);
  expect((await settingsService.listRepositoryConnections())[0]).toMatchObject(
    wiki,
  );
  await settingsService.saveRepositoryConnection({
    id: "repo",
    owner: "raven",
    repo: "vault",
    name: "Renamed",
  });
  expect((await settingsService.listRepositoryConnections())[0]).toMatchObject(
    wiki,
  );
  await settingsService.saveRepositoryConnection({
    id: "repo",
    owner: "raven",
    repo: "vault",
    wikiBaseUrl: "",
    wikiRootPath: "",
  });
  expect(
    (await settingsService.listRepositoryConnections())[0].wiki_base_url,
  ).toBe("");
  expect(connection).toHaveBeenCalled();
});

it("rejects malformed configuration before writing or testing external credentials", async () => {
  const connection = vi.mocked(GitHubClient.testConnection).mockClear();
  for (const payload of [
    { wikiBaseUrl: "javascript:alert(1)" },
    { wikiRootPath: "../docs" },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/settings/connections/repository",
      payload: { id: "repo", owner: "raven", repo: "vault", ...payload },
    });
    expect(response.statusCode).toBe(400);
  }
  expect(connection).not.toHaveBeenCalled();
  expect((await settingsService.listRepositoryConnections())[0]).toMatchObject(
    wiki,
  );
});

it("resolves historical paths for feed, content pool and report summaries using current settings", async () => {
  const feed = await feedService.getDailyFeed("task");
  expect(feed.deep_articles[0]).toMatchObject({
    wiki_url: `${expected}/article`,
    research: { wiki_url: `${expected}/research` },
  });
  const library = (
    await app.inject({ method: "GET", url: "/api/v1/library" })
  ).json();
  expect(library.items[0]).toMatchObject({
    wiki_url: `${expected}/article`,
    research: { wiki_url: `${expected}/research` },
  });
  await reportService.savePlan({
    id: "report",
    name: "Report",
    enabled: false,
    pipeline_ids: ["task"],
  });
  const report = await reportService.preview("report");
  expect(report.articles[0].url).toBe(`${expected}/research`);
  expect(report.summary).toContain(`](${expected}/research)`);
  getSqliteDatabase()
    .prepare(
      "UPDATE repository_connections SET wiki_base_url='https://new.example/wiki' WHERE id='repo'",
    )
    .run();
  expect(
    (await feedService.getDailyFeed("task")).deep_articles[0].research
      ?.wiki_url,
  ).toBe(`https://new.example/wiki/agent-leaning/${directory}/research`);
});

it("does not expose an unacknowledged bundle or a failed standalone research publication", async () => {
  const db = getSqliteDatabase();
  db.prepare("UPDATE deliveries SET status='failed'").run();
  expect(getPublishedWikiLinks(["article"]).size).toBe(0);
  const library = (
    await app.inject({ method: "GET", url: "/api/v1/library" })
  ).json();
  expect(library.items[0].research.wiki_url).toBeUndefined();
  db.prepare(
    "INSERT INTO deliveries(id,group_id,batch_id,target_kind,status,changed_paths_json) VALUES ('standalone','task','research_research','github','updated',?)",
  ).run(JSON.stringify([`${prefix}/research.md`]));
  expect(
    getPublishedWikiLinks(["article"]).get(wikiLinkKey("task", "article")),
  ).toEqual({ research_url: `${expected}/research` });
});

it("maps completed historical research without standalone receipts and suppresses an explicitly failed upload", () => {
  const db = getSqliteDatabase();
  db.prepare(
    "UPDATE deliveries SET status='unchanged',changed_paths_json='[]'",
  ).run();
  expect(
    getPublishedWikiLinks(["article"]).get(wikiLinkKey("task", "article"))
      ?.research_url,
  ).toBe(`${expected}/research`);
  db.prepare("UPDATE artifact_bundles SET bundle_json=?").run(
    JSON.stringify({ files: [{ path: `${prefix}/article.md` }] }),
  );
  expect(
    getPublishedWikiLinks(["article"]).get(wikiLinkKey("task", "article")),
  ).toEqual({
    article_url: `${expected}/article`,
    research_url: `${expected}/research`,
  });
  db.prepare(
    "INSERT INTO deliveries(id,group_id,batch_id,target_kind,status) VALUES ('failed-report','task','research_research','github','failed')",
  ).run();
  expect(
    getPublishedWikiLinks(["article"]).get(wikiLinkKey("task", "article")),
  ).toEqual({ article_url: `${expected}/article` });
});

it("uses saved publication paths after the pipeline route changes, and respects the configured directory", () => {
  const db = getSqliteDatabase();
  db.prepare("UPDATE groups SET base_path='docs/new-topic'").run();
  expect(
    getPublishedWikiLinks(["article"]).get(wikiLinkKey("task", "article"))
      ?.research_url,
  ).toBe(`${expected}/research`);
  db.prepare("UPDATE repository_connections SET wiki_root_path='other'").run();
  expect(getPublishedWikiLinks(["article"]).size).toBe(0);
});

it("upgrades existing repository records without losing them, and initializes repeatedly", () => {
  const db = getSqliteDatabase();
  db.exec(
    "ALTER TABLE repository_connections DROP COLUMN wiki_base_url; ALTER TABLE repository_connections DROP COLUMN wiki_root_path",
  );
  initDatabase();
  initDatabase();
  expect(
    db
      .prepare(
        "SELECT owner,repo,wiki_base_url,wiki_root_path FROM repository_connections WHERE id='repo'",
      )
      .get(),
  ).toEqual({
    owner: "raven",
    repo: "vault",
    wiki_base_url: "",
    wiki_root_path: "",
  });
});

it("saves each plan template and rejects missing content or unknown variables", async () => {
  const template =
    "# {{report_name}} / {{date}}\n\n{{content}}\n\n共 {{article_count}} 篇。";
  const plan = await reportService.savePlan({
    id: "custom",
    name: "Wiki 日报",
    enabled: false,
    pipeline_ids: ["task"],
    template,
  });
  expect(plan.template).toBe(template);
  expect((await reportService.getPlan("custom")).template).toBe(template);
  expect((await reportService.preview("custom")).summary).toContain(
    `](${expected}/research)`,
  );
  for (const invalid of ["没有文章清单", "{{unknown}}\n{{content}}"]) {
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/reports/custom",
      payload: { ...plan, template: invalid },
    });
    expect(response.statusCode).toBe(400);
  }
  expect((await reportService.getPlan("custom")).template).toBe(template);
});

it("sends the exact Wiki template preview without touching AI, skills or Runner jobs", async () => {
  const db = getSqliteDatabase();
  db.prepare(
    "INSERT INTO notification_connections(id,name,revision,url_secret_ref) VALUES ('notify','Test channel','v1','test-webhook')",
  ).run();
  vi.spyOn(secretsStore, "getSecret").mockReturnValue(
    "https://example.com/webhook",
  );
  const ai = vi
    .spyOn(aiAdapters, "getAIAdapterWithFallback")
    .mockImplementation(() => {
      throw new Error("Reports must not use AI");
    });
  const sender = vi
    .spyOn(GenericWebhookSender, "send")
    .mockResolvedValue({ status: "sent" });
  await reportService.savePlan({
    id: "fixed",
    name: "Wiki 日报",
    enabled: true,
    pipeline_ids: ["task"],
    notification_connection_id: "notify",
    template: "# {{report_name}}\n\n{{content}}\n\n研报 {{deep_count}} 篇",
  });
  const preview = await reportService.preview("fixed");
  const aiCount = db
    .prepare("SELECT count(*) count FROM ai_execution_logs")
    .get();
  const jobCount = db.prepare("SELECT count(*) count FROM ai_jobs").get();
  expect((await reportService.send("fixed")).state).toBe("sent");
  expect(sender.mock.calls[0][1].summary).toBe(preview.summary);
  expect(sender.mock.calls[0][1].articles?.[0].url).toBe(
    `${expected}/research`,
  );
  expect(ai).not.toHaveBeenCalled();
  expect(
    db.prepare("SELECT count(*) count FROM ai_execution_logs").get(),
  ).toEqual(aiCount);
  expect(db.prepare("SELECT count(*) count FROM ai_jobs").get()).toEqual(
    jobCount,
  );
  const record = JSON.parse(
    (
      db
        .prepare(
          "SELECT response_json FROM deliveries WHERE target_kind='webhook'",
        )
        .get() as { response_json: string }
    ).response_json,
  );
  expect(record.summary).toBe(preview.summary);
  expect(record).not.toHaveProperty("ai_log_id");
  await reportService.send("fixed");
  expect(sender).toHaveBeenCalledTimes(1);
});
