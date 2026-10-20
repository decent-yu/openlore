import { claimResearchArticle, releaseResearchClaims } from "./state.js";
import crypto from "node:crypto";
import { buildResearchPrompt, buildCodeResearchPrompt, GITHUB_CODE_RESEARCH_SKILL, DEFAULT_RESEARCH_INSTRUCTIONS, repositoryStudy } from "@openlore/contracts";
import fs from "node:fs";
import path from "node:path";
import { getAppPaths } from "../../infrastructure/config/paths.js";
import { safeRelativePath } from "../../infrastructure/ai/skill_bundle.js";
import { and, eq } from "drizzle-orm";
import type { ResearchTask } from "@openlore/contracts";
import { getAIAdapterWithFallback } from "../../infrastructure/ai/fallback_runner.js";
import { getDb, getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import {
  articleRevisionsTable,
  articlesTable,
  groupsTable,
  mediaAssetsTable,
  researchTasksTable,
} from "../../infrastructure/persistence/sqlite/schema.js";
import { mediaAssetsArchiver } from "../../infrastructure/media_assets/archiver.js";
import { skillsService } from "../skills/service.js";
import { groupsService } from "../groups/service.js";
import { listPoolCandidates } from "../processing/candidates.js";
import { articleSlug } from "../delivery/archive-layout.js";

export class ResearchService {
  async listResearchTasks(groupId?: string): Promise<ResearchTask[]> {
    const db = getDb();
    const rows = groupId
      ? db
          .select()
          .from(researchTasksTable)
          .where(eq(researchTasksTable.groupId, groupId))
          .all()
      : db.select().from(researchTasksTable).all();

    const tasks: ResearchTask[] = [];
    for (const r of rows) {
      const art = db
        .select()
        .from(articlesTable)
        .where(eq(articlesTable.id, r.articleId))
        .get();
      tasks.push({
        id: r.id,
        skill_id: JSON.parse(r.executionJson || '{}').skill_id || (repositoryStudy(JSON.parse(art?.dateEvidenceJson || '{}')) ? GITHUB_CODE_RESEARCH_SKILL : undefined),
        group_id: r.groupId,
        article_id: r.articleId,
        article_title: art?.title || "Untitled Article",
        article_slug: articleSlug(art?.title || "article"),
        status: r.status as any,
        questions: JSON.parse(r.questionsJson || "[]"),
        evidence: JSON.parse(r.evidenceJson || "[]"),
        report_markdown: r.reportMarkdown,
        model: r.model || undefined,
        execution:
          r.executionJson && r.executionJson !== "{}"
            ? JSON.parse(r.executionJson)
            : undefined,
        created_at: r.createdAt,
        finished_at: r.finishedAt || undefined,
        archived_at: r.archivedAt || undefined,
        error_message: r.errorMessage || undefined,
      });
    }

    return tasks;
  }

  async runResearchOnArticle(
    groupId: string,
    articleId: string,
    customInstructions?: string,
    runId?: string,
    claimOwner?: string,
  ): Promise<ResearchTask> {
    const pipeline = await groupsService.getGroup(groupId);
    if (!pipeline || !listPoolCandidates(pipeline.source_ids, pipeline.task_type).some(item=>item.id===articleId))
      throw Object.assign(new Error('研究材料不属于当前任务类型或来源范围'), {statusCode:400});
    const owner = claimOwner || runId || `manual_${crypto.randomUUID()}`;
    if (!claimResearchArticle(articleId, groupId, owner, !runId)) {
      throw Object.assign(new Error("文章正在其他任务中调研，或已完成归档"), {
        statusCode: 409,
      });
    }
    try {
      return await this.generateResearch(
        groupId,
        articleId,
        customInstructions,
        runId,
      );
    } finally {
      if (!runId && !claimOwner) releaseResearchClaims(owner);
    }
  }

  private async generateResearch(
    groupId: string,
    articleId: string,
    customInstructions?: string,
    runId?: string,
  ): Promise<ResearchTask> {
    const db = getDb();
    const now = new Date().toISOString();
    const taskId = `res_${crypto.randomUUID().slice(0, 12)}`;

    const art = db
      .select()
      .from(articlesTable)
      .where(eq(articlesTable.id, articleId))
      .get();
    if (!art || !art.latestRevision) {
      throw new Error(`Article not found or has no revision: ${articleId}`);
    }

    const rev = db
      .select()
      .from(articleRevisionsTable)
      .where(
        and(
          eq(articleRevisionsTable.articleId, articleId),
          eq(articleRevisionsTable.revisionHash, art.latestRevision),
        ),
      )
      .get();

    let content = "";
    if (rev && fs.existsSync(rev.contentRef)) {
      content = fs.readFileSync(rev.contentRef, "utf-8");
    }

    const group = db
      .select()
      .from(groupsTable)
      .where(eq(groupsTable.id, groupId))
      .get();
    let instructions =
      customInstructions ||
      group?.researchInstructions ||
      DEFAULT_RESEARCH_INSTRUCTIONS;
    const study = group?.taskType === 'repository_research' ? repositoryStudy(JSON.parse(art.dateEvidenceJson)) : undefined;
    if (group?.taskType === 'repository_research' && !study) throw new Error('仓库研读任务缺少固定版本材料');
    if (study) {
      const history = getSqliteDatabase().prepare(`SELECT a.title,t.report_markdown FROM research_tasks t JOIN articles a ON a.id=t.article_id
        WHERE t.status='succeeded' AND t.archived_at IS NOT NULL AND t.article_id<>?
          AND json_extract(a.date_evidence_json,'$.repository_study.directory')=?
        ORDER BY t.created_at DESC LIMIT 40`).all(articleId, study.directory) as Array<{ title: string; report_markdown: string }>;
      instructions += `

仓库：${study.repository_url}
固定 Commit：${study.commit}
研读重点：${study.focus || '架构设计与核心思想'}
已归档研读（最近 40 篇）：
${history.map(item => `- ${item.title}\n${item.report_markdown.slice(0, 800)}`).join('\n\n') || '暂无，从整体架构与核心执行链路开始。'}`;
    }

    // Generate research report (using AI adapter with primary and fallback support)
    const aiAdapter = getAIAdapterWithFallback(group?.aiProfileId);

    const skillId = study ? GITHUB_CODE_RESEARCH_SKILL : group?.researchSkillId || 'deep-research-expert';
    if (!study && skillId === GITHUB_CODE_RESEARCH_SKILL) throw new Error('github-code-research 仅用于 GitHub 仓库来源，请为文章选择文章调研 Skill');
    const researchSkill = await skillsService.getSkill(
      skillId,
      group?.aiProfileId || "default",
    );
    const prompt = researchSkill
      ? (study ? buildCodeResearchPrompt(instructions) : buildResearchPrompt(researchSkill.id, instructions))
      : "";
    const requestHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          art.latestRevision,
          instructions,
          prompt,
          researchSkill?.revision,
          skillId,
          group?.aiProfileId,
          (aiAdapter as any)?.targets?.[0]?.target,
        ]),
      )
      .digest("hex");
    const reusable = db
      .select()
      .from(researchTasksTable)
      .where(
        and(
          eq(researchTasksTable.groupId, groupId),
          eq(researchTasksTable.articleId, articleId),
          eq(researchTasksTable.status, "succeeded"),
          eq(researchTasksTable.requestHash, requestHash),
        ),
      )
      .all()
      .filter((task) => !task.archivedAt && task.reportMarkdown.trim())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (reusable)
      return (await this.listResearchTasks(groupId)).find(
        (task) => task.id === reusable.id,
      )!;

    // Insert task as queued
    db.insert(researchTasksTable)
      .values({
        id: taskId,
        groupId,
        articleId,
        revisionHash: art.latestRevision,
        status: "running",
        requestHash,
        questionsJson: JSON.stringify([
          "核心机制如何实现？",
          "存在哪些架构与性能取舍？",
          "在实际工程中的落地建议是什么？",
        ]),
        evidenceJson: JSON.stringify([
          {
            url: art.canonicalUrl || "source",
            title: art.title || "原文",
            quote: content.slice(0, 150),
          },
        ]),
        reportMarkdown: "",
        createdAt: now,
      })
      .run();

    let report = "";
    let failure = !researchSkill
      ? "调研 Skill 不存在"
      : !aiAdapter
        ? "未配置 AI 执行器"
        : "AI 未返回有效研报";

    if (aiAdapter && researchSkill?.type === "research") {
      try {
        const aiRes = await aiAdapter.execute({
          jobId: taskId,
          runId,
          groupId,
          articleId,
          articleTitle: art.title || undefined,
          profileId: group!.aiProfileId!,
          taskType: "research_report",
          skillId: researchSkill.id,
          skillRevision: researchSkill.revision,
          repository: study ? {url: study.repository_url, commit: study.commit} : undefined,
          prompt,
          material: `Title: ${art.title}\nSource URL: ${art.canonicalUrl || "未提供"}\n\n${content}`,
        });

        db.update(researchTasksTable)
          .set({
            executionJson: JSON.stringify(aiRes.execution || {}),
            model: aiRes.model,
          })
          .where(eq(researchTasksTable.id, taskId))
          .run();
        if (aiRes.status !== "success")
          failure = aiRes.error?.message || "AI 调研调用失败";
        if (aiRes.status === "success" && aiRes.result) {
          if (typeof aiRes.result === "string") {
            report = aiRes.result;
          } else if (aiRes.result.report_markdown) {
            report = aiRes.result.report_markdown;
          } else if (aiRes.result.markdown) {
            report = aiRes.result.markdown;
          }

          if (typeof report !== "string" || !report.trim())
            throw new Error("AI 返回了空研报或无效格式");
          for (const artifact of aiRes.artifacts || []) {
            safeRelativePath(artifact.path);
            if (!artifact.path.startsWith("assets/")) continue;
            const extension = path.extname(artifact.path).toLowerCase();
            const mime: Record<string, string> = {
              ".svg": "image/svg+xml",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".webp": "image/webp",
            };
            if (!mime[extension]) continue;
            const bytes = Buffer.from(artifact.content, "base64");
            if (
              extension === ".svg" &&
              /<script|onload=|javascript:/i.test(bytes.toString())
            )
              throw new Error("生成的 SVG 含不允许的执行内容");
            const hash = crypto
              .createHash("sha256")
              .update(bytes)
              .digest("hex");
            const blob = path.join(getAppPaths().blobsDir, hash);
            fs.writeFileSync(blob, bytes);
            db.insert(mediaAssetsTable)
              .values({
                id: `asset_${crypto.randomUUID()}`,
                articleId,
                originalUrl: `generated:${taskId}:${artifact.path}`,
                localPath: artifact.path,
                sha256: hash,
                mimeType: mime[extension],
                sizeBytes: bytes.length,
                blobRef: blob,
                status: "downloaded",
                createdAt: new Date().toISOString(),
              })
              .run();
          }
          // Extract and archive any embedded SVG blocks from AI output
          const svgRegex =
            /```(?:xml|svg)?\s*(<svg[\s\S]*?<\/svg>)\s*```|<svg[\s\S]*?<\/svg>/gi;
          let svgMatch;
          let svgIndex = 1;
          while ((svgMatch = svgRegex.exec(report)) !== null) {
            const svgCode = svgMatch[1] || svgMatch[0];
            const svgFilename = `architecture-${svgIndex === 1 ? "topology" : `flow-${svgIndex}`}.svg`;
            const archived = mediaAssetsArchiver.archiveSvgContent(
              svgCode,
              svgFilename,
            );

            db.insert(mediaAssetsTable)
              .values({
                id: archived.assetId,
                articleId: art.id,
                originalUrl: archived.originalUrl,
                localPath: archived.relativePath,
                sha256: archived.sha256,
                mimeType: archived.mimeType,
                sizeBytes: archived.sizeBytes,
                blobRef: archived.blobRef,
                status: "downloaded",
                createdAt: new Date().toISOString(),
              })
              .onConflictDoNothing()
              .run();

            // Replace raw SVG block with pure markdown image tag if not already referenced
            if (!report.includes(`![](./assets/${svgFilename})`)) {
              report = report.replace(
                svgMatch[0],
                `![](./assets/${svgFilename})`,
              );
            } else {
              report = report.replace(svgMatch[0], "");
            }
            svgIndex++;
          }
        }
      } catch (error: any) {
        failure = error.message;
        report = "";
      }
    }

    if (!report.trim()) {
      db.update(researchTasksTable)
        .set({
          status: "failed",
          errorMessage: failure,
          finishedAt: new Date().toISOString(),
        })
        .where(eq(researchTasksTable.id, taskId))
        .run();
      return (await this.listResearchTasks(groupId)).find(
        (task) => task.id === taskId,
      )!;
    }

    const finishedAt = new Date().toISOString();
    if (study) {
      const title = /^#\s+(.+)$/m.exec(report)?.[1]?.trim().slice(0, 160);
      if (title) db.update(articlesTable).set({ title, updatedAt: finishedAt }).where(eq(articlesTable.id, articleId)).run();
    }
    db.update(researchTasksTable)
      .set({
        status: "succeeded",
        reportMarkdown: report,
        finishedAt,
      })
      .where(eq(researchTasksTable.id, taskId))
      .run();

    return (await this.listResearchTasks(groupId)).find(
      (t) => t.id === taskId,
    )!;
  }
}

export const researchService = new ResearchService();
