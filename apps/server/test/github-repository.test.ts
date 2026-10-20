import fs from "node:fs";
import path from "node:path";
import { getAppPaths } from "../src/infrastructure/config/paths.js";
import { executionLogs } from "../src/infrastructure/ai/execution_logs.js";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as prompts from "@openlore/contracts";
import * as processes from "../src/infrastructure/ai/workspace_runner.js";
import { processingService } from "../src/modules/processing/service.js";
import { createServer } from "../src/http/server.js";
import { reportService } from "../src/modules/reports/service.js";
import { GenericWebhookSender } from "../src/infrastructure/notifications/generic_webhook/sender.js";
import {
  parseGitHubRepository,
  RunOutputSchema,
  DailyFeedArticleSchema,
} from "@openlore/contracts";
import {
  initDatabase,
  getSqliteDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";
import { SafeHttpClient } from "../src/infrastructure/http/client.js";
import { GitHubClient } from "../src/infrastructure/repositories/github/client.js";
import { secretsStore } from "../src/infrastructure/secrets/local_file/secrets_store.js";
import * as ai from "../src/infrastructure/ai/fallback_runner.js";
import { sourcesService } from "../src/modules/sources/service.js";
import { collectionService } from "../src/modules/collection/service.js";
import { groupsService } from "../src/modules/groups/service.js";
import { skillsService } from "../src/modules/skills/service.js";
import { AppScheduler } from "../src/modules/scheduler/scheduler.js";
import { getPublishedWikiLinks } from "../src/modules/delivery/wiki-links.js";
import { researchService } from "../src/modules/research/service.js";
import { feedService } from "../src/modules/feed/service.js";
import { settingsService } from "../src/modules/settings/service.js";

let latestCommit = 'a'.repeat(40);
function reportResult(input: any, title = '核心执行架构') {
  const commit = input.repository?.commit || latestCommit;
  return { status: 'success', provider: 'mock', model: 'mock', durationMs: 1,
    repository: input.repository ? { url: input.repository.url, commit, branch: 'development' } : undefined,
    result: `# ${title}\n\n基于源码分析调用链与技术取舍。[源码](${input.repository?.url}/blob/${commit}/src/core.ts#L1)\n\n![](./assets/architecture.svg)\n\n![](https://example.com/assets/remote.svg)`,
    artifacts: input.repository ? [{ path: 'evidence.json', content: Buffer.from(JSON.stringify({ complete: true, commit, questions: [`${title}如何实现？`], citations: [{ claim: '核心实现', file: 'src/core.ts', start_line: 1, end_line: 1, quote: 'export const implementation = true;' }] })).toString('base64') }] : [],
  };
}

beforeAll(() => initDatabase());
const execute = vi.fn();
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T02:00:00Z"));
  const db = getSqliteDatabase();
  for (const table of [
    "repository_rotation",
    "research_claims",
    "research_tasks",
    "runs",
    "group_items",
    "article_reviews",
    "source_items",
    "article_revisions",
    "articles",
    "group_sources",
    "group_sources",
    "groups",
    "deliveries",
    "artifact_bundles",
    "article_locations",
    "collections",
    "repository_connections",
    "collection_candidates",
    "collection_runs",
    "source_states",
    "sources",
  ])
    db.exec(`DELETE FROM ${table}`);
  latestCommit = 'a'.repeat(40);
  vi.spyOn(processes, 'runProcess').mockRejectedValue(new Error('Control service must never run Git'));
  execute.mockReset().mockImplementation(async input => reportResult(input, input.repository_context?.history.length ? `后续机制${input.repository_context.history.length}` : '核心执行架构'));
  vi.spyOn(ai, "getAIAdapterWithFallback").mockReturnValue({
    execute,
    testConnection: async () => ({ ok: true, message: "mock" }),
  });
  vi.spyOn(skillsService, "getSkill").mockImplementation(async (id) => ({
    id,
    name: id,
    type: id === "article-selector" ? "selection" : "research",
    revision: "v1",
    description: "",
    tags: [],
    file_path: "",
    system_prompt: "",
  }));
  vi.spyOn(secretsStore, "getSecret").mockReturnValue("test");
  vi.spyOn(GitHubClient, "syncFiles").mockImplementation(async (options) => ({
    status: "updated",
    changedPaths: options.files.map((file) => file.path),
    commitSha: "sha",
    commitUrl: "https://github.com/example/vault/commit/sha",
  }));
  vi.spyOn(SafeHttpClient, 'fetch').mockRejectedValue(new Error('Repository reads must use local Git'));
  db.prepare(
    "INSERT INTO repository_connections(id,name,revision,owner,repo,default_branch,credential_ref,wiki_base_url,wiki_root_path) VALUES ('vault','Vault','v1','example','vault','archive','token','https://wiki.example/vault','docs')",
  ).run();
  await sourcesService.saveSource({
    id: "orca",
    name: "Orca",
    url: "https://github.com/stablyai/orca.git",
    capability_id: "github_repository",
    options: { research_focus: "执行器与工作区隔离" },
  });
  await groupsService.saveGroup({
    id: "study",
    task_type: "repository_research",
    name: "仓库研读",
    repository_connection_id: "vault",
    base_path: "docs/xxx",
    source_ids: ["orca"],
    deep_analysis_count: 1,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function run(scheduler = new AppScheduler()) {
  const started = await scheduler.triggerGroupRun("study");
  await vi.waitFor(async () =>
    expect((await scheduler.getRun(started.id))?.status).not.toBe("running"),
  );
  return (await scheduler.getRun(started.id))!;
}

it("validates GitHub roots and source capabilities before saving", async () => {
  expect(
    parseGitHubRepository("https://github.com/stablyai/orca.git/"),
  ).toMatchObject({
    directory: "stablyai@orca",
    url: "https://github.com/stablyai/orca",
  });
  for (const url of [
    "https://example.com/stablyai/orca",
    "https://github.com/stablyai/orca/tree/main",
    "https://github.com/stablyai/orca?x=1",
    "https://user@github.com/stablyai/orca",
  ]) {
    await expect(
      sourcesService.saveSource({
        name: "invalid",
        url,
        capability_id: "github_repository",
      }),
    ).rejects.toThrow();
  }
  await expect(
    sourcesService.saveSource({
      name: "unknown",
      url: "https://example.com",
      capability_id: "unknown",
    }),
  ).rejects.toThrow();
  await expect(
    sourcesService.saveSource({
      id: "orca",
      name: "changed",
      url: "https://example.com",
      capability_id: "web_feed",
    }),
  ).rejects.toThrow("来源类型不能修改");
});

it('rejects controller-side repository polling and skips repositories even during forced source polling', async () => {
  await expect(collectionService.previewSource('orca')).rejects.toThrow('AI 执行器');
  await expect(collectionService.discoverSource('orca')).rejects.toThrow('AI 执行器');
  expect(await new AppScheduler().pollDueSources(true)).toEqual([]);
  expect(processes.runProcess).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(getSqliteDatabase().prepare('SELECT count(*) n FROM articles').get()).toEqual({ n: 0 });
});

it("archives numbered reports once and exposes the direct research Wiki link", async () => {
  const first = await run();
  expect(first.status).toBe("succeeded");
  expect(execute.mock.calls.map(([input]) => input.taskType)).toEqual([
    "research_report",
  ]);
  expect(execute.mock.calls[0][0].prompt).toContain("执行器与工作区隔离");
  expect(execute.mock.calls[0][0].skillId).toBe("github-code-research");
  expect(execute.mock.calls[0][0].repository).toEqual({ url: "https://github.com/stablyai/orca", commit: undefined });
  expect(processes.runProcess).not.toHaveBeenCalled();
  expect(execute.mock.calls[0][0].prompt).not.toContain("deep-research-expert");
  expect(
    first.ai_logs.find((log) => log.task_type === "research")?.skill_id,
  ).toBe("github-code-research");
  const files = vi.mocked(GitHubClient.syncFiles).mock.calls[0][0].files;
  const research = files.find(
    (file) => file.path === "docs/xxx/stablyai@orca/01-核心执行架构.md",
  )!;
  expect(research).toBeTruthy();
  expect(Buffer.from(research.content, "base64").toString()).toContain(
    "./assets/01-核心执行架构/architecture.svg",
  );
  expect(
    files.some(
      (file) =>
        file.path === "docs/xxx/stablyai@orca/articles/01-核心执行架构.md",
    ),
  ).toBe(false);
  expect(Buffer.from(research.content, "base64").toString()).toContain(
    "https://example.com/assets/remote.svg",
  );
  expect(first.output.entries[0].document_url).toContain("01-");
  expect(first.output.entries[0].document_url).toMatch(/\.md$/);
  const links = getPublishedWikiLinks(
    [first.output.entries[0].article_id],
    "study",
  ).get(`study:${first.output.entries[0].article_id}`)!;
  expect(decodeURIComponent(links.research_url!)).toBe(
    "https://wiki.example/vault/xxx/stablyai@orca/01-核心执行架构",
  );
  expect(links.article_url).toBeUndefined();
  expect(GitHubClient.syncFiles).toHaveBeenCalledTimes(1);
  execute.mockImplementationOnce(async input => reportResult(input, "工作区隔离机制"));
  expect((await run()).status).toBe("succeeded");
  expect(execute.mock.calls[1][0].prompt).toContain("核心执行架构");
  const nextFiles = vi.mocked(GitHubClient.syncFiles).mock.calls[1][0].files;
  expect(
    nextFiles.some(
      (file) => file.path === "docs/xxx/stablyai@orca/02-工作区隔离机制.md",
    ),
  ).toBe(true);
  const index = Buffer.from(
    nextFiles.find((file) => file.path === "docs/xxx/README.md")!
      .content,
    "base64",
  ).toString();
  expect(decodeURIComponent(index)).toContain("01-核心执行架构.md");
  expect(decodeURIComponent(index)).toContain("02-工作区隔离机制.md");
  expect(nextFiles.some(file=>file.path.includes('/stablyai@orca/articles/'))).toBe(false);
  expect(nextFiles.some(file=>file.path==='docs/xxx/stablyai@orca/README.md')).toBe(false);
  const manifest = JSON.parse(
    Buffer.from(
      nextFiles.find(
        (file) => file.path === "docs/xxx/.openlore/manifest.json",
      )!.content,
      "base64",
    ).toString(),
  );
  expect(Object.keys(manifest.article_locations)).toHaveLength(2);
  expect(manifest.managed_files).toHaveProperty([
    "docs/xxx/stablyai@orca/01-核心执行架构.md",
  ]);
});

it('stores only user goals and auto-associated history; goal edits preserve reports', async () => {
  expect((await run()).status).toBe('succeeded');
  const before = (await sourcesService.getSource('orca'))!;
  expect(before.repository_history).toHaveLength(1);
  expect(before.repository_history![0]).toMatchObject({ status: 'completed', title: '核心执行架构', commit: 'a'.repeat(40) });
  expect(before.repository_history![0].reports[0].wiki_url).toContain('https://wiki.example/');
  const saved = await sourcesService.saveSource({ id: 'orca', name: 'Orca', url: before.url, options: { research_focus: '研究状态恢复' } });
  expect(saved.repository_history).toEqual(before.repository_history);
  expect(execute).toHaveBeenCalledTimes(1);
  await expect(sourcesService.saveSource({ id: 'orca', name: 'Other', url: 'https://github.com/example/other' })).rejects.toThrow('仓库地址不能修改');
});

it("keeps each repository on an independent archive sequence", async () => {
  expect((await run()).status).toBe("succeeded");
  await sourcesService.saveSource({
    id: "another",
    name: "Another",
    url: "https://github.com/example/another",
    capability_id: "github_repository",
  });
  await groupsService.saveGroup({
    id: "study",
    task_type: "repository_research",
    name: "仓库研读",
    repository_connection_id: "vault",
    base_path: "docs/xxx",
    source_ids: ["orca", "another"],
    deep_analysis_count: 1,
  });
  vi.setSystemTime(new Date("2026-10-21T02:00:00Z"));
  expect((await run()).status).toBe("succeeded");
  expect(
    vi
      .mocked(GitHubClient.syncFiles)
      .mock.calls[1][0].files.some(
        (file) => file.path === "docs/xxx/example@another/01-核心执行架构.md",
      ),
  ).toBe(true);
});

it("reuses generated reports and numbering after a failed archive without exposing a failed Wiki publication", async () => {
  vi.mocked(GitHubClient.syncFiles).mockResolvedValueOnce({
    status: "failed",
    changedPaths: [],
    errorMessage: "offline",
  });
  const first = await run();
  expect(first.status).toBe("failed");
  expect((await feedService.getDailyFeed("study")).deep_articles).toHaveLength(
    0,
  );
  const article = getSqliteDatabase()
    .prepare("SELECT id FROM articles")
    .get() as { id: string };
  expect(getPublishedWikiLinks([article.id], "study").size).toBe(0);
  const retry = await run();
  expect(retry.status).toBe("succeeded");
  expect(
    getPublishedWikiLinks([article.id], "study").get(`study:${article.id}`)
      ?.research_url,
  ).toBeTruthy();
  expect(execute).toHaveBeenCalledTimes(1);
  const paths = vi
    .mocked(GitHubClient.syncFiles)
    .mock.calls.map(([input]) =>
      input.files
        .filter((file) => file.path.includes("stablyai@orca/01-"))
        .map((file) => file.path),
    );
  expect(paths[1]).toEqual(paths[0]);
  expect(
    getSqliteDatabase()
      .prepare("SELECT count(*) n FROM article_locations")
      .get(),
  ).toEqual({ n: 1 });
});

it("keeps executor source preparation failures retryable without publishing placeholder reports", async () => {
  execute.mockResolvedValueOnce({ status: 'failed', provider: 'mock', model: 'mock', durationMs: 1, error: { code: 'execution_failed', message: 'executor network down' } });
  expect((await run()).status).toBe("failed");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(GitHubClient.syncFiles).not.toHaveBeenCalled();
  expect(
    getSqliteDatabase().prepare("SELECT count(*) n FROM source_states").get(),
  ).toEqual({ n: 0 });
  expect((await run()).status).toBe("succeeded");
});

it("does not fall back to the article Skill when the code research Skill is missing", async () => {
  vi.mocked(skillsService.getSkill).mockImplementation(async (id) =>
    id === "github-code-research"
      ? null
      : {
          id,
          name: id,
          type: "selection",
          description: "",
          tags: [],
          file_path: "",
          system_prompt: "",
        },
  );
  const result = await run();
  expect(result.status).toBe("failed");
  expect(execute).not.toHaveBeenCalled();
  expect(skillsService.getSkill).not.toHaveBeenCalledWith(
    "deep-research-expert",
    expect.anything(),
  );
});

it("keeps code research reuse independent of article Skill changes", async () => {
  vi.mocked(GitHubClient.syncFiles).mockResolvedValueOnce({
    status: "failed",
    changedPaths: [],
    errorMessage: "offline",
  });
  expect((await run()).status).toBe("failed");
  getSqliteDatabase()
    .prepare(
      "UPDATE groups SET research_skill_id='another-article-skill' WHERE id='study'",
    )
    .run();
  expect((await run()).status).toBe("succeeded");
  expect(execute).toHaveBeenCalledTimes(1);
});

it("rejects assigning the code Skill to the article research setting", async () => {
  await expect(
    groupsService.saveGroup({
      id: "invalid",
      name: "Invalid mix",
      repository_connection_id: "vault",
      base_path: "docs/invalid",
      task_type: "article_research",
      research_skill_id: "github-code-research",
    }),
  ).rejects.toThrow("文章调研 Skill 不能使用");
});

it("validates task types and prevents cross-type sources and manual research", async () => {
  await sourcesService.saveSource({
    id: "rss",
    name: "RSS",
    url: "https://example.com/rss",
  });
  await expect(
    groupsService.saveGroup({
      name: "Mixed",
      repository_connection_id: "vault",
      base_path: "docs/mixed",
      task_type: "repository_research",
      source_ids: ["orca", "rss"],
    }),
  ).rejects.toThrow("不适用于");
  await expect(
    groupsService.saveGroup({
      name: "Wrong",
      repository_connection_id: "vault",
      base_path: "docs/wrong",
      task_type: "article_research",
      source_ids: ["orca"],
    }),
  ).rejects.toThrow("不适用于");
  await expect(
    groupsService.saveGroup({
      id: "study",
      name: "Changed",
      repository_connection_id: "vault",
      base_path: "docs/xxx",
      task_type: "article_research",
    }),
  ).rejects.toThrow("任务类型不能修改");
  await expect(
    groupsService.saveGroup({
      name: "Unknown",
      repository_connection_id: "vault",
      base_path: "docs/unknown",
      task_type: "unknown" as any,
    }),
  ).rejects.toThrow();
  const articlePipeline = await groupsService.saveGroup({
    id: "articles",
    name: "文章调研",
    repository_connection_id: "vault",
    base_path: "docs/articles",
    source_ids: ["rss"],
  });
  await run();
  const repositoryItem = getSqliteDatabase()
    .prepare("SELECT id FROM articles")
    .get() as { id: string };
  await expect(
    feedService.researchArticle(articlePipeline.id, repositoryItem.id),
  ).rejects.toThrow("不属于当前任务类型");
  const saved = await groupsService.saveGroup({
    id: "study",
    name: "Renamed",
    repository_connection_id: "vault",
    base_path: "docs/xxx",
  });
  expect(saved.task_type).toBe("repository_research");
  expect(saved.research_skill_id).toBe("github-code-research");
});

it("reuses an upload retry even if the code prompt or Skill changes", async () => {
  vi.mocked(GitHubClient.syncFiles).mockResolvedValue({
    status: "failed",
    changedPaths: [],
    errorMessage: "offline",
  });
  expect((await run()).status).toBe("failed");
  const previous = prompts.buildCodeResearchPrompt;
  vi.spyOn(prompts, "buildCodeResearchPrompt").mockImplementation(
    (instructions) => previous(instructions) + "\n用具体例子解释状态恢复。",
  );
  expect((await run()).status).toBe("failed");
  expect(execute).toHaveBeenCalledTimes(1);
});

it("feeds both task types into the same daily feed, report preview and webhook payload", async () => {
  const db = getSqliteDatabase();
  await sourcesService.saveSource({
    id: "rss",
    name: "RSS",
    url: "https://example.com/rss",
  });
  await groupsService.saveGroup({
    id: "articles",
    name: "文章调研",
    repository_connection_id: "vault",
    base_path: "docs/articles",
    source_ids: ["rss"],
    deep_analysis_count: 1,
  });
  const articleId = collectionService.persistContentItem({
    source_id: "rss",
    source_item_id: "rss:post",
    title: "Readable article",
    canonical_url: "https://example.com/post",
    body: {
      value:
        "An implementation with a concrete queue and recovery mechanism, supported by source code and detailed tests.",
      format: "markdown",
      completeness: "full",
    },
    attachments: [],
    fetched_at: new Date().toISOString(),
    fetch_method: "test",
    issues: [],
  });
  db.prepare(
    "UPDATE article_reviews SET status='succeeded',result_json=? WHERE article_id=?",
  ).run(
    JSON.stringify({
      quality: 90,
      positioning: "Engineering",
      summary: "Explains a queue",
      reason: "Source evidence",
      tags: ["systems"],
      evidence_refs: ["concrete queue and recovery mechanism"],
    }),
    articleId,
  );
  execute.mockImplementation(async input => input.repository ? reportResult(input) : ({
    status: 'success', provider: 'mock', model: 'mock',
    result: input.taskType === 'select' ? { selected: [{ article_id: articleId, reason: 'Concrete mechanism' }] } : input.taskType === 'translate' ? { markdown: input.material } : '# 中文研报\n\n解释源码实现与适用条件。',
  }));
  const repositoryRun = await run();
  const scheduler = new AppScheduler();
  const started = await scheduler.triggerGroupRun("articles");
  await vi.waitFor(async () =>
    expect((await scheduler.getRun(started.id))?.status).not.toBe("running"),
  );
  const articleRun = (await scheduler.getRun(started.id))!;
  expect(repositoryRun.status).toBe("succeeded");
  expect(articleRun.status).toBe("succeeded");
  for (const output of [repositoryRun.output, articleRun.output]) {
    expect(RunOutputSchema.parse(output).entries).toHaveLength(1);
    expect(output.entries[0].document_url).toBeTruthy();
  }
  for (const id of ["study", "articles"]) {
    const feed = await feedService.getDailyFeed(id);
    expect(feed.deep_articles).toHaveLength(1);
    expect(feed.deep_articles[0].summary).toBeTruthy();
    expect(
      DailyFeedArticleSchema.parse(feed.deep_articles[0]).research?.wiki_url,
    ).toBeTruthy();
  }
  expect(
    execute.mock.calls.filter(([input]) => input.taskType === "translate"),
  ).toHaveLength(1);
  const overview = await feedService.getDailyFeed();
  expect(overview.group).toBeNull();
  expect(overview.stats.pool_count).toBe(2);
  expect(overview.deep_articles).toHaveLength(2);
  expect(new Set(overview.deep_articles.map((item) => item.task_type))).toEqual(
    new Set(["article_research", "repository_research"]),
  );
  expect(
    overview.deep_articles.every(
      (item) => item.sources.length === 1 && item.research?.wiki_url,
    ),
  ).toBe(true);
  const uploads = vi
    .mocked(GitHubClient.syncFiles)
    .mock.calls.map(([input]) => input.files.map((file) => file.path));
  expect(uploads[0].some((file) => file.endsWith("article-zh-CN.md"))).toBe(
    false,
  );
  expect(uploads[1].some((file) => file.endsWith("article-zh-CN.md"))).toBe(
    true,
  );
  db.prepare(
    "INSERT INTO notification_connections(id,name,revision,url_secret_ref) VALUES ('notify','Combined','v1','webhook')",
  ).run();
  const plan = await reportService.savePlan({
    id: "combined",
    name: "统一日报",
    enabled: true,
    pipeline_ids: ["study", "articles"],
    notification_connection_id: "notify",
  });
  const preview = await reportService.preview(plan.id);
  expect(preview.state).toBe("ready");
  expect(preview.articles).toHaveLength(2);
  expect(
    preview.articles.every((article) =>
      article.url?.startsWith("https://wiki.example/vault/"),
    ),
  ).toBe(true);
  const send = vi
    .spyOn(GenericWebhookSender, "send")
    .mockResolvedValue({ status: "sent" });
  await reportService.send(plan.id);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][1].articles).toHaveLength(2);
});

it("keeps empty source selections scoped to the declared task type", async () => {
  collectionService.persistContentItem({
    source_id: "article-source",
    source_item_id: "article-scope",
    title: "Article",
    canonical_url: "https://example.com/scope",
    body: {
      value:
        "A concrete article about queue processing and recovery, with readable implementation details and test evidence.",
      format: "markdown",
      completeness: "full",
    },
    attachments: [],
    fetched_at: new Date().toISOString(),
    fetch_method: "test",
    issues: [],
  });
  const article = await groupsService.saveGroup({
    name: "All articles",
    repository_connection_id: "vault",
    base_path: "docs/all-articles",
    deep_analysis_count: 0,
  });
  const repository = await groupsService.saveGroup({
    name: "All repositories",
    task_type: "repository_research",
    repository_connection_id: "vault",
    base_path: "docs/all-repositories",
    deep_analysis_count: 0,
  });
  expect(
    (await processingService.runProcessingForGroup(article, "article-scope"))
      .counts.observed,
  ).toBe(1);
  expect(
    (
      await processingService.runProcessingForGroup(
        repository,
        "repository-scope",
      )
    ).counts.observed,
  ).toBe(1);
  expect(execute).not.toHaveBeenCalled();
});

it("exposes task types consistently through the API and rejects incompatible source bindings", async () => {
  const app = await createServer();
  try {
    const group = (
      await app.inject({ method: "GET", url: "/api/v1/pipelines/study" })
    ).json();
    expect(group.task_type).toBe("repository_research");
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/pipelines",
      payload: {
        name: "Mixed",
        repository_connection_id: "vault",
        base_path: "docs/api-invalid",
        task_type: "article_research",
        source_ids: ["orca"],
      },
    });
    expect(invalid.statusCode).toBe(400);
    await run();
    const library = (
      await app.inject({ method: "GET", url: "/api/v1/library" })
    ).json();
    expect(library.items[0].task_type).toBe("repository_research");
  } finally {
    await app.close();
  }
});

it('rotates repositories while giving each source its own quota on every run', async () => {
  await sourcesService.saveSource({ id: 'other', name: 'Other', url: 'https://github.com/example/other', capability_id: 'github_repository', options: { research_focus: '数据结构' } });
  getSqliteDatabase().prepare("INSERT INTO group_sources(group_id,source_id) VALUES ('study','other')").run();
  getSqliteDatabase().prepare("UPDATE groups SET deep_analysis_count=2 WHERE id='study'").run();
  const first = await run();
  expect(first.status).toBe('succeeded');
  expect(first.output.entries).toHaveLength(4);
  const urls = execute.mock.calls.map(([input]) => input.repository.url);
  expect(urls.filter(url => url.includes('stablyai/orca'))).toHaveLength(2);
  expect(urls.filter(url => url.includes('example/other'))).toHaveLength(2);
  expect(urls[0]).not.toBe(urls[1]);
  expect(urls[2]).not.toBe(urls[3]);
  const sameDay = await run();
  expect(sameDay.status).toBe('succeeded');
  expect(sameDay.output.entries).toHaveLength(4);
  expect(sameDay.counts.already_processed).toBe(0);
  for (const url of ['stablyai/orca', 'example/other']) {
    expect(execute.mock.calls.slice(4).filter(([input]) => input.repository.url.includes(url))).toHaveLength(2);
  }
  vi.setSystemTime(new Date('2026-10-21T02:00:00Z'));
  expect((await run()).output.entries).toHaveLength(4);
  expect(execute.mock.calls.map(([input]) => input.prompt).join('\n')).toContain('数据结构');
});

it('lets each investigation use current source without pinning a shared Commit', async () => {
  getSqliteDatabase().prepare("UPDATE groups SET deep_analysis_count=3 WHERE id='study'").run();
  let ordinal = 0;
  execute.mockImplementation(async input => { const result = reportResult(input, `核心机制${++ordinal}`); latestCommit = 'b'.repeat(40); return result; });
  expect((await run()).output.entries).toHaveLength(3);
  expect(execute.mock.calls.filter(([input]) => input.repository && !input.repository.commit)).toHaveLength(3);
  expect((await sourcesService.getSource('orca'))!.repository_history).toHaveLength(3);
  expect(execute.mock.calls.slice(1, 3).map(([input]) => input.repository.commit)).toEqual([undefined, undefined]);
  expect(processes.runProcess).not.toHaveBeenCalled();
  const second = await run();
  expect(second.status).toBe('succeeded');
  expect(second.output.entries).toHaveLength(3);
  expect((await sourcesService.getSource('orca'))!.repository_history!.filter(item => item.commit === 'b'.repeat(40))).toHaveLength(5);
  expect(second.counts.already_processed).toBe(0);
  expect(execute.mock.calls.filter(([input]) => input.repository && !input.repository.commit)).toHaveLength(6);
  expect((await sourcesService.getSource('orca'))!.repository_history).toHaveLength(6);
  expect(execute.mock.calls[3][0].repository_context.history).toHaveLength(3);
});

it('refreshes new investigations after code, goal, prompt and Skill updates; keeps archived reports', async () => {
  expect((await run()).status).toBe('succeeded');
  const db = getSqliteDatabase();
  const first = db.prepare('SELECT request_hash FROM research_tasks').get() as { request_hash: string };
  const history = (await sourcesService.getSource('orca'))!.repository_history!;
  await sourcesService.saveSource({ id: 'orca', name: 'Orca', url: 'https://github.com/stablyai/orca', options: { research_focus: '恢复语义' } });
  latestCommit = 'b'.repeat(40);
  const previous = prompts.buildCodeResearchPrompt;
  vi.spyOn(prompts, 'buildCodeResearchPrompt').mockImplementation(instructions => previous(instructions) + '\n具体解释恢复的失败分支。');
  vi.mocked(skillsService.getSkill).mockResolvedValue({ id: 'github-code-research', name: 'Code', type: 'research', revision: 'v2', description: '', tags: [], file_path: '', system_prompt: '' });
  execute.mockImplementationOnce(async input => reportResult(input, '恢复机制'));
  vi.setSystemTime(new Date('2026-10-21T02:00:00Z'));
  expect((await run()).status).toBe('succeeded');
  expect(execute.mock.calls[1][0].repository.commit).toBeUndefined();
  expect(execute.mock.calls[1][0].prompt).toContain('恢复语义');
  expect(execute.mock.calls[1][0].prompt).toContain('核心执行架构');
  expect(execute.mock.calls[1][0].material).not.toContain('README');
  const hashes = db.prepare('SELECT request_hash FROM research_tasks').all() as Array<{ request_hash: string }>;
  expect(hashes[1].request_hash).not.toBe(first.request_hash);
  const next = (await sourcesService.getSource('orca'))!.repository_history!;
  expect(next.find(item => item.article_id === history[0].article_id)).toEqual(history[0]);
});

it('preserves a failed archive snapshot and path across goal, code and prompt changes', async () => {
  vi.mocked(GitHubClient.syncFiles).mockResolvedValueOnce({ status: 'failed', changedPaths: [], errorMessage: 'offline' });
  expect((await run()).status).toBe('failed');
  const before = (await sourcesService.getSource('orca'))!.repository_history![0];
  expect(before.status).toBe('awaiting_archive');
  expect(before.error).toBe('offline');
  await sourcesService.saveSource({ id: 'orca', name: 'Orca', url: 'https://github.com/stablyai/orca', options: { research_focus: '新的目标' } });
  execute.mockRejectedValue(new Error('Executor must not run during publication retry'));
  vi.mocked(skillsService.getSkill).mockResolvedValue(null);
  vi.setSystemTime(new Date('2026-10-21T02:00:00Z'));
  expect((await run()).status).toBe('succeeded');
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls.filter(([input]) => input.repository && !input.repository.commit)).toHaveLength(1);
  expect((await sourcesService.getSource('orca'))!.repository_history![0]).toMatchObject({ article_id: before.article_id, commit: before.commit, status: 'completed' });
});

it('accepts reports without evidence.json or exact citation metadata and shares them with later research', async () => {
  execute.mockImplementationOnce(async input => ({ ...reportResult(input), artifacts: [], repository: undefined }));
  expect((await run()).status).toBe('succeeded');
  expect((await sourcesService.getSource('orca'))!.repository_history![0].status).toBe('completed');
  expect((await run()).status).toBe('succeeded');
  expect(execute.mock.calls[1][0].repository_context.history).toHaveLength(1);
  expect(execute.mock.calls[1][0].prompt).toContain('后续自主深研');
});

it('serializes the same repository with concurrent executors and includes accepted reports from this batch in history', async () => {
  getSqliteDatabase().prepare("UPDATE groups SET deep_analysis_count=2 WHERE id='study'").run();
  vi.mocked(ai.getAIAdapterWithFallback).mockReturnValue({ execute, testConnection: async () => ({ ok: true, message: 'mock' }), targets: [{ target: { execution: { concurrency: 4 } } }] } as any);
  let ordinal = 0, active = 0, peak = 0;
  execute.mockImplementation(async input => {
    active++;
    peak = Math.max(peak, active);
    const current = ++ordinal;
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return reportResult(input, `批内机制${current}`);
  });
  expect((await run()).status).toBe('succeeded');
  expect(peak).toBe(1);
  expect(execute.mock.calls[1][0].prompt).toContain('批内机制1');
  expect(execute.mock.calls[1][0].prompt).toContain('批内机制1');
  expect(execute.mock.calls[0][0].repository_context.history).toEqual([]);
  expect(execute.mock.calls[1][0].repository_context.history[0]).toMatchObject({ title: '批内机制1', questions: [] });
  expect(execute.mock.calls[1][0].repository_context.history[0].report_markdown).toContain('基于源码分析');
});

it('links publication failures before an upload acknowledgement back to source history', async () => {
  vi.mocked(secretsStore.getSecret).mockReturnValue(null);
  expect((await run()).status).toBe('failed');
  const history = (await sourcesService.getSource('orca'))!.repository_history![0];
  expect(history.status).toBe('awaiting_archive');
  expect(history.error).toContain('未配置仓库凭据');
  expect(history.reports).toHaveLength(1);
});

it('uses the same source context builder for prompt preview and runtime, with first-study architecture guidance', async () => {
  const source = (await sourcesService.getSource('orca'))!;
  const context = prompts.repositoryResearchContext(source);
  getSqliteDatabase().prepare("UPDATE groups SET research_instructions='面向工程师，重点用图解释关系' WHERE id='study'").run();
  const result = await run();
  expect(result.status).toBe('succeeded');
  const input = execute.mock.calls[0][0];
  expect(input.repository_context).toEqual(context);
  expect(input.prompt).toBe(prompts.buildCodeResearchPrompt(prompts.buildRepositoryResearchInstructions(context, '面向工程师，重点用图解释关系', { commit: input.repository.commit, study_id: input.articleId })));
  expect(input.prompt).toContain('首次系统研读');
  expect(input.prompt).toContain('历史研读：0 篇已归档');
  expect(input.prompt).toContain(source.options.research_focus);
});

it('delegates fresh manual source preparation to the executor and replaces the original archive', async () => {
  const first = await run();
  const original = first.output.entries[0].article_id;
  const oldTask = (await researchService.listResearchTasks('study'))[0];
  latestCommit = 'b'.repeat(40);
  execute.mockImplementationOnce(async input => reportResult(input, '核心执行架构'));
  const next = await feedService.researchArticle('study', original);
  expect(next.status).toBe('succeeded');
  expect(next.article_id).toBe(original);
  expect(execute.mock.calls[1][0].repository.commit).toBeUndefined();
  expect(execute.mock.calls[1][0].prompt).toContain('用户明确重新调研已有主题');
  expect(execute.mock.calls[1][0].repository_context.history[0].article_id).toBe(original);
  const history = (await sourcesService.getSource('orca'))!.repository_history!;
  expect(history).toHaveLength(1);
  expect(history[0].commit).toBe('b'.repeat(40));
  expect(history[0].reports).toHaveLength(1);
  expect(next.repository_study?.commit).toBe('b'.repeat(40));
  expect((await researchService.listResearchTasks('study')).find(task => task.id === oldTask.id)).toEqual(oldTask);
  const files = vi.mocked(GitHubClient.syncFiles).mock.calls[1][0].files;
  expect(files.some(file => file.path === 'docs/xxx/stablyai@orca/01-核心执行架构.md')).toBe(true);
  expect(files.some(file => file.path.includes('/02-'))).toBe(false);
  expect(getSqliteDatabase().prepare('SELECT count(*) n FROM article_locations').get()).toEqual({ n: 1 });
  const feed = await feedService.getDailyFeed('study');
  const delivered = feed.deep_articles.find(item => item.id === next.article_id)!;
  expect(delivered.summary).toBeTruthy();
  expect(delivered.sources[0].id).toBe('orca');
  expect(delivered.research?.wiki_url).toBeTruthy();
  expect(delivered.research?.report_markdown).toContain('b'.repeat(40));
});

it('automatically retries archive delivery without Git refresh or report regeneration', async () => {
  const first = await run();
  const original = first.output.entries[0].article_id;
  latestCommit = 'b'.repeat(40);
  vi.mocked(GitHubClient.syncFiles).mockResolvedValueOnce({ status: 'failed', changedPaths: [], errorMessage: 'archive offline' });
  await expect(feedService.researchArticle('study', original)).rejects.toThrow('归档失败');
  const pending = (await sourcesService.getSource('orca'))!.repository_history!.find(item => item.status === 'awaiting_archive')!;
  expect(pending).toBeTruthy();
  execute.mockRejectedValue(new Error('Executor must not run during publication retry'));
  const retry = await run();
  expect(retry.output.entries[0].article_id).toBe(pending.article_id);
  expect(retry.status, JSON.stringify(retry)).toBe('succeeded');
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls.filter(([input]) => input.repository && !input.repository.commit)).toHaveLength(2);
  const attempts = vi.mocked(GitHubClient.syncFiles).mock.calls.slice(1).map(([input]) => input.files.filter(file => file.path.includes('/01-')).map(file => file.path));
  expect(attempts[1]).toEqual(attempts[0]);
  expect((await sourcesService.getSource('orca'))!.repository_history).toHaveLength(1);
});

it('preserves earlier approved reports when manual preparation fails on the executor', async () => {
  const first = await run();
  const original = first.output.entries[0].article_id;
  const before = (await sourcesService.getSource('orca'))!.repository_history;
  execute.mockResolvedValueOnce({ status: 'failed', provider: 'mock', model: 'mock', durationMs: 1, error: { code: 'execution_failed', message: 'Git unavailable on executor' } });
  expect((await feedService.researchArticle('study', original)).status).toBe('failed');
  expect(execute).toHaveBeenCalledTimes(2);
  const after = (await sourcesService.getSource('orca'))!.repository_history!;
  expect(after).toHaveLength(before!.length);
  expect(after[0].reports).toEqual(before![0].reports);
  expect(getSqliteDatabase().prepare('SELECT count(*) n FROM research_claims').get()).toEqual({ n: 0 });
});





it('recovers saved reports without another AI call and includes them in later repository context', async () => {
  let traceId = '';
  const markdown = '# 已保存的 Orca 架构研报\n\n真实研读结果，不需要重新生成。';
  execute.mockImplementationOnce(async input => {
    const folder = fs.mkdtempSync(path.join(getAppPaths().dataDir, 'saved-report-'));
    fs.mkdirSync(path.join(folder, 'output/assets'), { recursive: true });
    fs.mkdirSync(path.join(folder, 'input'));
    fs.writeFileSync(path.join(folder, 'output/research.md'), markdown);
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ job_id: input.jobId }));
    fs.writeFileSync(path.join(folder, 'input/repository.json'), JSON.stringify({ url: input.repository.url, commit: 'informational-version' }));
    fs.writeFileSync(path.join(folder, 'output/assets/architecture.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const execution = { workspace: folder, mode: 'native' as const, prompt: input.prompt, skill_id: 'github-code-research' };
    traceId = executionLogs.start(input);
    executionLogs.attempts(traceId, [{ index: 1, profile_id: 'mock', executor_name: 'Codex', provider: 'codex_cli', transport: 'local', model: 'mock', timeout_seconds: 30, queue_timeout_seconds: 30, started_at: new Date().toISOString(), status: 'failed', execution, error: { code: 'execution_failed', message: 'old evidence gate rejected output' } }]);
    const failed = { status: 'failed' as const, provider: 'mock', model: 'mock', durationMs: 1, execution, error: { code: 'execution_failed', message: 'old evidence gate rejected output' } };
    executionLogs.finish(traceId, failed, 1);
    return failed;
  });
  expect((await run()).status).toBe('failed');
  const original = (await researchService.listResearchTasks('study'))[0];
  const retry = await run();
  expect(retry.status).toBe('succeeded');
  expect(execute).toHaveBeenCalledTimes(1);
  expect(retry.output.entries[0].article_id).toBe(original.article_id);
  const accepted = (await researchService.listResearchTasks('study')).find(task => task.id === original.id)!;
  expect(accepted.status).toBe('succeeded');
  expect(accepted.report_markdown).toBe(markdown);
  expect(accepted.archived_at).toBeTruthy();
  const log = executionLogs.get(traceId)!;
  expect(log.status).toBe('success');
  expect(log.output).toBe(markdown);
  expect(log.attempts[0].error?.message).toContain('old evidence');
  expect(log.attempts.at(-1)).toMatchObject({ phase: 'recovery', report_reused: true, resumed: false, duration_ms: 0 });
  expect((await run()).status).toBe('succeeded');
  expect(execute.mock.calls[1][0].repository_context.history[0].report_markdown).toBe(markdown);
  expect(execute.mock.calls[1][0].prompt).toContain('后续自主深研');
});

it('stops queued same-repository research when the preceding report fails', async () => {
  getSqliteDatabase().prepare("UPDATE groups SET deep_analysis_count=2 WHERE id='study'").run();
  vi.mocked(ai.getAIAdapterWithFallback).mockReturnValue({ execute, testConnection: async () => ({ ok: true, message: '' }), targets: [{ target: { execution: { concurrency: 4 } } }] } as any);
  execute.mockResolvedValue({ status: 'failed', provider: 'mock', model: 'mock', durationMs: 1, error: { code: 'offline', message: 'executor offline' } });
  expect((await run()).status).toBe('failed');
  expect(execute).toHaveBeenCalledTimes(1);
});

it('archives completed reports even when another repository in the batch fails', async () => {
  await sourcesService.saveSource({ id: 'other', name: 'Other', url: 'https://github.com/example/other', capability_id: 'github_repository' });
  getSqliteDatabase().prepare("INSERT INTO group_sources(group_id,source_id) VALUES ('study','other')").run();
  vi.mocked(ai.getAIAdapterWithFallback).mockReturnValue({ execute, testConnection: async () => ({ ok: true, message: '' }), targets: [{ target: { execution: { concurrency: 2 } } }] } as any);
  execute.mockImplementation(async input => input.repository.url.includes('stablyai/orca') ? { status: 'failed', provider: 'mock', model: 'mock', durationMs: 1, error: { code: 'offline', message: 'Orca offline' } } : reportResult(input));
  const result = await run();
  expect(result.status).toBe('partial');
  expect(result.ai_logs.some(log => log.status === 'failed')).toBe(true);
  expect(GitHubClient.syncFiles).toHaveBeenCalledOnce();
  expect((await sourcesService.getSource('other'))!.repository_history![0].status).toBe('completed');
});
