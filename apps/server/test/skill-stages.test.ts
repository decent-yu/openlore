import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  expect,
  it,
  vi,
} from "vitest";
import { ExecutorConfigSchema } from "@openlore/contracts";
import {
  initDatabase,
  getSqliteDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";
import { createServer } from "../src/http/server.js";
import { collectionService } from "../src/modules/collection/service.js";
import {
  articleReviewsService,
  getArticleReviews,
} from "../src/modules/processing/article-reviews.js";
import { groupsService } from "../src/modules/groups/service.js";
import { processingService } from "../src/modules/processing/service.js";
import { researchService } from "../src/modules/research/service.js";
import { releaseResearchClaims } from "../src/modules/research/state.js";
import { sourcesService } from "../src/modules/sources/service.js";
import { collectorRegistry } from "../src/modules/collection/registry.js";
import * as ai from "../src/infrastructure/ai/fallback_runner.js";
import type {
  AITaskInput,
  AIResult,
} from "../src/infrastructure/ai/adapter.js";

const evidence =
  "We explain detailed implementation mechanisms, reproducible benchmarks, failure handling and engineering tradeoffs.";
const assessment = {
  quality: 90,
  positioning: "Database performance",
  summary: "Problem, method, conclusions and limitations",
  tags: ["database"],
  reason: "Reproducible measurements",
  evidence_refs: [evidence],
};
const execute = vi.fn<(input: AITaskInput) => Promise<AIResult>>();
let app: Awaited<ReturnType<typeof createServer>>;
let id: string;
const item = () => ({
  source_id: "source",
  source_item_id: "article",
  title: "Engineering article",
  canonical_url: "https://example.com/article",
  published_at: new Date().toISOString(),
  date_evidence: { verified: true },
  body: {
    value: evidence,
    format: "text" as const,
    completeness: "full" as const,
  },
  attachments: [],
  fetched_at: new Date().toISOString(),
  fetch_method: "test",
  issues: [],
});
beforeAll(async () => {
  initDatabase();
  app = await createServer();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  const db = getSqliteDatabase();
  db.exec(
    "DELETE FROM research_claims; DELETE FROM research_tasks; DELETE FROM group_items; DELETE FROM article_reviews; DELETE FROM source_items; DELETE FROM article_revisions; DELETE FROM articles; DELETE FROM ai_execution_logs; DELETE FROM groups; DELETE FROM sources; DELETE FROM collection_candidates; DELETE FROM collection_runs; DELETE FROM source_states",
  );
  execute.mockReset().mockImplementation(async (input) => ({
    status: "success",
    provider: "mock",
    model: "mock",
    durationMs: 0,
    result:
      input.taskType === "assess"
        ? assessment
        : input.taskType === "select"
          ? {
              selected: [
                { article_id: id, reason: "Matches the research task" },
              ],
            }
          : "# Actual AI research",
  }));
  const adapter = new ai.FallbackAIAdapter([
    {
      target: {
        id: "mock",
        name: "Mock",
        provider: "codex_cli",
        cliPath: "mock",
        isPrimary: true,
      },
      adapter: {
        execute,
        testConnection: async () => ({ ok: true, message: "" }),
      },
    },
  ]);
  vi.spyOn(ai, "getAIAdapterWithFallback").mockReturnValue(adapter);
  await groupsService.saveGroup({
    id: "task",
    name: "Agent",
    description: "Agent systems",
    preferences: "Prefer concrete evidence",
    research_instructions: "Explain tradeoffs",
    repository_connection_id: "repo",
    base_path: "docs/agent",
    deep_analysis_count: 1,
  });
  id = collectionService.persistContentItem(item());
});
afterEach(async () => {
  await articleReviewsService.processPending();
  vi.restoreAllMocks();
});

it("reviews new admitted articles independently and reuses the shared result for later pipeline selection and full-text research", async () => {
  expect(getArticleReviews([id]).get(id)?.status).toBe("queued");
  await articleReviewsService.processPending();
  expect(getArticleReviews([id]).get(id)?.result).toEqual(assessment);
  const review = execute.mock.calls[0][0];
  expect(review.taskType).toBe("assess");
  expect(review.outputSchema).toMatchObject({
    additionalProperties: false,
    required: [
      "quality",
      "positioning",
      "summary",
      "tags",
      "reason",
      "evidence_refs",
    ],
  });
  expect(review.groupId).toBeUndefined();
  expect(review.prompt).not.toContain("Agent systems");
  expect(review.material).toContain(evidence);
  await processingService.runProcessingForGroup(
    (await groupsService.getGroup("task"))!,
    "run",
  );
  const selection = execute.mock.calls[1][0];
  expect(selection.taskType).toBe("select");
  expect(selection.articleId).toBeUndefined();
  expect(selection.prompt).toContain("Agent systems");
  expect(selection.material).toContain(assessment.summary);
  expect(selection.material).not.toContain(evidence);
  expect(
    (await researchService.runResearchOnArticle("task", id, undefined, "run"))
      .status,
  ).toBe("succeeded");
  expect(execute.mock.calls[2][0].material).toContain(evidence);
  expect(execute.mock.calls.map(([input]) => input.taskType)).toEqual([
    "assess",
    "select",
    "research_report",
  ]);
  releaseResearchClaims("run");
  expect(articleReviewsService.enqueue([id])).toBe(0);
});

it("automatically starts initial review after successful source admission, while duplicates do not create new reviews", async () => {
  getSqliteDatabase().exec(
    "DELETE FROM source_items; DELETE FROM article_revisions; DELETE FROM articles",
  );
  await sourcesService.saveSource({
    id: "source",
    name: "Source",
    url: "https://example.com/feed",
  });
  vi.spyOn(collectorRegistry, "get").mockReturnValue({
    id: "web_feed",
    supportedOperations: ["discover"],
    collect: async (request) => ({
      run_id: request.run_id,
      source_id: "source",
      capability_id: "web_feed",
      status: "success",
      items: [item()],
      errors: [],
      observed_at: new Date().toISOString(),
      scan: "complete",
      stats: { requests: 1, items_observed: 1, items_returned: 1 },
    }),
  });
  await collectionService.discoverSource("source");
  await articleReviewsService.processPending();
  expect(
    execute.mock.calls.filter(([input]) => input.taskType === "assess"),
  ).toHaveLength(1);
  await collectionService.discoverSource("source");
  await articleReviewsService.processPending();
  expect(
    execute.mock.calls.filter(([input]) => input.taskType === "assess"),
  ).toHaveLength(1);
});

it("leaves historical articles untouched until manually triggered and exposes initial review and selection logs by type", async () => {
  getSqliteDatabase().exec("DELETE FROM article_reviews"); // Existing historical pool at upgrade.
  await articleReviewsService.processPending();
  const unreviewed = await processingService.runProcessingForGroup(
    (await groupsService.getGroup("task"))!,
    "empty",
  );
  expect(unreviewed.counts.unreviewed).toBe(1);
  expect(execute).not.toHaveBeenCalled();
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/library/review",
        payload: { article_ids: [id] },
      })
    ).statusCode,
  ).toBe(202);
  await articleReviewsService.processPending();
  await processingService.runProcessingForGroup(
    (await groupsService.getGroup("task"))!,
    "selected-run",
  );
  const reviews = (
    await app.inject("/api/v1/execution-logs?task_type=assess")
  ).json();
  const selections = (
    await app.inject("/api/v1/execution-logs?task_type=select")
  ).json();
  expect(reviews.items).toHaveLength(1);
  expect(reviews.items[0]).toMatchObject({
    article_id: id,
    task_type: "assess",
    status: "success",
  });
  expect(selections.items).toHaveLength(1);
  expect(selections.items[0]).toMatchObject({
    run_id: "selected-run",
    group_id: "task",
    task_type: "select",
  });
  const detail = (
    await app.inject(`/api/v1/execution-logs/${selections.items[0].id}`)
  ).json();
  expect(JSON.parse(detail.input.material)[0].article_id).toBe(id);
  expect(JSON.parse(detail.output).selected[0].reason).toBe(
    "Matches the research task",
  );
  releaseResearchClaims("selected-run");
});

it("records invalid evidence without restarting a non-resumable executor, then supports explicit retry", async () => {
  execute.mockResolvedValue({
    status: "success",
    provider: "mock",
    model: "mock",
    durationMs: 0,
    result: {
      ...assessment,
      evidence_refs: ["This invented quotation is absent from the article."],
    },
  });
  await articleReviewsService.processPending();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(getArticleReviews([id]).get(id)).toMatchObject({
    status: "failed",
    result: null,
    error_message: expect.stringContaining("evidence_refs[0]"),
  });
  const logs = (
    await app.inject("/api/v1/execution-logs?task_type=assess&status=problem")
  ).json();
  expect(logs.items).toHaveLength(1);
  execute.mockResolvedValue({
    status: "success",
    provider: "mock",
    model: "mock",
    durationMs: 0,
    result: assessment,
  });
  expect(articleReviewsService.enqueue([id])).toBe(1);
  await articleReviewsService.processPending();
  expect(getArticleReviews([id]).get(id)?.status).toBe("succeeded");
});

it("finishes navigation-only material without AI, fabricated scores or automatic re-enqueue", async () => {
  const content =
    "18th October 2026\n\n## Recent articles\n\n- [A sufficiently long navigation link](https://example.com/one) - 12th October 2026";
  collectionService.persistContentItem(
    { ...item(), body: { ...item().body, value: content } },
    id,
  );
  await articleReviewsService.processPending();
  expect(execute).not.toHaveBeenCalled();
  expect(getArticleReviews([id]).get(id)).toMatchObject({
    status: "insufficient",
    result: null,
    error_message: null,
    log_id: null,
  });
  expect(articleReviewsService.enqueue([id])).toBe(0);
  expect(articleReviewsService.enqueue([id], true)).toBe(1);
  await articleReviewsService.processPending();
  expect(execute).not.toHaveBeenCalled();
});

it("does not change an old score into a current-revision review and validates manual requests atomically", async () => {
  await articleReviewsService.processPending();
  const changed = {
    ...item(),
    body: {
      value: evidence + " Changed body.",
      format: "text" as const,
      completeness: "full" as const,
    },
  };
  collectionService.persistContentItem(changed, id);
  expect(getArticleReviews([id]).get(id)).toMatchObject({
    status: "queued",
    result: null,
  });
  const db = getSqliteDatabase();
  db.exec("DELETE FROM article_reviews");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/library/review",
        payload: { article_ids: [] },
      })
    ).statusCode,
  ).toBe(400);
  expect(() => articleReviewsService.enqueue([id, "missing"])).toThrow(
    "缺少正文版本",
  );
  expect(db.prepare("SELECT count(*) n FROM article_reviews").get()).toEqual({
    n: 0,
  });
});

it("uses the configured review concurrency without a slow first article blocking the third or duplicate execution", async () => {
  const adapter = ai.getAIAdapterWithFallback() as ai.FallbackAIAdapter;
  adapter.targets[0].target.execution = ExecutorConfigSchema.parse({
    concurrency: 2,
  });
  for (const n of [2, 3])
    collectionService.persistContentItem({
      ...item(),
      source_item_id: `article-${n}`,
      canonical_url: `https://example.com/article-${n}`,
    });
  const pending: Array<(result: AIResult) => void> = [];
  execute.mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const draining = articleReviewsService.processPending();
  try {
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(
      getSqliteDatabase()
        .prepare(
          "SELECT count(*) n FROM article_reviews WHERE status='running'",
        )
        .get(),
    ).toEqual({ n: 2 });
    const runningIds = execute.mock.calls.map(([input]) => input.articleId!);
    expect(articleReviewsService.enqueue(runningIds)).toBe(0);
    expect(
      runningIds.every(
        (articleId) => getArticleReviews([articleId]).get(articleId)?.log_id,
      ),
    ).toBe(true);
    pending[1]({
      status: "success",
      provider: "mock",
      model: "mock",
      durationMs: 1,
      result: assessment,
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(
      new Set(execute.mock.calls.map(([input]) => input.articleId)).size,
    ).toBe(3);
  } finally {
    for (const resolve of pending)
      resolve({
        status: "success",
        provider: "mock",
        model: "mock",
        durationMs: 1,
        result: assessment,
      });
    await draining;
  }
});

it("does not strand work enqueued while an empty drain is finishing", async () => {
  getSqliteDatabase().exec("DELETE FROM article_reviews");
  const draining = articleReviewsService.processPending();
  articleReviewsService.enqueue([id]);
  await draining;
  expect(getArticleReviews([id]).get(id)?.status).toBe("succeeded");
  expect(execute).toHaveBeenCalledTimes(1);
});
