import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildTranslationPrompt } from "@openlore/contracts";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { getAIAdapterWithFallback } from "../../infrastructure/ai/fallback_runner.js";
import { executionLogs } from "../../infrastructure/ai/execution_logs.js";
import { getAppPaths } from "../../infrastructure/config/paths.js";

export const CHINESE_ARTICLE_FILENAME = "article-zh-CN.md";

// Only visible prose may change. Preserve images, URLs, code, HTML and GFM structure.
function structure(markdown: string): string {
  return JSON.stringify(
    fromMarkdown(markdown, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }),
    function (key, value) {
      if (key === "position") return undefined;
      if (key === "value" && this.type === "text") return "";
      if (key === "title" && this.type === "link") return null;
      return value;
    },
  );
}

export function validateTranslation(source: string, result: unknown): string {
  const markdown = (result as { markdown?: unknown } | null)?.markdown;
  if (typeof markdown !== "string" || !markdown.trim())
    throw new Error("中文翻译失败：未返回完整译文");
  if (structure(source) !== structure(markdown))
    throw new Error("中文翻译失败：译文改变了原文结构、图片、链接或代码");
  return markdown;
}

export class ArticleTranslationService {
  async translate(options: {
    markdown: string;
    articleId: string;
    articleTitle: string;
    groupId: string;
    runId: string;
    profileId?: string | null;
  }): Promise<string> {
    const { markdown, articleId, articleTitle, groupId, runId, profileId } =
      options;
    const prompt = buildTranslationPrompt();
    // Publication retries reuse the same translation without another AI call.
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify([prompt, markdown]))
      .digest("hex");
    const cache = path.join(getAppPaths().blobsDir, `translation-${hash}.json`);
    if (fs.existsSync(cache))
      return validateTranslation(
        markdown,
        JSON.parse(fs.readFileSync(cache, "utf8")),
      );

    const adapter = getAIAdapterWithFallback(profileId);
    if (!adapter) throw new Error("中文翻译失败：请先配置可用的 AI 执行器");
    const response = await adapter.execute({
      jobId: `translation_${crypto.randomUUID()}`,
      runId,
      groupId,
      articleId,
      articleTitle,
      profileId: profileId || "default",
      taskType: "translate",
      prompt,
      material: markdown,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { markdown: { type: "string" } },
        required: ["markdown"],
      },
    });
    if (response.status !== "success")
      throw new Error(
        `中文翻译失败：${response.error?.message || "AI 执行失败"}`,
      );
    let translated: string;
    try {
      translated = validateTranslation(markdown, response.result);
    } catch (error) {
      executionLogs.invalidate(response.trace_id, (error as Error).message);
      throw error;
    }
    fs.writeFileSync(cache, JSON.stringify({ markdown: translated }));
    return translated;
  }
}

export const articleTranslationService = new ArticleTranslationService();
