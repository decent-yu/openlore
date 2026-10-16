import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SourceOptionsSchema, type ContentItem } from "@openlore/contracts";
import {
  evaluateContent,
  matchesSourceKeywords,
  normalizeUrl,
  publicationIssue,
} from "../src/modules/collection/quality.js";
import {
  getSqliteDatabase,
  initDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";
import { collectionService } from "../src/modules/collection/service.js";
import { collectorRegistry } from "../src/modules/collection/registry.js";
import { sourcesService } from "../src/modules/sources/service.js";
import { WebFeedCollectorAdapter } from "../src/modules/collection/collectors/web_feed/adapter.js";
import { SafeHttpClient } from "../src/infrastructure/http/client.js";
import { pythonWorkerRunner } from "../src/infrastructure/python/runner.js";

const now = new Date("2026-10-16T04:00:00Z");
const body =
  "We implement a model router in the agent harness. The benchmark compares error rates, execution cost and retries under identical workloads.";
const make = (i: number): ContentItem => ({
  source_id: "source",
  source_item_id: `source:${i}`,
  canonical_url: `https://example.com/${i}`,
  title: `Agent harness ${i}`,
  published_at: "2026-10-15T00:00:00Z",
  body: { value: body, format: "text", completeness: "full" },
  date_evidence: { verified: true },
  fetched_at: now.toISOString(),
  fetch_method: "web_page",
  issues: [],
  attachments: [],
});

describe("Quality admission", () => {
  const options = SourceOptionsSchema.parse({ keywords: ["agent"] });
  it("rejects historical/future dates and uses the workspace year at New Year", () => {
    expect(
      evaluateContent(
        { ...make(1), published_at: "2020-01-01" },
        options,
        "Asia/Shanghai",
        now,
      ).status,
    ).toBe("history");
    expect(publicationIssue("2026-10-17", options, "Asia/Shanghai", now)).toBe(
      "future_date",
    );
    expect(
      publicationIssue(
        "2025-12-31T18:00:00Z",
        options,
        "Asia/Shanghai",
        new Date("2026-01-01T01:00:00Z"),
      ),
    ).toBeNull();
    expect(
      publicationIssue(
        "2025-12-31T15:00:00Z",
        options,
        "Asia/Shanghai",
        new Date("2026-01-01T01:00:00Z"),
      ),
    ).toBe("previous_year");
    expect(
      evaluateContent({ ...make(1), published_at: null }, options, "UTC", now)
        .status,
    ).toBe("review");
  });
  it("matches concepts at word boundaries and rescues concrete engineering subjects", () => {
    const neutral = {
      ...make(1),
      title: "How to build a model router in the harness",
      body: {
        value:
          "Model routing implementation with measurements and reproducible experiments.".repeat(
            2,
          ),
        format: "text" as const,
        completeness: "full" as const,
      },
    };
    expect(
      matchesSourceKeywords(
        { ...neutral, title: "reagent chemistry" },
        options,
      ),
    ).toBe(false);
    expect(
      matchesSourceKeywords(
        { ...neutral, title: "Agentic evaluation" },
        options,
      ),
    ).toBe(true);
    expect(evaluateContent(neutral, options, "UTC", now).status).toBe("ready");
    expect(
      evaluateContent(
        neutral,
        { ...options, keyword_policy: "strict" },
        "UTC",
        now,
      ).status,
    ).toBe("excluded");
    expect(
      matchesSourceKeywords(
        { ...neutral, title: "Agent evals" },
        SourceOptionsSchema.parse({ keywords: ["evaluation"] }),
      ),
    ).toBe(true);
  });
  it("does not admit empty pages, conflicting dates or company announcements", () => {
    expect(
      evaluateContent(
        {
          ...make(1),
          body: { value: "", format: "text", completeness: "empty" },
        },
        options,
        "UTC",
        now,
      ).status,
    ).toBe("pending");
    expect(
      evaluateContent(
        { ...make(1), date_evidence: { verified: false, conflict: true } },
        options,
        "UTC",
        now,
      ).status,
    ).toBe("review");
    expect(
      evaluateContent(
        { ...make(1), categories: ["Company"] },
        options,
        "UTC",
        now,
      ).reason,
    ).toBe("excluded_category");
    expect(
      normalizeUrl("https://example.com/post/?utm_source=rss&version=2#top"),
    ).toBe("https://example.com/post?version=2");
  });
});

describe("Durable discovery and enrichment", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openlore-quality-"));
  beforeAll(() => {
    process.env.OPENLORE_DATA_DIR = dir;
    initDatabase();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    getSqliteDatabase().close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("honors feed limits and resumes saved entries without a second HTTP request", async () => {
    const http = vi
      .spyOn(SafeHttpClient, "fetch")
      .mockResolvedValue({
        status: 200,
        headers: { etag: "one" },
        data: Buffer.from("<rss/>"),
        text: "<rss/>",
        url: "https://example.com/rss",
        notModified: false,
      });
    const parser = vi
      .spyOn(pythonWorkerRunner, "run")
      .mockResolvedValue({
        protocol_version: 1,
        job_id: "page",
        status: "success",
        data: {
          entries: Array.from({ length: 105 }, (_, i) => ({
            native_id: String(i),
            link: `https://example.com/${i}`,
            published_at: "2026-10-15T00:00:00Z",
            body: { value: body, format: "text", completeness: "summary" },
          })),
        },
      } as any);
    const adapter = new WebFeedCollectorAdapter();
    const request = {
      run_id: "page",
      source_id: "source",
      source_revision: "v1",
      capability_id: "web_feed",
      operation: "discover" as const,
      target: { url: "https://example.com/rss" },
      scope: { limit: 100 },
      options: {},
      budget: { timeout_seconds: 10, max_requests: 1 },
    };
    const first = await adapter.collect(request);
    expect(first.items).toHaveLength(100);
    expect(first.scan).toBe("more");
    const second = await new WebFeedCollectorAdapter().collect({
      ...request,
      state: first.next_state,
    });
    expect(second.items).toHaveLength(5);
    expect(second.scan).toBe("complete");
    expect(
      new Set([...first.items, ...second.items].map((i) => i.source_item_id))
        .size,
    ).toBe(105);
    expect(http).toHaveBeenCalledTimes(1);
    http.mockRestore();
    parser.mockRestore();
  });
  it("drains pending work after 304, corrects dates, retains failed work and never downgrades full text", async () => {
    await sourcesService.saveSource({
      id: "source",
      name: "Source",
      url: "https://example.com/rss",
      options: { keywords: ["agent"] },
    });
    let polls = 0;
    const entries = Array.from({ length: 12 }, (_, i) => ({
      ...make(i),
      date_evidence: { verified: false },
      fetch_method: "web_feed",
      body: {
        value: "Agent summary",
        format: "text" as const,
        completeness: "summary" as const,
      },
    }));
    vi.spyOn(collectorRegistry, "get").mockImplementation((id) =>
      id === "web_feed"
        ? {
            id,
            supportedOperations: ["discover"],
            collect: async (request) => ({
              run_id: request.run_id,
              source_id: "source",
              capability_id: id,
              status: polls++ === 0 ? "success" : "not_modified",
              items: polls === 1 ? entries : [],
              scan: "complete",
              next_state: { etag: "one" },
              errors: [],
              observed_at: now.toISOString(),
              stats: {
                requests: 1,
                items_observed: polls === 1 ? 12 : 0,
                items_returned: polls === 1 ? 12 : 0,
              },
            }),
          }
        : ({
            id: "web_page",
            supportedOperations: ["fetch"],
            collect: async (request) => {
              const index = Number(request.target.url.split("/").pop());
              return {
                run_id: request.run_id,
                source_id: "source",
                capability_id: "web_page",
                status: "success",
                items: [
                  {
                    ...make(index),
                    published_at:
                      index === 0
                        ? "2023-05-10T00:00:00Z"
                        : make(index).published_at,
                  },
                ],
                scan: "complete",
                errors: [],
                observed_at: now.toISOString(),
                stats: { requests: 1, items_observed: 1, items_returned: 1 },
              };
            },
          } as any),
    );
    const first = await collectionService.discoverSource("source");
    expect(first.stats.queued).toBe(3);
    expect(first.stats.requests).toBe(10);
    const second = await collectionService.discoverSource("source");
    expect(second.stats.queued).toBe(0);
    const db = getSqliteDatabase();
    expect(
      db
        .prepare("SELECT count(*) n FROM articles")
        .get(),
    ).toEqual({ n: 11 });
    const old = db
      .prepare(
        "SELECT * FROM articles WHERE canonical_url='https://example.com/0'",
      )
      .get() as any;
    expect(old).toBeUndefined();
    const rejected=db.prepare("SELECT status,item_json FROM collection_candidates WHERE item_id='source:0'").get() as any;
    expect(rejected.status).toBe('history');
    expect(JSON.parse(rejected.item_json).body.value).toBe('');
    expect(db.prepare('SELECT count(*) n FROM article_revisions').get()).toEqual({n:11});
    const full = db
      .prepare(
        "SELECT * FROM articles WHERE canonical_url='https://example.com/1'",
      )
      .get() as any;
    await collectionService.persistContentItem({
      ...entries[1],
      published_at: "2026-10-16T00:00:00Z",
    });
    const retained = db
      .prepare("SELECT * FROM articles WHERE id=?")
      .get(full.id) as any;
    expect(retained.latest_revision).toBe(full.latest_revision);
    expect(retained.published_at).toBe(full.published_at);
    expect(
      db
        .prepare("SELECT count(*) n FROM source_items WHERE source_id='manual'")
        .get(),
    ).toEqual({ n: 0 });
    await sourcesService.saveSource({
      id: "source",
      name: "Source",
      url: "https://example.com/rss",
      options: { keywords: ["unmatched"], keyword_policy: "strict" },
    });
    expect(
      db
        .prepare("SELECT count(*) n FROM articles")
        .get(),
    ).toEqual({ n: 11 });
    expect(db.prepare("SELECT count(*) n FROM articles").get()).toEqual({
      n: 11,
    });
  });
});
