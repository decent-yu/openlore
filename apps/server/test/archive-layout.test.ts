import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import type {
  ArtifactBundle,
  ResearchTask,
  StructuredEntry,
} from "@openlore/contracts";
import {
  initDatabase,
  getSqliteDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";
import { groupsService } from "../src/modules/groups/service.js";
import { deliveryService } from "../src/modules/delivery/service.js";
import { articleSlug } from "../src/modules/delivery/archive-layout.js";
import { GitHubClient } from "../src/infrastructure/repositories/github/client.js";
import { secretsStore } from "../src/infrastructure/secrets/local_file/secrets_store.js";
import { articleTranslationService } from "../src/modules/delivery/translation.js";

const entry = (
  id: string,
  title: string,
  tags: string[] = [],
): StructuredEntry => ({
  article_id: id,
  title,
  slug: articleSlug(title),
  original_url: `https://example.com/${id}`,
  revision: "v1",
  tags,
  summary: "Summary",
  organized_markdown: "Article body",
  asset_refs: [],
  evidence_refs: [],
  limitations: [],
});
const read = (bundle: ArtifactBundle, name: string) =>
  Buffer.from(
    bundle.files.find((file) => file.path === `docs/agent-learning/${name}`)!
      .content_bytes!,
    "base64",
  ).toString("utf8");
beforeAll(() => initDatabase());
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T02:00:00Z"));
  getSqliteDatabase().exec(
    "DELETE FROM artifact_bundles; DELETE FROM deliveries; DELETE FROM article_locations; DELETE FROM collections; DELETE FROM groups; DELETE FROM repository_connections",
  );
  getSqliteDatabase()
    .prepare(
      "INSERT INTO repository_connections(id,name,revision,owner,repo,default_branch,credential_ref) VALUES ('repo','Repo','v1','example','archive','main','token')",
    )
    .run();
  await groupsService.saveGroup({
    id: "learning",
    name: "Agent 学习",
    repository_connection_id: "repo",
    base_path: "docs/agent-learning",
  });
  vi.spyOn(secretsStore, "getSecret").mockReturnValue("test");
  vi.spyOn(articleTranslationService, "translate").mockImplementation(
    async ({ markdown }) => markdown.replace("Article body", "文章正文"),
  );
  vi.spyOn(GitHubClient, "syncFiles").mockImplementation(async (options) => ({
    status: "updated",
    changedPaths: options.files.map((file) => file.path),
    commitSha: "commit",
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function deliver(
  entries: StructuredEntry[],
  researchTasks: ResearchTask[] = [],
) {
  return deliveryService.buildAndDeliverBatch({
    group: (await groupsService.getGroup("learning"))!,
    runId: "run",
    entries,
    researchTasks,
  });
}

it("stores the three real article subjects independently of batches and links every navigation page", async () => {
  const { bundle } = await deliver([
    {
      ...entry(
        "cost",
        "Cutting our inference bill by 68% by being obsessive about optimization",
      ),
      slug: "inference-cost-optimization",
    },
    {
      ...entry("eval", "The Most Common Questions About Agent Evals, Answered"),
      slug: "agent-evals-faq",
    },
    {
      ...entry(
        "numan",
        "How Numan Built an Eval-First AI Health Coach with LangGraph and LangSmith",
      ),
      slug: "numan-ai-health-coach",
    },
  ]);
  expect(bundle.entries.map((entry) => entry.directory)).toEqual([
    "articles/20261020-inference-cost-optimization",
    "articles/20261020-agent-evals-faq",
    "articles/20261020-numan-ai-health-coach",
  ]);
  expect(bundle.files.some((file) => file.path.includes("/topics/"))).toBe(
    false,
  );
  expect(read(bundle, "README.md")).toContain("最近收录（3 篇）");
  expect(read(bundle, "README.md")).toContain("最近更新");
  expect(read(bundle, "README.md")).toContain("batches/20261020-01.md");
  for (const article of bundle.entries) {
    expect(read(bundle, `${article.directory}/README.md`)).toContain(
      "[阅读简体中文](article-zh-CN.md)",
    );
    expect(read(bundle, `${article.directory}/article-zh-CN.md`)).toContain(
      "文章正文",
    );
    expect(read(bundle, "README.md")).toContain(
      `${article.directory}/article-zh-CN.md`,
    );
  }
  const paths = new Set(bundle.files.map((file) => file.path));
  for (const file of bundle.files.filter((file) => file.path.endsWith(".md"))) {
    const text = Buffer.from(file.content_bytes!, "base64").toString("utf8");
    for (const match of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const { posix } = await import("node:path");
      expect(
        paths.has(
          posix.normalize(
            `${posix.dirname(file.path)}/${decodeURIComponent(match[1])}`,
          ),
        ),
        `${file.path}: ${match[1]}`,
      ).toBe(true);
    }
  }
});

it("preserves earlier articles, batches and managed files when delivering the next collection", async () => {
  const first = (await deliver([entry("one", "Agent Evals")])).bundle;
  const second = (await deliver([entry("two", "Inference optimization")]))
    .bundle;
  expect(read(second, "README.md")).toContain("最近收录（2 篇）");
  expect(read(second, "README.md")).toContain("Agent Evals");
  expect(read(second, "README.md")).toContain(
    `${first.entries[0].directory}/article-zh-CN.md`,
  );
  const manifest = JSON.parse(read(second, ".openlore/manifest.json"));
  expect(Object.keys(manifest.collection_locations)).toHaveLength(2);
  expect(
    manifest.managed_files[
      `docs/agent-learning/${first.entries[0].directory}/article.md`
    ],
  ).toBeDefined();
});

it("keeps the same directory after a title change and separates different articles with identical titles", async () => {
  const first = (
    await deliver([entry("one", "Agent Evals"), entry("two", "Agent Evals")])
  ).bundle;
  expect(new Set(first.entries.map((entry) => entry.directory)).size).toBe(2);
  const again = (await deliver([entry("one", "A changed title")])).bundle;
  expect(again.entries[0].directory).toBe(first.entries[0].directory);
  expect(read(again, "README.md")).toContain("A changed title");
});

it("does not promote an unsuccessful collection into subsequent navigation", async () => {
  vi.mocked(GitHubClient.syncFiles).mockResolvedValueOnce({
    status: "failed",
    changedPaths: [],
    errorMessage: "offline",
  });
  await deliver([entry("failed", "Failed article")]);
  const { bundle } = await deliver([entry("ok", "Published article")]);
  expect(read(bundle, "README.md")).not.toContain("Failed article");
});

it("updates article and date navigation when research is added later, and retains it in the next batch", async () => {
  await deliver([entry("one", "Agent Evals")]);
  const task: ResearchTask = {
    id: "research",
    group_id: "learning",
    article_id: "one",
    article_title: "Agent Evals",
    article_slug: "agent-evals",
    status: "succeeded",
    questions: [],
    evidence: [],
    report_markdown: "# Research",
    created_at: new Date().toISOString(),
  };
  await deliveryService.deliverResearchReport(
    (await groupsService.getGroup("learning"))!,
    task,
  );
  const upload = vi.mocked(GitHubClient.syncFiles).mock.calls[1][0];
  const overview = upload.files.find((file) =>
    file.path.endsWith("articles/20261020-agent-evals/README.md"),
  )!;
  expect(Buffer.from(overview.content, "base64").toString()).toContain(
    "research.md",
  );
  expect(Buffer.from(overview.content, "base64").toString()).toContain(
    "article-zh-CN.md",
  );
  const next = (await deliver([entry("two", "Second article")])).bundle;
  expect(read(next, "README.md")).toContain("20261020-agent-evals/research.md");
  const updated = (await deliver([entry("one", "Updated Agent Evals")])).bundle;
  for (const filename of ["article.md", "article-zh-CN.md"]) {
    expect(
      read(updated, `articles/20261020-agent-evals/${filename}`),
    ).toContain("[查看专题调研报告](research.md)");
  }
});

it("keeps Unicode slugs and avoids splitting an English word at the length limit", () => {
  expect(articleSlug("智能体评测：方法与实践")).toBe("智能体评测-方法与实践");
  expect(articleSlug(`${"word ".repeat(18)}tail`)).not.toMatch(/-$|wor$/);
});

it("does not allocate a collection or publish files without articles", async () => {
  const result = await deliver([]);
  expect(result.bundle.files).toEqual([]);
  expect(GitHubClient.syncFiles).not.toHaveBeenCalled();
  expect(
    getSqliteDatabase()
      .prepare("SELECT count(*) AS count FROM collections")
      .get(),
  ).toEqual({ count: 0 });
});

it("uses the group timezone and preserves the first collection date when updating on a later day", async () => {
  vi.setSystemTime(new Date("2026-10-19T16:30:00Z"));
  const original = (
    await deliver([
      { ...entry("one", "First article"), published_at: "1999-01-01" },
    ])
  ).bundle;
  expect(original.entries[0].directory).toBe("articles/20261020-first-article");
  vi.setSystemTime(new Date("2026-10-21T02:00:00Z"));
  await deliver([entry("two", "Second article")]);
  vi.setSystemTime(new Date("2026-10-22T02:00:00Z"));
  const latest = (await deliver([entry("one", "Updated first article")]))
    .bundle;
  expect(latest.entries[0].directory).toBe(original.entries[0].directory);
  const index = read(latest, "README.md");
  const collected = index.split("## 最近更新")[0];
  const updated = index.split("## 最近更新")[1].split("## 采集批次")[0];
  expect(collected.indexOf("Second article")).toBeLessThan(
    collected.indexOf("Updated first article"),
  );
  expect(updated.indexOf("Updated first article")).toBeLessThan(
    updated.indexOf("Second article"),
  );
  const meta = JSON.parse(read(latest, ".openlore/manifest.json"))
    .article_locations.one;
  expect(meta.collected_at).toBe("2026-10-19T16:30:00.000Z");
  expect(meta.updated_at).toBe("2026-10-22T02:00:00.000Z");
});
