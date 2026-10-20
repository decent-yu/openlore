import crypto from "node:crypto";
import fs from "node:fs";
import {
  ArticleSelectionSchema,
  buildSelectionPrompt,
  repositoryStudy,
  type Decision,
  type Group,
  type RunAILog,
  type StructuredEntry,
} from "@openlore/contracts";
import { getAIAdapterWithFallback } from "../../infrastructure/ai/fallback_runner.js";
import { executionLogs } from "../../infrastructure/ai/execution_logs.js";
import { mediaAssetsArchiver } from "../../infrastructure/media_assets/archiver.js";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { claimResearchArticle } from "../research/state.js";
import { skillsService } from "../skills/service.js";
import { listPoolCandidates } from "./candidates.js";
import { getArticleReviews } from "./article-reviews.js";
import { sourcesService } from '../sources/service.js';
import { collectionService } from '../collection/service.js';

export interface ProcessedBatchResult {
  decisions: Decision[];
  entries: StructuredEntry[];
  aiLogs: RunAILog[];
  counts: {
    observed: number;
    already_processed: number;
    candidate: number;
    planned: number;
    excluded: number;
    deferred: number;
    unreviewed: number;
  };
}
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40) || "article"
  );
}
const MATERIAL_LIMIT = 48000;
type Candidate = {
  article_id: string;
  title: string;
  quality: number;
  positioning: string;
  summary: string;
  tags: string[];
};
function batches(items: Candidate[]): Candidate[][] {
  const result: Candidate[][] = [];
  let current: Candidate[] = [],
    size = 2;
  for (const item of items) {
    const length = JSON.stringify(item).length + 1;
    if (length > MATERIAL_LIMIT)
      throw new Error(`文章 ${item.article_id} 的初审资料过长，请重新初审`);
    if (size + length > MATERIAL_LIMIT && current.length) {
      result.push(current);
      current = [];
      size = 2;
    }
    current.push(item);
    size += length;
  }
  if (current.length) result.push(current);
  return result;
}

export class ProcessingService {
  async runProcessingForGroup(
    group: Group,
    runId: string,
  ): Promise<ProcessedBatchResult> {
    const db = getSqliteDatabase();
    // Collect today's repository study before selection; an unchanged commit can still teach a new topic.
    for (const source of await sourcesService.listSources()) {
      if (source.enabled && source.capability_id === 'github_repository' && (!group.source_ids.length || group.source_ids.includes(source.id))) {
        const collected = await collectionService.discoverSource(source.id);
        if (collected.status === 'failed') throw new Error(collected.errors[0]?.message || 'GitHub 仓库采集失败');
      }
    }
    const pool = listPoolCandidates(group.source_ids);
    const result: ProcessedBatchResult = {
      decisions: [],
      entries: [],
      aiLogs: [],
      counts: {
        observed: pool.length,
        already_processed: 0,
        candidate: 0,
        planned: 0,
        excluded: 0,
        deferred: 0,
        unreviewed: 0,
      },
    };
    const save = () =>
      db
        .prepare("UPDATE runs SET counts_json=?,ai_logs_json=? WHERE id=?")
        .run(
          JSON.stringify(result.counts),
          JSON.stringify(result.aiLogs),
          runId,
        );
    const reviews = getArticleReviews(pool.map((item) => item.id));
    const candidates: Candidate[] = [];
    const repositoryChoices: Array<{ article_id: string; reason: string }> = [];
    for (const item of pool) {
      if (item.processed || item.busy) {
        result.counts.already_processed++;
        continue;
      }
      const review = reviews.get(item.id);
      const article = db.prepare('SELECT title,date_evidence_json FROM articles WHERE id=?').get(item.id) as { title: string; date_evidence_json: string };
      if (repositoryStudy(JSON.parse(article.date_evidence_json))) {
        repositoryChoices.push({ article_id: item.id, reason: '每日仓库研读：探索架构设计与核心思想' });
        continue;
      }
      if (review?.status !== "succeeded" || !review.result) {
        result.counts.unreviewed++;
        continue;
      }
      candidates.push({
        article_id: item.id,
        title: article.title,
        quality: review.result.quality,
        positioning: review.result.positioning,
        summary: review.result.summary,
        tags: review.result.tags,
      });
    }
    result.counts.candidate = candidates.length + repositoryChoices.length;
    result.counts.deferred = result.counts.candidate;
    save();
    // Pipelines never trigger per-article initial reviews. M=0 consumes no selection/research AI.
    if ((!candidates.length && !repositoryChoices.length) || group.deep_analysis_count === 0) return result;
    const dailyChoices = repositoryChoices.slice(0, group.deep_analysis_count);
    const selectionLimit = group.deep_analysis_count - dailyChoices.length;
    const adapter = getAIAdapterWithFallback(group.ai_profile_id);
    if (!adapter) throw new Error("调研失败：请先配置可用的 AI 执行器");
    const skill = await skillsService.getSkill(
      group.selection_skill_id,
      group.ai_profile_id || "default",
    );
    if (candidates.length && selectionLimit && (!skill || skill.type !== "selection"))
      throw new Error(`选文 Skill 不存在：${group.selection_skill_id}`);
    const prompt = buildSelectionPrompt(group.selection_skill_id, { ...group, deep_analysis_count: selectionLimit });
    let sequence = 0;
    const select = async (batch: Candidate[]) => {
      const response = await adapter.execute({
        jobId: `${runId}_select_${++sequence}`,
        runId,
        groupId: group.id,
        profileId: group.ai_profile_id || "default",
        taskType: "select",
        skillId: group.selection_skill_id,
        skillRevision: skill?.revision,
        prompt,
        material: JSON.stringify(batch),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            selected: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  article_id: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["article_id", "reason"],
              },
            },
          },
          required: ["selected"],
        },
      });
      const log: RunAILog = {
        timestamp: new Date().toISOString(),
        task_type: "select",
        skill_id: group.selection_skill_id,
        model: response.model,
        execution: response.execution,
        prompt_preview: prompt,
        response_preview: JSON.stringify(response.result || response.error),
        status: response.status,
      };
      result.aiLogs.push(log);
      save();
      if (response.status !== "success")
        throw new Error(response.error?.message || "批量选文失败");
      const parsed = ArticleSelectionSchema.safeParse(response.result);
      const allowed = new Set(batch.map((item) => item.article_id));
      const selected = parsed.success ? parsed.data.selected : [];
      if (
        !parsed.success ||
        selected.length > selectionLimit ||
        new Set(selected.map((item) => item.article_id)).size !==
          selected.length ||
        selected.some((item) => !allowed.has(item.article_id))
      ) {
        const message =
          "选文结果无效：包含未知或重复文章、缺少理由，或超过 M 篇";
        executionLogs.invalidate(response.trace_id, message);
        log.status = "invalid_output";
        save();
        throw new Error(message);
      }
      return selected;
    };
    let remaining = selectionLimit ? candidates : [];
    let selected: Array<{ article_id: string; reason: string }> = [];
    while (remaining.length) {
      const groups = batches(remaining);
      const shortlists: typeof selected = [];
      for (const batch of groups) shortlists.push(...(await select(batch)));
      if (groups.length === 1) {
        selected = shortlists;
        break;
      }
      const ids = new Set(shortlists.map((item) => item.article_id));
      const reduced = remaining.filter((item) => ids.has(item.article_id));
      if (reduced.length >= remaining.length)
        throw new Error(
          "候选资料超过单次选文容量，且分批初选未缩减；请减少 M 或缩小来源范围后重试",
        );
      remaining = reduced;
    }
    // Validate all selection IDs before claiming or reading full articles.
    for (const choice of [...dailyChoices, ...selected]) {
      const article = db
        .prepare("SELECT * FROM articles WHERE id=?")
        .get(choice.article_id) as {
        id: string;
        title: string;
        latest_revision: string;
        canonical_url: string | null;
        date_evidence_json: string;
        author: string | null;
        published_at: string | null;
      };
      const revision = db
        .prepare(
          "SELECT content_ref FROM article_revisions WHERE article_id=? AND revision_hash=?",
        )
        .get(article.id, article.latest_revision) as
        { content_ref: string } | undefined;
      const study = repositoryStudy(JSON.parse(article.date_evidence_json));
      const review = reviews.get(article.id);
      const current = getArticleReviews([article.id]).get(article.id);
      if (!study && (
        !current ||
        current.status !== "succeeded" ||
        JSON.stringify(current) !== JSON.stringify(review)
      ))
        throw new Error(`文章 ${article.title} 的初审结果已变化，请重新选文`);
      if (!revision)
        throw new Error(`内容池文章 ${article.id} 的正文版本不存在`);
      const content = fs.readFileSync(revision.content_ref, "utf8");
      if (!claimResearchArticle(article.id, group.id, runId)) continue;
      const sources = (
        db
          .prepare(
            "SELECT DISTINCT source_id FROM source_items WHERE article_id=?",
          )
          .all(article.id) as { source_id: string }[]
      ).map((row) => row.source_id);
      result.decisions.push({
        article_id: article.id,
        revision: article.latest_revision,
        decision: "qualified",
        reason: choice.reason,
        matched_source_ids: sources,
      });
      const assetRefs: string[] = [],
        urlMap = new Map<string, string>();
      for (const match of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        if (!/^https?:/.test(match[1])) continue;
        const asset = await mediaAssetsArchiver.archiveImage(
          match[1],
          "diagram",
        );
        if (asset.status !== "downloaded" || !asset.relativePath) continue;
        urlMap.set(match[1], asset.relativePath);
        assetRefs.push(asset.relativePath);
        db.prepare(
          "INSERT OR IGNORE INTO media_assets(id,article_id,original_url,local_path,sha256,mime_type,size_bytes,blob_ref,status) VALUES (?,?,?,?,?,?,?,?,?)",
        ).run(
          asset.assetId,
          article.id,
          match[1],
          asset.relativePath,
          asset.sha256,
          asset.mimeType,
          asset.sizeBytes,
          asset.blobRef,
          "downloaded",
        );
      }
      result.entries.push({
        article_id: article.id,
        revision: article.latest_revision,
        slug: slugify(article.title),
        title: article.title,
        original_url: study?.repository_url || article.canonical_url,
        author: article.author,
        published_at: article.published_at,
        tags: study ? ['GitHub', '架构研读'] : review!.result!.tags,
        summary: study ? (study.focus || '深入探索架构设计、核心机制与可复用思想') : review!.result!.summary,
        organized_markdown: mediaAssetsArchiver.rewriteMarkdownImageUrls(
          content,
          urlMap,
        ),
        asset_refs: assetRefs,
        evidence_refs: study ? study.files : review!.result!.evidence_refs,
        limitations: [],
      });
      const prior = db
        .prepare("SELECT id FROM group_items WHERE group_id=? AND article_id=?")
        .get(group.id, article.id) as { id: string } | undefined;
      if (prior)
        db.prepare(
          "UPDATE group_items SET revision_hash=?,rules_revision='batch-selection-v1',decision='qualified',reason=?,matched_source_ids_json=?,updated_at=? WHERE id=?",
        ).run(
          article.latest_revision,
          choice.reason,
          JSON.stringify(sources),
          new Date().toISOString(),
          prior.id,
        );
      else
        db.prepare(
          "INSERT INTO group_items(id,group_id,article_id,revision_hash,rules_revision,decision,reason,matched_source_ids_json,updated_at) VALUES (?,?,?,?,'batch-selection-v1','qualified',?,?,?)",
        ).run(
          `gi_${crypto.randomUUID()}`,
          group.id,
          article.id,
          article.latest_revision,
          choice.reason,
          JSON.stringify(sources),
          new Date().toISOString(),
        );
    }
    result.counts.planned = result.entries.length;
    result.counts.deferred = result.counts.candidate - result.entries.length;
    save();
    return result;
  }
}
export const processingService = new ProcessingService();
