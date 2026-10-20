import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import * as prompts from "@openlore/contracts";
import {
  initDatabase,
  getSqliteDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";
import { groupsService } from "../src/modules/groups/service.js";
import { collectionService } from "../src/modules/collection/service.js";
import { articleReviewsService } from "../src/modules/processing/article-reviews.js";
import { processingService } from "../src/modules/processing/service.js";
import { researchService } from "../src/modules/research/service.js";
import { deliveryService } from "../src/modules/delivery/service.js";
import { AppScheduler } from "../src/modules/scheduler/scheduler.js";
import { feedService } from "../src/modules/feed/service.js";
import { listPoolCandidates } from "../src/modules/processing/candidates.js";
import { releaseResearchClaims } from "../src/modules/research/state.js";
import { skillsService } from "../src/modules/skills/service.js";
import * as ai from "../src/infrastructure/ai/fallback_runner.js";
import { GitHubClient } from "../src/infrastructure/repositories/github/client.js";
import { secretsStore } from "../src/infrastructure/secrets/local_file/secrets_store.js";

const body =
  "A reproducible agent architecture with detailed execution traces and benchmark evidence.";
let ids: string[] = [];
const execute = vi.fn(async (input: any) =>
  input.taskType === "assess"
    ? {
        status: "success" as const,
        provider: "mock",
        model: "mock",
        durationMs: 1,
        result: {
          positioning: "工程实践",
          tags: ["工程"],
          quality: 90,
          reason: "Concrete engineering evidence",
          summary: "Assessment summary",
          evidence_refs: [body],
        },
      }
    : input.taskType === 'select' ? {
        status: 'success' as const, provider: 'mock', model: 'mock', durationMs: 1,
        result: {selected: JSON.parse(input.material).slice(0, 1).map((item: any) => ({article_id: item.article_id, reason: 'Matches the task'}))},
      }
    : {
        status: "success" as const,
        provider: "mock",
        model: "mock",
        durationMs: 1,
        result: "# Complete research\n\nDetailed mechanisms and tradeoffs.",
      },
);
beforeAll(() => initDatabase());
beforeEach(async () => {
  const db = getSqliteDatabase();
  db.exec(
    "DELETE FROM research_claims;DELETE FROM research_tasks;DELETE FROM runs;DELETE FROM group_items;DELETE FROM article_reviews;DELETE FROM source_items;DELETE FROM article_revisions;DELETE FROM articles;DELETE FROM groups;DELETE FROM deliveries;DELETE FROM artifact_bundles;DELETE FROM article_locations;DELETE FROM collections;DELETE FROM repository_connections",
  );
  execute.mockClear();
  vi.spyOn(ai, "getAIAdapterWithFallback").mockReturnValue({
    execute,
    testConnection: async () => ({ ok: true, message: "mock" }),
  });
  vi.spyOn(skillsService, "getSkill").mockImplementation(async (id) => ({
    id,
    name: id,
    type: id === "tech-article-extractor" ? "extraction" : id === "article-selector" ? "selection" : "research",
    revision: "v1",
    description: "",
    tags: [],
    file_path: "",
    system_prompt: "",
  }));
  vi.spyOn(secretsStore, "getSecret").mockReturnValue("test");
  vi.spyOn(GitHubClient, "syncFiles").mockImplementation(async (input) => ({
    status: "updated",
    changedPaths: input.files.map((file) => file.path),
    commitSha: "commit",
    commitUrl: "https://github.com/example/repo/commit/commit",
  }));
  db.prepare(
    "INSERT INTO repository_connections(id,name,revision,owner,repo,default_branch,credential_ref) VALUES ('repo','Repo','v1','example','repo','main','secret')",
  ).run();
  await groupsService.saveGroup({
    id: "task",
    name: "Agent",
    repository_connection_id: "repo",
    base_path: "docs/agent",
    deep_analysis_count: 1,
  });
  ids = ["Old best", "New article"].map((title, index) =>
    collectionService.persistContentItem({
      source_id: "source",
      source_item_id: String(index),
      title,
      canonical_url: `https://example.com/${index}`,
      published_at: index ? "2026-10-19" : "2020-01-01",
      body: { value: body, format: "text", completeness: "full" },
      attachments: [],
      fetched_at: new Date().toISOString(),
      fetch_method: "test",
      issues: [],
    }),
  );
  await articleReviewsService.processPending();
});
afterEach(() => vi.restoreAllMocks());
async function finish(scheduler: AppScheduler, id: string) {
  await vi.waitFor(async () =>
    expect((await scheduler.getRun(id))?.status).not.toBe("running"),
  );
  return (await scheduler.getRun(id))!;
}

it("selects from shared reviews across all old and new content and only excludes archived research", async () => {
  const scheduler = new AppScheduler();
  const first = await finish(
    scheduler,
    (await scheduler.triggerGroupRun("task")).id,
  );
  expect(first.status).toBe("succeeded");
  expect(first.output.entries.map((e) => e.article_id)).toEqual([ids[0]]);
  expect(
    execute.mock.calls.filter(([input]) => input.taskType === "assess"),
  ).toHaveLength(2);
  expect(await groupsService.getGroup("task")).not.toHaveProperty(
    "max_selected",
  );
  expect(listPoolCandidates([]).find((a) => a.id === ids[0])?.processed).toBe(
    1,
  );
  const second = await finish(
    scheduler,
    (await scheduler.triggerGroupRun("task")).id,
  );
  expect(second.output.entries.map((e) => e.article_id)).toEqual([ids[1]]);
  expect(
    execute.mock.calls.filter(([input]) => input.taskType === "assess"),
  ).toHaveLength(2);
  expect((await feedService.getDailyFeed("task")).deep_articles).toHaveLength(
    2,
  );
});

it("releases claims on failed publication, keeps the generated report and retries without a second research call", async () => {
  vi.mocked(GitHubClient.syncFiles).mockResolvedValueOnce({
    status: "failed",
    changedPaths: [],
    errorMessage: "offline",
  });
  const scheduler = new AppScheduler();
  const first = await finish(
    scheduler,
    (await scheduler.triggerGroupRun("task")).id,
  );
  expect(first.status).toBe("failed");
  expect((await feedService.getDailyFeed("task")).deep_articles).toHaveLength(
    0,
  );
  expect(
    getSqliteDatabase().prepare("SELECT count(*) n FROM research_claims").get(),
  ).toEqual({ n: 0 });
  expect(listPoolCandidates([]).find((a) => a.id === ids[0])?.processed).toBe(
    0,
  );
  const generated = execute.mock.calls.filter(
    ([input]) => input.taskType === "research_report",
  ).length;
  const retry = await finish(
    scheduler,
    (await scheduler.triggerGroupRun("task")).id,
  );
  expect(retry.status).toBe("succeeded");
  expect(
    execute.mock.calls.filter(
      ([input]) => input.taskType === "research_report",
    ),
  ).toHaveLength(generated);
  expect((await feedService.getDailyFeed("task")).deep_articles).toHaveLength(
    1,
  );
});

it("reuses an unarchived report only while its complete prompt and skill revision still match", async () => {
  const first = await researchService.runResearchOnArticle("task", ids[0]);
  const retry = await researchService.runResearchOnArticle("task", ids[0]);
  expect(first.status).toBe("succeeded");
  expect(retry.id).toBe(first.id);
  expect(
    execute.mock.calls.filter(([input]) => input.taskType === "research_report"),
  ).toHaveLength(1);

  // Simulate updated shared writing rules with the same executor-local Skill.
  const buildPrompt = prompts.buildResearchPrompt;
  vi.spyOn(prompts, "buildResearchPrompt").mockImplementation(
    (...args) => `${buildPrompt(...args)}\n补充要求：先解释读者必需的背景。`,
  );
  const updated = await researchService.runResearchOnArticle("task", ids[0]);
  expect(updated.status).toBe("succeeded");
  expect(updated.id).not.toBe(first.id);
  const researchCalls = execute.mock.calls.filter(
    ([input]) => input.taskType === "research_report",
  );
  expect(researchCalls).toHaveLength(2);
  expect(researchCalls[1][0].skillRevision).toBe(
    researchCalls[0][0].skillRevision,
  );
  expect(researchCalls[1][0].prompt).not.toBe(researchCalls[0][0].prompt);
  expect(
    (await researchService.runResearchOnArticle("task", ids[0])).id,
  ).toBe(updated.id);
  expect(
    execute.mock.calls.filter(([input]) => input.taskType === "research_report"),
  ).toHaveLength(2);
});

it("holds a global article claim across pipelines until publication has finished", async () => {
  const first = await processingService.runProcessingForGroup(
    (await groupsService.getGroup("task"))!,
    "owner-one",
  );
  await groupsService.saveGroup({
    id: "other",
    name: "Other",
    repository_connection_id: "repo",
    base_path: "docs/other",
    deep_analysis_count: 1,
  });
  const other = await processingService.runProcessingForGroup(
    (await groupsService.getGroup("other"))!,
    "owner-two",
  );
  expect(first.entries[0].article_id).not.toBe(other.entries[0].article_id);
  expect(
    getSqliteDatabase().prepare("SELECT count(*) n FROM research_claims").get(),
  ).toEqual({ n: 2 });
  releaseResearchClaims("owner-one");
  releaseResearchClaims("owner-two");
});

it("supports direct research from an unarchived pool article and publishes before exposing it", async () => {
  const task = await feedService.researchArticle("task", ids[0]);
  expect(task.archived_at).toBeTruthy();
  expect((await feedService.getDailyFeed("task")).deep_articles[0].id).toBe(
    ids[0],
  );
  expect(
    getSqliteDatabase().prepare("SELECT count(*) n FROM research_claims").get(),
  ).toEqual({ n: 0 });
  expect(
    vi
      .mocked(GitHubClient.syncFiles)
      .mock.calls[0][0].files.some((f) => f.path.endsWith("/research.md")),
  ).toBe(true);
});
