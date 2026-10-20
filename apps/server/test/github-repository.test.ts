import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { parseGitHubRepository } from "@openlore/contracts";
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
import { feedService } from "../src/modules/feed/service.js";
import { settingsService } from "../src/modules/settings/service.js";

beforeAll(() => initDatabase());
const execute = vi.fn();
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T02:00:00Z"));
  const db = getSqliteDatabase();
  for (const table of [
    "research_claims",
    "research_tasks",
    "runs",
    "group_items",
    "article_reviews",
    "source_items",
    "article_revisions",
    "articles",
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
  execute.mockReset().mockImplementation(async () => ({
    status: "success",
    provider: "mock",
    model: "mock",
    durationMs: 1,
    result:
      "# 核心执行架构\n\n基于源码分析调用链与技术取舍。\n\n![](./assets/architecture.svg)\n\n![](https://example.com/assets/remote.svg)",
  }));
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
  vi.spyOn(SafeHttpClient, "fetch").mockImplementation(async (url) => {
    let body: any;
    if (/\/commits\//.test(url))
      body = { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", commit: { tree: { sha: "tree" } } };
    else if (/\/git\/trees\//.test(url))
      body = {
        tree: [
          { path: "README.md", sha: "readme", type: "blob", size: 100 },
          ...Array.from({ length: 15 }, (_, i) => ({
            path: `src/core-${String(i).padStart(2, "0")}.ts`,
            sha: `blob-${i}`,
            type: "blob",
            size: 100,
          })),
        ],
      };
    else if (/\/git\/blobs\//.test(url))
      body = {
        encoding: "base64",
        content: Buffer.from(
          `export class AgentRunner { async execute() { return 'real code from ${url}'; } }`,
        ).toString("base64"),
      };
    else
      body = {
        default_branch: "development",
        description: "Agent architecture",
      };
    const text = JSON.stringify(body);
    return {
      status: 200,
      text,
      data: Buffer.from(text),
      url,
      headers: {},
      notModified: false,
    };
  });
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

it("collects pinned code once per local day, rotates files without a new commit, and preview does not consume the day", async () => {
  await collectionService.previewSource("orca");
  expect(
    getSqliteDatabase().prepare("SELECT count(*) n FROM source_states").get(),
  ).toEqual({ n: 0 });
  const first = await collectionService.discoverSource("orca");
  expect(first.stats.items_new).toBe(1);
  expect(first.items[0].body.value).toContain("/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/");
  expect(first.items[0].date_evidence).toHaveProperty(
    "repository_study.commit",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const requests = vi.mocked(SafeHttpClient.fetch).mock.calls.length;
  expect((await collectionService.discoverSource("orca")).status).toBe(
    "not_modified",
  );
  expect(vi.mocked(SafeHttpClient.fetch).mock.calls).toHaveLength(requests);
  expect(
    getSqliteDatabase().prepare("SELECT count(*) n FROM article_reviews").get(),
  ).toEqual({ n: 0 });
  vi.setSystemTime(new Date("2026-10-20T16:01:00Z")); // Next calendar day in Asia/Shanghai.
  const next = await collectionService.discoverSource("orca");
  expect(next.stats.items_new).toBe(1);
  expect(next.items[0].canonical_url).not.toBe(first.items[0].canonical_url);
  expect(next.items[0].date_evidence?.repository_study).not.toEqual(
    first.items[0].date_evidence?.repository_study,
  );
  expect(next.items[0].body.value).toContain("core-06.ts");
});

it("runs directly through research and archives numbered topics, source material and valid Wiki links", async () => {
  const first = await run();
  expect(first.status).toBe("succeeded");
  expect(execute.mock.calls.map(([input]) => input.taskType)).toEqual([
    "research_report",
  ]);
  expect(execute.mock.calls[0][0].prompt).toContain("执行器与工作区隔离");
  expect(execute.mock.calls[0][0].skillId).toBe('github-code-research');
  expect(execute.mock.calls[0][0].repository).toEqual({url: 'https://github.com/stablyai/orca', commit: 'a'.repeat(40)});
  expect(execute.mock.calls[0][0].prompt).not.toContain('deep-research-expert');
  expect(first.ai_logs.find(log => log.task_type === 'research')?.skill_id).toBe('github-code-research');
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
  ).toBe(true);
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
  expect(decodeURIComponent(links.article_url!)).toBe(
    "https://wiki.example/vault/xxx/stablyai@orca/articles/01-核心执行架构",
  );
  const sameDay = await run();
  expect(sameDay.output.entries).toHaveLength(0);
  expect(GitHubClient.syncFiles).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date("2026-10-21T02:00:00Z"));
  execute.mockResolvedValueOnce({
    status: "success",
    provider: "mock",
    result: "# 工作区隔离机制\n\n深入分析。",
  });
  expect((await run()).status).toBe("succeeded");
  expect(execute.mock.calls[1][0].prompt).toContain("核心执行架构");
  const nextFiles = vi.mocked(GitHubClient.syncFiles).mock.calls[1][0].files;
  expect(
    nextFiles.some(
      (file) => file.path === "docs/xxx/stablyai@orca/02-工作区隔离机制.md",
    ),
  ).toBe(true);
  const index = Buffer.from(
    nextFiles.find((file) => file.path === "docs/xxx/stablyai@orca/README.md")!
      .content,
    "base64",
  ).toString();
  expect(index).toContain("01-核心执行架构.md");
  expect(index).toContain("02-工作区隔离机制.md");
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

it("uses connection credentials only for API reads and protects a connection referenced by a source", async () => {
  await sourcesService.saveSource({
    id: "orca",
    name: "Orca",
    url: "https://github.com/stablyai/orca",
    options: { github_connection_id: "vault" },
  });
  expect((await run()).status).toBe("succeeded");
  expect(SafeHttpClient.fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test" }),
    }),
  );
  expect(JSON.stringify(execute.mock.calls)).not.toContain("Bearer test");
  expect(
    getSqliteDatabase()
      .prepare("SELECT options_json FROM collection_runs")
      .get(),
  ).not.toHaveProperty("credential_ref");
  await expect(
    settingsService.deleteRepositoryConnection("vault"),
  ).rejects.toThrow("正在使用该 GitHub 读取凭据");
  await expect(
    sourcesService.saveSource({
      name: "Unknown",
      url: "https://github.com/stablyai/orca",
      capability_id: "github_repository",
      options: { github_connection_id: "unknown" },
    }),
  ).rejects.toThrow("读取连接不存在");
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
    name: "仓库研读",
    repository_connection_id: "vault",
    base_path: "docs/xxx",
    source_ids: ["orca", "another"],
    deep_analysis_count: 1,
  });
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

it("leaves the day retryable when GitHub fails and does not generate placeholder reports", async () => {
  vi.mocked(SafeHttpClient.fetch).mockRejectedValueOnce(
    new Error("network down"),
  );
  expect((await run()).status).toBe("failed");
  expect(execute).not.toHaveBeenCalled();
  expect(GitHubClient.syncFiles).not.toHaveBeenCalled();
  expect(
    getSqliteDatabase().prepare("SELECT count(*) n FROM source_states").get(),
  ).toEqual({ n: 0 });
  expect((await run()).status).toBe("succeeded");
});

it('does not fall back to the article Skill when the code research Skill is missing', async () => {
  vi.mocked(skillsService.getSkill).mockImplementation(async id => id === 'github-code-research' ? null : ({id,name:id,type:'selection',description:'',tags:[],file_path:'',system_prompt:''}));
  const result = await run();
  expect(result.status).toBe('failed');
  expect(execute).not.toHaveBeenCalled();
  expect(skillsService.getSkill).not.toHaveBeenCalledWith('deep-research-expert', expect.anything());
});

it('keeps code research reuse independent of article Skill changes', async () => {
  vi.mocked(GitHubClient.syncFiles).mockResolvedValueOnce({status:'failed',changedPaths:[],errorMessage:'offline'});
  expect((await run()).status).toBe('failed');
  getSqliteDatabase().prepare("UPDATE groups SET research_skill_id='another-article-skill' WHERE id='study'").run();
  expect((await run()).status).toBe('succeeded');
  expect(execute).toHaveBeenCalledTimes(1);
});

it('rejects assigning the code Skill to the article research setting', async () => {
  await expect(groupsService.saveGroup({id:'study',name:'Invalid mix',repository_connection_id:'vault',base_path:'docs/xxx',research_skill_id:'github-code-research'})).rejects.toThrow('文章调研 Skill 不能使用');
});
