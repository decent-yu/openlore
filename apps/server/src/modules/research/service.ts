import crypto from 'node:crypto';
import { buildResearchPrompt } from '@openlore/contracts';
import fs from 'node:fs';
import path from 'node:path';
import { getAppPaths } from '../../infrastructure/config/paths.js';
import { safeRelativePath } from '../../infrastructure/ai/skill_bundle.js';
import { and, eq } from 'drizzle-orm';
import type { ResearchTask } from '@openlore/contracts';
import { getAIAdapterWithFallback } from '../../infrastructure/ai/fallback_runner.js';
import { getDb } from '../../infrastructure/persistence/sqlite/db.js';
import {
  aiProfilesTable,
  articleRevisionsTable,
  articlesTable,
  groupItemsTable,
  groupsTable,
  mediaAssetsTable,
  researchTasksTable,
} from '../../infrastructure/persistence/sqlite/schema.js';
import { mediaAssetsArchiver } from '../../infrastructure/media_assets/archiver.js';
import { skillsService } from '../skills/service.js';

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
      const art = db.select().from(articlesTable).where(eq(articlesTable.id, r.articleId)).get();
      tasks.push({
        id: r.id,
        group_id: r.groupId,
        article_id: r.articleId,
        article_title: art?.title || 'Untitled Article',
        article_slug: (art?.title || 'article')
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .slice(0, 40),
        status: r.status as any,
        questions: JSON.parse(r.questionsJson || '[]'),
        evidence: JSON.parse(r.evidenceJson || '[]'),
        report_markdown: r.reportMarkdown,
        model: r.model || undefined,
        execution: r.executionJson && r.executionJson !== '{}' ? JSON.parse(r.executionJson) : undefined,
        created_at: r.createdAt,
        finished_at: r.finishedAt || undefined,
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
  ): Promise<ResearchTask> {
    const db = getDb();
    const now = new Date().toISOString();
    const taskId = `res_${crypto.randomUUID().slice(0, 12)}`;

    const art = db.select().from(articlesTable).where(eq(articlesTable.id, articleId)).get();
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

    let content = '';
    if (rev && fs.existsSync(rev.contentRef)) {
      content = fs.readFileSync(rev.contentRef, 'utf-8');
    }

    const group = db.select().from(groupsTable).where(eq(groupsTable.id, groupId)).get();
    const instructions =
      customInstructions ||
      group?.researchInstructions ||
      '深入剖析核心机制、架构设计、技术取舍与适用场景，提供可落地的工程建议。';

    // Insert task as queued
    db.insert(researchTasksTable)
      .values({
        id: taskId,
        groupId,
        articleId,
        revisionHash: art.latestRevision,
        status: 'running',
        questionsJson: JSON.stringify([
          '核心机制如何实现？',
          '存在哪些架构与性能取舍？',
          '在实际工程中的落地建议是什么？',
        ]),
        evidenceJson: JSON.stringify([
          {
            url: art.canonicalUrl || 'source',
            title: art.title || '原文',
            quote: content.slice(0, 150),
          },
        ]),
        reportMarkdown: '',
        createdAt: now,
      })
      .run();

    // Generate research report (using AI adapter with primary and fallback support)
    let report = '';
    const aiAdapter = getAIAdapterWithFallback(group?.aiProfileId);

    const researchSkill = await skillsService.getSkill(group?.researchSkillId || 'deep-research-expert', group?.aiProfileId || 'default');
    let failure = !researchSkill ? '调研 Skill 不存在' : !aiAdapter ? '未配置 AI 执行器' : 'AI 未返回有效研报';

    if (aiAdapter && researchSkill?.type === 'research') {
      try {
        const prompt = buildResearchPrompt(researchSkill.id, instructions);

        const aiRes = await aiAdapter.execute({
          jobId: taskId,
          runId, groupId, articleId, articleTitle: art.title || undefined,
          profileId: group!.aiProfileId!,
          taskType: 'research_report',
          skillId: researchSkill.id,
          skillRevision: researchSkill.revision,
          prompt,
          material: `Title: ${art.title}\nSource URL: ${art.canonicalUrl || '未提供'}\n\n${content}`,
        });

        db.update(researchTasksTable).set({executionJson: JSON.stringify(aiRes.execution || {}), model: aiRes.model}).where(eq(researchTasksTable.id,taskId)).run();
        if (aiRes.status !== 'success') failure = aiRes.error?.message || 'AI 调研调用失败';
        if (aiRes.status === 'success' && aiRes.result) {
          if (typeof aiRes.result === 'string') {
            report = aiRes.result;
          } else if (aiRes.result.report_markdown) {
            report = aiRes.result.report_markdown;
          } else if (aiRes.result.markdown) {
            report = aiRes.result.markdown;
          }

          if (typeof report !== 'string' || !report.trim()) throw new Error('AI 返回了空研报或无效格式');
          for (const artifact of aiRes.artifacts || []) {
            safeRelativePath(artifact.path);
            if (!artifact.path.startsWith('assets/')) continue;
            const extension = path.extname(artifact.path).toLowerCase();
            const mime: Record<string,string> = {'.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
            if (!mime[extension]) continue;
            const bytes = Buffer.from(artifact.content, 'base64');
            if (extension === '.svg' && /<script|onload=|javascript:/i.test(bytes.toString())) throw new Error('生成的 SVG 含不允许的执行内容');
            const hash = crypto.createHash('sha256').update(bytes).digest('hex');
            const blob = path.join(getAppPaths().blobsDir, hash);
            fs.writeFileSync(blob, bytes);
            db.insert(mediaAssetsTable).values({ id: `asset_${crypto.randomUUID()}`, articleId, originalUrl: `generated:${taskId}:${artifact.path}`, localPath: artifact.path, sha256: hash, mimeType: mime[extension], sizeBytes: bytes.length, blobRef: blob, status: 'downloaded', createdAt: new Date().toISOString() }).run();
          }
          // Extract and archive any embedded SVG blocks from AI output
          const svgRegex = /```(?:xml|svg)?\s*(<svg[\s\S]*?<\/svg>)\s*```|<svg[\s\S]*?<\/svg>/gi;
          let svgMatch;
          let svgIndex = 1;
          while ((svgMatch = svgRegex.exec(report)) !== null) {
            const svgCode = svgMatch[1] || svgMatch[0];
            const svgFilename = `architecture-${svgIndex === 1 ? 'topology' : `flow-${svgIndex}`}.svg`;
            const archived = mediaAssetsArchiver.archiveSvgContent(svgCode, svgFilename);

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
                status: 'downloaded',
                createdAt: new Date().toISOString(),
              })
              .onConflictDoNothing()
              .run();

            // Replace raw SVG block with pure markdown image tag if not already referenced
            if (!report.includes(`![](./assets/${svgFilename})`)) {
              report = report.replace(svgMatch[0], `![](./assets/${svgFilename})`);
            } else {
              report = report.replace(svgMatch[0], '');
            }
            svgIndex++;
          }
        }
      } catch (error: any) {
        failure = error.message;
        report = '';
      }
    }

    if (!report.trim()) {
      db.update(researchTasksTable).set({ status: 'failed', errorMessage: failure, finishedAt: new Date().toISOString() }).where(eq(researchTasksTable.id, taskId)).run();
      return (await this.listResearchTasks(groupId)).find((task) => task.id === taskId)!;
    }
    db.update(groupItemsTable).set({ isDeepAnalyzed: true }).where(and(eq(groupItemsTable.groupId, groupId), eq(groupItemsTable.articleId, articleId))).run();

    const finishedAt = new Date().toISOString();
    db.update(researchTasksTable)
      .set({
        status: 'succeeded',
        reportMarkdown: report,
        finishedAt,
      })
      .where(eq(researchTasksTable.id, taskId))
      .run();

    return (await this.listResearchTasks(groupId)).find((t) => t.id === taskId)!;
  }
}

export const researchService = new ResearchService();
