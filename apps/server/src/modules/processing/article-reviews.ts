import crypto from "node:crypto";
import fs from "node:fs";
import {
  hasReviewableBody,
  reviewBody,
} from "../../infrastructure/content/review-body.js";
import {
  ArticleAssessmentSchema,
  buildAssessmentPrompt,
  type ArticleReview,
} from "@openlore/contracts";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import {
  getAIAdapterWithFallback,
  type FallbackAIAdapter,
} from "../../infrastructure/ai/fallback_runner.js";
import { executionLogs } from "../../infrastructure/ai/execution_logs.js";
import { skillsService } from "../skills/service.js";
import {
  assessmentMaterial,
  hasGroundedEvidence,
  evidenceIssues,
} from "./assessment.js";

const SKILL_ID = "tech-article-extractor";
type ReviewRow = {
  article_id: string;
  revision_hash: string;
  status: ArticleReview["status"];
  result_json: string | null;
  error_message: string | null;
  assessed_at: string | null;
  log_id: string | null;
  material_issue: string | null;
};
export const CURRENT_REVIEW_JOIN = `LEFT JOIN article_reviews review ON review.article_id=a.id AND review.revision_hash=a.latest_revision`;
export function getArticleReviews(
  articleIds: string[],
): Map<string, ArticleReview> {
  if (!articleIds.length) return new Map();
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT review.* FROM articles a ${CURRENT_REVIEW_JOIN}
    WHERE a.id IN (${articleIds.map(() => "?").join(",")}) AND review.article_id IS NOT NULL`,
    )
    .all(...articleIds) as ReviewRow[];
  return new Map(
    rows.map((row) => [
      row.article_id,
      {
        status: row.status,
        result: row.result_json
          ? ArticleAssessmentSchema.parse(JSON.parse(row.result_json))
          : null,
        error_message: row.error_message,
        assessed_at: row.assessed_at,
        log_id: row.log_id,
        material_issue: row.material_issue || undefined,
      },
    ]),
  );
}

export class ArticleReviewsService {
  private draining: Promise<void> | null = null;

  enqueue(articleIds: string[], force = false): number {
    const db = getSqliteDatabase();
    const ids = [...new Set(articleIds)];
    // Validate the entire request before modifying any row.
    const articles = ids.map((id) => {
      const article = db
        .prepare("SELECT id,latest_revision,date_evidence_json FROM articles WHERE id=?")
        .get(id) as { id: string; latest_revision: string | null; date_evidence_json: string } | undefined;
      if (article && JSON.parse(article.date_evidence_json || '{}').repository_study)
        throw Object.assign(new Error('仓库研读无需初审，请直接运行研读任务'), { statusCode: 400 });
      if (!article?.latest_revision)
        throw new Error(`文章 ${id} 缺少正文版本，无法初审`);
      return article;
    });
    return db.transaction(() => {
      let queued = 0;
      for (const article of articles) {
        const row = db
          .prepare(
            "SELECT status FROM article_reviews WHERE article_id=? AND revision_hash=?",
          )
          .get(article.id, article.latest_revision) as
          { status: string } | undefined;
        if (
          row &&
          (["queued", "running"].includes(row.status) ||
            (["succeeded", "insufficient"].includes(row.status) && !force))
        )
          continue;
        db.prepare(
          `INSERT INTO article_reviews(article_id,revision_hash,status,created_at) VALUES (?,?,'queued',?)
          ON CONFLICT(article_id,revision_hash) DO UPDATE SET status='queued',result_json=NULL,error_message=NULL,material_issue=NULL,log_id=NULL,assessed_at=NULL,created_at=excluded.created_at`,
        ).run(article.id, article.latest_revision, new Date().toISOString());
        queued++;
      }
      return queued;
    })();
  }

  recoverInterrupted(): void {
    getSqliteDatabase()
      .prepare(
        "UPDATE article_reviews SET status='failed',error_message='服务重启中断初审，请手动重试' WHERE status='running'",
      )
      .run();
  }

  processPending(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.drain().finally(() => {
      this.draining = null;
      if (this.nextQueued()) return this.processPending();
    });
    return this.draining;
  }

  private nextQueued(): ReviewRow | undefined {
    return getSqliteDatabase()
      .prepare(
        `SELECT r.* FROM article_reviews r
      JOIN articles a ON a.id=r.article_id AND a.latest_revision=r.revision_hash
      WHERE r.status='queued' ORDER BY r.created_at,r.article_id LIMIT 1`,
      )
      .get() as ReviewRow | undefined;
  }

  private async drain(): Promise<void> {
    const db = getSqliteDatabase();
    const active = new Set<Promise<void>>();
    while (true) {
      const adapter = getAIAdapterWithFallback() as FallbackAIAdapter | null;
      const capacity =
        adapter?.targets?.[0]?.target.execution?.concurrency || 1;
      while (active.size < capacity) {
        const row = this.nextQueued();
        if (!row) break;
        if (
          !db
            .prepare(
              "UPDATE article_reviews SET status='running' WHERE article_id=? AND revision_hash=? AND status='queued'",
            )
            .run(row.article_id, row.revision_hash).changes
        )
          continue;
        const work = this.review(row).finally(() => active.delete(work));
        active.add(work);
      }
      if (!active.size) return;
      await Promise.race(active);
    }
  }

  private async review(row: ReviewRow): Promise<void> {
    const db = getSqliteDatabase();
    let logId: string | undefined;
    try {
      const article = db
        .prepare("SELECT title,published_at FROM articles WHERE id=?")
        .get(row.article_id) as {
        title: string;
        published_at: string | null;
      };
      const revision = db
        .prepare(
          "SELECT content_ref FROM article_revisions WHERE article_id=? AND revision_hash=?",
        )
        .get(row.article_id, row.revision_hash) as
        { content_ref: string } | undefined;
      if (!revision) throw new Error("正文版本不存在");
      const content = reviewBody(fs.readFileSync(revision.content_ref, "utf8"));
      if (!hasReviewableBody(content, article.title)) {
        db.prepare(
          "UPDATE article_reviews SET status='insufficient',result_json=NULL,error_message=NULL,material_issue=?,assessed_at=?,log_id=NULL WHERE article_id=? AND revision_hash=?",
        ).run(
          "正文缺失或仅包含标题、日期、导航，需补充正文后再初审。",
          new Date().toISOString(),
          row.article_id,
          row.revision_hash,
        );
        return;
      }
      const adapter = getAIAdapterWithFallback() as FallbackAIAdapter | null;
      const profileId = adapter?.targets?.[0]?.target.id || "default";
      const skill = await skillsService.getSkill(SKILL_ID, profileId);
      const input = {
        jobId: `review_${crypto.randomUUID()}`,
        articleId: row.article_id,
        articleTitle: article.title,
        profileId,
        taskType: "assess" as const,
        skillId: SKILL_ID,
        skillRevision: skill?.revision,
        prompt: buildAssessmentPrompt(),
        material: assessmentMaterial(article.title, content, {
          published_at: article.published_at,
        }),
        outputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            quality: { type: "number", minimum: 0, maximum: 100 },
            positioning: { type: "string" },
            summary: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            reason: { type: "string" },
            evidence_refs: { type: "array", items: { type: "string" } },
          },
          required: [
            "quality",
            "positioning",
            "summary",
            "tags",
            "reason",
            "evidence_refs",
          ],
        },
      };
      if (!adapter || !skill || skill.type !== "extraction") {
        const message = !adapter
          ? "请先配置可用的 AI 执行器，再手动重试初审"
          : `内容初审 Skill 不可用：${SKILL_ID}`;
        logId = executionLogs.start(input);
        executionLogs.finish(
          logId,
          {
            status: "failed",
            provider: "none",
            model: "none",
            durationMs: 0,
            error: { code: "review_configuration", message },
          },
          0,
        );
        throw new Error(message);
      }
      const result = await adapter.execute(input, undefined, {
        onStart: (id) => {
          logId = id;
          db.prepare(
            "UPDATE article_reviews SET log_id=? WHERE article_id=? AND revision_hash=?",
          ).run(id, row.article_id, row.revision_hash);
        },
        validateResult: (candidate) => {
          const parsed = ArticleAssessmentSchema.safeParse(candidate);
          if (!parsed.success)
            return parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              code: issue.code,
              message: issue.message,
            }));
          return evidenceIssues(parsed.data, content);
        },
      });
      logId = result.trace_id;
      if (result.status !== "success")
        throw new Error(result.error?.message || "内容初审失败");
      const parsed = ArticleAssessmentSchema.safeParse(result.result);
      if (!parsed.success) {
        executionLogs.invalidate(logId, "初审返回结果不完整或超出字段限制");
        throw new Error("初审返回结果不完整或超出字段限制");
      }
      if (!hasGroundedEvidence(parsed.data, content)) {
        executionLogs.invalidate(logId, "初审缺少可核验的正文证据");
        throw new Error("初审缺少可核验的正文证据");
      }
      db.prepare(
        "UPDATE article_reviews SET status='succeeded',result_json=?,log_id=?,assessed_at=?,error_message=NULL WHERE article_id=? AND revision_hash=?",
      ).run(
        JSON.stringify(parsed.data),
        logId || null,
        new Date().toISOString(),
        row.article_id,
        row.revision_hash,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare(
        "UPDATE article_reviews SET status='failed',error_message=?,log_id=?,assessed_at=? WHERE article_id=? AND revision_hash=?",
      ).run(
        message,
        logId || null,
        new Date().toISOString(),
        row.article_id,
        row.revision_hash,
      );
    }
  }
}
export const articleReviewsService = new ArticleReviewsService();
