import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildTranslationPrompt } from "@openlore/contracts";
import { getAIAdapterWithFallback } from "../../infrastructure/ai/fallback_runner.js";
import { executionLogs } from "../../infrastructure/ai/execution_logs.js";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { getAppPaths } from "../../infrastructure/config/paths.js";

export const CHINESE_ARTICLE_FILENAME = "article-zh-CN.md";

/** Accept usable Markdown; formatting differences are not translation failures. */
export function validateTranslation(_source: string, result: unknown): string {
  let value = result;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { /* Plain Markdown is also a usable translation. */ }
  }
  const markdown = typeof value === 'string' ? value : (value as { markdown?: unknown } | null)?.markdown;
  if (typeof markdown !== 'string' || !markdown.trim())
    throw new Error('中文翻译失败：未返回可用译文');
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
    if (fs.existsSync(cache)) {
      try { return validateTranslation(markdown, JSON.parse(fs.readFileSync(cache, 'utf8'))); }
      catch { /* A bad cache must not prevent reuse of a valid logged output. */ }
    }

    // Old format checks could reject a complete translation after a successful AI call.
    // Match the exact source to avoid reusing a translation for changed article content.
    const logs = getSqliteDatabase().prepare(`SELECT id FROM ai_execution_logs
      WHERE task_type='translate' AND article_id=? AND status IN ('success','invalid_output','failed')
      ORDER BY started_at DESC,rowid DESC`).all(articleId) as { id: string }[];
    for (const row of logs) {
      const log = executionLogs.get(row.id)!;
      if (log.input.material !== markdown) continue;
      if (log.status === 'success' && log.input.prompt !== prompt) continue;
      try {
        const translated = validateTranslation(markdown, log.output);
        fs.writeFileSync(cache, JSON.stringify({ markdown: translated }));
        if (log.status !== 'success') {
          const attempt = [...log.attempts].reverse().find(attempt => attempt.status === 'success');
          executionLogs.recover(log.id, {
            status: 'success', provider: attempt?.provider || 'saved', model: attempt?.model || 'saved', durationMs: 0,
            result: { markdown: translated }, execution: attempt?.execution,
            notice: '已接纳此前生成的中文译文，排版差异不再拦截归档；未重新调用 AI。',
          });
        }
        return translated;
      } catch { /* Empty or malformed previous outputs do not prevent a fresh translation. */ }
    }

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
    if (response.status !== "success" && !response.result)
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
    if (response.status !== 'success' && response.trace_id) executionLogs.recover(response.trace_id, { ...response, status: 'success', result: { markdown: translated }, notice: 'AI 调用异常但保留了可用译文，已接纳并用于归档。' });
    return translated;
  }
}

export const articleTranslationService = new ArticleTranslationService();
