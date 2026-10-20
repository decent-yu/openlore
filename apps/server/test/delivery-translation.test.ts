import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { StructuredEntry } from "@openlore/contracts";
import * as prompts from "@openlore/contracts";
import {
  initDatabase,
  getSqliteDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";
import { getAppPaths } from "../src/infrastructure/config/paths.js";
import { deliveryService } from "../src/modules/delivery/service.js";
import { groupsService } from "../src/modules/groups/service.js";
import { GitHubClient } from "../src/infrastructure/repositories/github/client.js";
import { secretsStore } from "../src/infrastructure/secrets/local_file/secrets_store.js";
import * as ai from "../src/infrastructure/ai/fallback_runner.js";

const entry: StructuredEntry = {
  article_id: "article",
  revision: "rev",
  slug: "recovery",
  title: "Durable recovery",
  original_url: "https://example.com/article",
  author: "Original Author",
  published_at: "2026-10-20",
  tags: ["API"],
  summary: "Retry safely.",
  organized_markdown:
    '# Mechanism\n\nSave state.\n\n![Diagram](./assets/original.svg)\n\n```ts\nconst state = "saved";\n```\n\n[Guide](https://example.com/guide)',
  asset_refs: ["assets/original.svg"],
  evidence_refs: [],
  limitations: [],
};
const image = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><text>Original</text></svg>',
);
const translate = (markdown: string) =>
  markdown
    .replace("Durable recovery", "持久化恢复")
    .replace("Retry safely.", "安全地重试。")
    .replace("# Mechanism", "# 工作机制")
    .replace("Save state.", "保存状态。")
    .replace("[Guide]", "[指南]");
const execute = vi.fn(async (input: any) => ({
  status: "success" as const,
  provider: "mock",
  model: "mock",
  durationMs: 1,
  result: { markdown: translate(input.material) },
}));

beforeAll(async () => {
  initDatabase();
  await groupsService.saveGroup({
    id: "task",
    name: "Task",
    repository_connection_id: "repo",
    base_path: "docs/task",
  });
  const db = getSqliteDatabase();
  db.prepare(
    "INSERT INTO repository_connections(id,name,revision,owner,repo,default_branch,credential_ref) VALUES ('repo','Repo','v1','owner','knowledge','main','secret')",
  ).run();
  const blob = path.join(getAppPaths().blobsDir, "original-image");
  fs.writeFileSync(blob, image);
  db.prepare(
    "INSERT INTO media_assets(id,article_id,original_url,local_path,sha256,mime_type,size_bytes,blob_ref,status) VALUES ('asset','article','https://example.com/original.svg','assets/original.svg',?,'image/svg+xml',?,?,'downloaded')",
  ).run(
    crypto.createHash("sha256").update(image).digest("hex"),
    image.length,
    blob,
  );
});
beforeEach(() => {
  const db = getSqliteDatabase();
  db.exec(
    "DELETE FROM deliveries; DELETE FROM artifact_bundles; DELETE FROM article_locations; DELETE FROM collections",
  );
  for (const name of fs.readdirSync(getAppPaths().blobsDir))
    if (name.startsWith("translation-"))
      fs.unlinkSync(path.join(getAppPaths().blobsDir, name));
  execute.mockClear();
  vi.spyOn(ai, "getAIAdapterWithFallback").mockReturnValue({
    execute,
    testConnection: async () => ({ ok: true, message: "mock" }),
  });
  vi.spyOn(secretsStore, "getSecret").mockReturnValue("test-token");
  vi.spyOn(GitHubClient, "syncFiles").mockResolvedValue({
    status: "updated",
    changedPaths: [],
  });
});
afterEach(() => vi.restoreAllMocks());

async function deliver(entries = [entry]) {
  return deliveryService.buildAndDeliverBatch({
    group: (await groupsService.getGroup("task"))!,
    runId: "translation-run",
    entries,
  });
}

it("archives original, full Chinese translation and one shared image with correct manifest hashes", async () => {
  const { bundle } = await deliver();
  const original = bundle.files.find((f) => f.path.endsWith("/article.md"))!;
  const chinese = bundle.files.find((f) =>
    f.path.endsWith("/article-zh-CN.md"),
  )!;
  const decode = (file: typeof original) =>
    Buffer.from(file.content_bytes!, "base64").toString("utf8");
  expect(decode(original)).toContain(entry.organized_markdown);
  expect(decode(chinese)).toBe(translate(decode(original)));
  expect(decode(chinese)).toContain('const state = "saved";');
  expect(decode(chinese)).toContain("Original Author");
  const assets = bundle.files.filter((f) =>
    f.path.endsWith("/assets/original.svg"),
  );
  expect(assets).toHaveLength(1);
  expect(Buffer.from(assets[0].content_bytes!, "base64")).toEqual(image);
  expect(bundle.assets).toHaveLength(1);
  expect(
    decode(bundle.files.find((f) => /\/\d{8}-\d{2}\/README.md$/.test(f.path))!),
  ).toContain("[简体中文](01-recovery/article-zh-CN.md)");
  const manifest = JSON.parse(
    decode(bundle.files.find((f) => f.path.endsWith("/manifest.json"))!),
  );
  expect(manifest.managed_files[chinese.path].sha256).toBe(
    crypto.createHash("sha256").update(decode(chinese)).digest("hex"),
  );
  expect(execute.mock.calls[0][0]).toMatchObject({
    taskType: "translate",
    groupId: "task",
    runId: "translation-run",
    articleId: "article",
  });
  expect(GitHubClient.syncFiles).toHaveBeenCalledTimes(1);
});

it("reuses the translation when retrying a failed GitHub publication", async () => {
  vi.mocked(GitHubClient.syncFiles).mockResolvedValueOnce({
    status: "failed",
    changedPaths: [],
    errorMessage: "offline",
  });
  expect((await deliver()).syncResult.status).toBe("failed");
  expect((await deliver()).syncResult.status).toBe("updated");
  expect(execute).toHaveBeenCalledTimes(1);
  await deliver([
    {
      ...entry,
      organized_markdown: entry.organized_markdown + "\n\nNew paragraph.",
    },
  ]);
  expect(execute).toHaveBeenCalledTimes(2);
});

it("regenerates a cached translation after its writing prompt changes", async () => {
  await deliver();
  const originalPrompt = execute.mock.calls[0][0].prompt;
  const buildPrompt = prompts.buildTranslationPrompt;
  vi.spyOn(prompts, "buildTranslationPrompt").mockImplementation(
    () => `${buildPrompt()}\n补充要求：仔细检查译文语序。`,
  );

  await deliver();
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1][0].material).toBe(
    execute.mock.calls[0][0].material,
  );
  expect(execute.mock.calls[1][0].prompt).not.toBe(originalPrompt);

  // Publication retries still reuse the translation generated with the current rules.
  await deliver();
  expect(execute).toHaveBeenCalledTimes(2);
});

it("stops before creating archive records or publishing if a translation changes an image", async () => {
  execute.mockImplementationOnce(async (input) => ({
    status: "success",
    provider: "mock",
    model: "mock",
    durationMs: 1,
    result: {
      markdown: translate(input.material).replace(
        "./assets/original.svg",
        "./assets/new.svg",
      ),
    },
  }));
  await expect(deliver()).rejects.toThrow("译文改变");
  expect(GitHubClient.syncFiles).not.toHaveBeenCalled();
  for (const table of ["collections", "article_locations", "artifact_bundles"])
    expect(
      getSqliteDatabase().prepare(`SELECT count(*) n FROM ${table}`).get(),
    ).toEqual({ n: 0 });
});

it("reports an unavailable executor and does not publish an English copy as Chinese", async () => {
  vi.mocked(ai.getAIAdapterWithFallback).mockReturnValue(null);
  await expect(deliver()).rejects.toThrow("请先配置可用的 AI 执行器");
  expect(GitHubClient.syncFiles).not.toHaveBeenCalled();
});

it("skips translation and publication for an empty batch", async () => {
  expect((await deliver([])).syncResult.status).toBe("unchanged");
  expect(execute).not.toHaveBeenCalled();
  expect(GitHubClient.syncFiles).not.toHaveBeenCalled();
});
