import { claimResearchArticle, releaseResearchClaims } from "./state.js";
import crypto from "node:crypto";
import { buildResearchPrompt, buildCodeResearchPrompt, buildRepositoryResearchInstructions, repositoryResearchContext, type RepositoryResearchContext, GITHUB_CODE_RESEARCH_SKILL, DEFAULT_RESEARCH_INSTRUCTIONS, repositoryStudy } from "@openlore/contracts";
import fs from "node:fs";
import path from "node:path";
import { getAppPaths } from "../../infrastructure/config/paths.js";
import { safeRelativePath } from "../../infrastructure/ai/skill_bundle.js";
import { and, eq } from "drizzle-orm";
import type { ResearchTask, ExecutionResult, RepositoryStudy } from "@openlore/contracts";
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
import { sourcesService } from "../sources/service.js";
import { groupsService } from "../groups/service.js";
import { listPoolCandidates } from "../processing/candidates.js";
import { collectResearchArtifacts, readRepositoryReport } from '../../infrastructure/ai/workspace_runner.js';
import { parseCodexUsage } from "../../infrastructure/ai/cli_output.js";
import { executionLogs } from '../../infrastructure/ai/execution_logs.js';
import { articleSlug } from "../delivery/archive-layout.js";

export class ResearchService {
  private activeRepositories = new Map<string, Promise<ResearchTask>>();
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
      const snapshot = repositoryStudy({ repository_study: JSON.parse(r.repositoryStudyJson || '{}') });
      const title = snapshot && r.reportMarkdown.trim() ? /^#\s+(.+)$/m.exec(r.reportMarkdown)?.[1]?.trim() || art?.title || '仓库研读' : art?.title || 'Untitled Article';
      tasks.push({
        id: r.id,
        repository_study: snapshot,
        skill_id: JSON.parse(r.executionJson || '{}').skill_id || (repositoryStudy(JSON.parse(art?.dateEvidenceJson || '{}')) ? GITHUB_CODE_RESEARCH_SKILL : undefined),
        group_id: r.groupId,
        article_id: r.articleId,
        article_title: title,
        article_slug: articleSlug(title),
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
    regenerate = false,
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
      const article = getSqliteDatabase().prepare('SELECT date_evidence_json FROM articles WHERE id=?').get(articleId) as { date_evidence_json: string };
      const study = pipeline.task_type === 'repository_research' ? repositoryStudy(JSON.parse(article.date_evidence_json)) : undefined;
      if (!study) return await this.generateResearch(groupId, articleId, customInstructions, runId, regenerate);
      // Same-repository research is sequential so each report sees earlier accepted reports,
      // including work awaiting archive in this very batch. Different repositories still run in parallel.
      const key = study.source_id || study.directory;
      const previous = this.activeRepositories.get(key);
      const task = (async () => {
        if (previous) {
          const preceding = await previous;
          if (preceding.status !== 'succeeded') throw new Error('前一篇仓库研读未完成，已停止后续研读');
        }
        return this.generateResearch(groupId, articleId, customInstructions, runId, regenerate);
      })();
      this.activeRepositories.set(key, task);
      try { return await task; }
      finally { if (this.activeRepositories.get(key) === task) this.activeRepositories.delete(key); }

    } finally {
      if (!runId && !claimOwner) releaseResearchClaims(owner);
    }
  }

  /** Accept an existing local artifact without opening an AI session or fetching source. */
  async recoverRepositoryReport(taskId: string): Promise<ResearchTask | null> {
    const db = getSqliteDatabase();
    const task = db.prepare('SELECT group_id,article_id,status,repository_study_json FROM research_tasks WHERE id=?').get(taskId) as { group_id: string; article_id: string; status: string; repository_study_json: string } | undefined;
    if (!task || task.status === 'running') return null;
    const article = db.prepare('SELECT date_evidence_json FROM articles WHERE id=?').get(task.article_id) as { date_evidence_json: string } | undefined;
    const study = repositoryStudy({repository_study: JSON.parse(task.repository_study_json || "{}")}) || repositoryStudy(JSON.parse(article?.date_evidence_json || '{}'));
    if (!study) return null;
    if (task.status === 'succeeded') return (await this.listResearchTasks(task.group_id)).find(row => row.id === taskId)!;
    const logs = executionLogs.list({ job_id: taskId, page: 1, page_size: 20 });
    for (const summary of logs.items) {
      const log = executionLogs.get(summary.id)!;
      for (const attempt of [...log.attempts].reverse()) {
        const workspace = attempt.execution?.workspace;
        if (!workspace || attempt.transport !== 'local' || !fs.existsSync(path.join(workspace, 'manifest.json'))) continue;
        const manifest = JSON.parse(fs.readFileSync(path.join(workspace, 'manifest.json'), 'utf8'));
        if (manifest.job_id !== taskId) continue;
        const report = readRepositoryReport(workspace);
        if (!report) continue;
        let repository: ExecutionResult['repository'];
        try { repository = JSON.parse(fs.readFileSync(path.join(workspace, 'input/repository.json'), 'utf8')); } catch {}
        let usage = attempt.usage;
        if (!usage && attempt.provider === 'codex_cli' && fs.existsSync(path.join(workspace, 'events.log'))) usage = parseCodexUsage(fs.readFileSync(path.join(workspace, 'events.log'), 'utf8'));
        const result: ExecutionResult = {
          status: 'success', provider: attempt.provider, model: attempt.model, durationMs: 0,
          result: report, repository, execution: attempt.execution, usage,
          artifacts: collectResearchArtifacts(path.join(workspace, 'output')),
          report_reused: true, notice: '复用已有研报，未重新调用 AI。',
        };
        const accepted = await this.generateResearch(task.group_id, task.article_id, undefined, undefined, false, { taskId, result, study });
        if (accepted.status === 'succeeded') executionLogs.recover(log.id, result);
        return accepted;
      }
    }
    return null;
  }

  private async generateResearch(
    groupId: string,
    articleId: string,
    customInstructions?: string,
    runId?: string,
    regenerate = false,
    recovered?: { taskId: string; result: ExecutionResult; study: RepositoryStudy },
  ): Promise<ResearchTask> {
    const db = getDb();
    const now = new Date().toISOString();
    if (!regenerate && !recovered) {
      const failed = getSqliteDatabase().prepare("SELECT id FROM research_tasks WHERE group_id=? AND article_id=? AND status IN ('failed','cancelled') ORDER BY rowid DESC LIMIT 1").get(groupId, articleId) as { id: string } | undefined;
      if (failed) {
        const saved = await this.recoverRepositoryReport(failed.id);
        if (saved) return saved;
      }
    }
    const taskId = recovered?.taskId || `res_${crypto.randomUUID().slice(0, 12)}`;

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
    const study = recovered?.study || (group?.taskType === 'repository_research' ? repositoryStudy(JSON.parse(art.dateEvidenceJson)) : undefined);
    if (group?.taskType === 'repository_research' && !study) throw new Error('仓库研读任务缺少来源与目标');
    let repositoryContext: RepositoryResearchContext | undefined;
    if (study) {
      // Upload retries reuse the approved report before resolving skills, prompts or fresh code.
      const latest = getSqliteDatabase().prepare("SELECT id,archived_at,report_markdown FROM research_tasks WHERE group_id=? AND article_id=? AND status='succeeded' ORDER BY rowid DESC LIMIT 1").get(groupId, articleId) as { id: string; archived_at: string | null; report_markdown: string } | undefined;
      if (!recovered && !regenerate && latest && !latest.archived_at && latest.report_markdown.trim())
        return (await this.listResearchTasks(groupId)).find(task => task.id === latest.id)!;
      const sourceId = study.source_id || (getSqliteDatabase().prepare('SELECT source_id FROM source_items WHERE article_id=? LIMIT 1').get(articleId) as { source_id: string } | undefined)?.source_id;
      const source = sourceId ? await sourcesService.getSource(sourceId) : null;
      if (!source) throw new Error('仓库来源配置不存在，无法准备目标和研究历史');
      const prior = getSqliteDatabase().prepare("SELECT questions_json FROM research_tasks WHERE article_id=? AND status='succeeded' ORDER BY rowid DESC LIMIT 1").get(articleId) as { questions_json: string } | undefined;
      repositoryContext = repositoryResearchContext({ ...source, options: { ...source.options, research_focus: study.focus } }, prior ? undefined : articleId);
      instructions = buildRepositoryResearchInstructions(repositoryContext, customInstructions || group?.researchInstructions, { study_id: study.study_id || articleId });
      if (prior) instructions += `\n用户明确重新调研已有主题：${art.title}。原研究问题：${prior.questions_json}。围绕原问题追踪本次最新源码、复核和深化，可修正旧认识，不另换无关主题。新研报覆盖原归档路径，旧内容由 Git 历史保留，允许有依据地再次回答相同问题。`;

    }

    // Generate research report (using AI adapter with primary and fallback support)
    const aiAdapter = recovered ? { execute: async () => recovered.result } : getAIAdapterWithFallback(group?.aiProfileId);

    const skillId = study ? GITHUB_CODE_RESEARCH_SKILL : group?.researchSkillId || 'deep-research-expert';
    if (!study && skillId === GITHUB_CODE_RESEARCH_SKILL) throw new Error('github-code-research 仅用于 GitHub 仓库来源，请为文章选择文章调研 Skill');
    const researchSkill = recovered ? { id: GITHUB_CODE_RESEARCH_SKILL, type: "research", revision: undefined } : await skillsService.getSkill(
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
          repositoryContext,
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
    if (!regenerate && !study && reusable)
      return (await this.listResearchTasks(groupId)).find(
        (task) => task.id === reusable.id,
      )!;

    // Insert task as queued
    if (!recovered) db.insert(researchTasksTable)
      .values({
        id: taskId,
        groupId,
        articleId,
        revisionHash: art.latestRevision,
        repositoryStudyJson: JSON.stringify(study || {}),
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
          repository: study ? {url: study.repository_url} : undefined,
          repository_context: repositoryContext,
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
        if (study && aiRes.repository?.url === study.repository_url) {
          study.commit = aiRes.repository.commit;
          db.update(researchTasksTable).set({ repositoryStudyJson: JSON.stringify(study) }).where(eq(researchTasksTable.id, taskId)).run();
          db.update(articlesTable).set({ dateEvidenceJson: JSON.stringify({ ...JSON.parse(art.dateEvidenceJson), repository_study: study }) }).where(eq(articlesTable.id, articleId)).run();
        }
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
          if (study) {
            // The report itself is the source of research history; auxiliary citations are optional.
            db.update(researchTasksTable).set({ questionsJson: '[]', evidenceJson: '[]' }).where(eq(researchTasksTable.id, taskId)).run();
          }
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
              continue;
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
      if (title) {
        db.update(articlesTable).set({ title, updatedAt: finishedAt }).where(eq(articlesTable.id, articleId)).run();
        getSqliteDatabase().prepare('UPDATE ai_execution_logs SET article_title=? WHERE job_id=?').run(title, taskId);
      }
    }
    db.update(researchTasksTable)
      .set({
        status: "succeeded",
        errorMessage: null,
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
