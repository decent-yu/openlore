import crypto from 'node:crypto';
import { buildAssessmentPrompt, type RunAILog } from '@openlore/contracts';
import fs from 'node:fs';
import { and, eq } from 'drizzle-orm';
import type {
  Decision,
  Group,
  StructuredEntry,
} from '@openlore/contracts';
import { FallbackAIAdapter, getAIAdapterWithFallback } from '../../infrastructure/ai/fallback_runner.js';
import { mediaAssetsArchiver } from '../../infrastructure/media_assets/archiver.js';
import { getDb, getSqliteDatabase } from '../../infrastructure/persistence/sqlite/db.js';
import { executionLogs } from '../../infrastructure/ai/execution_logs.js';
import { listPoolCandidates } from './candidates.js';
import { assessmentMaterial, hasGroundedEvidence } from './assessment.js';
import { skillsService } from '../skills/service.js';
import {
  articleRevisionsTable,
  articlesTable,
  groupItemsTable,
  mediaAssetsTable,
  sourceItemsTable,
  runsTable,
} from '../../infrastructure/persistence/sqlite/schema.js';

export interface ProcessedBatchResult {
  decisions: Decision[];
  entries: StructuredEntry[];
  researchArticleIds: string[];
  counts: {
    observed: number;
    already_processed: number;
    candidate: number;
    selected: number;
    excluded: number;
    deferred: number;
  };
  aiLogs?: RunAILog[];
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'article';
}

export class ProcessingService {
  async runProcessingForGroup(
    group: Group,
    runId: string,
    selectedLimit: number = group.max_selected || 10,
  ): Promise<ProcessedBatchResult> {
    const db = getDb();
    const counts = {
      observed: 0,
      already_processed: 0,
      candidate: 0,
      selected: 0,
      excluded: 0,
      deferred: 0,
    };

    const decisions: Decision[] = [];
    const entries: StructuredEntry[] = [];
    const aiLogs: Array<any> = [];

    const pool = listPoolCandidates(group.source_ids);
    counts.observed = pool.length;
    const articleSourceMap = new Map<string, string[]>();
    for (const item of db.select().from(sourceItemsTable).all()) {
      const list = articleSourceMap.get(item.articleId) || [];
      if (!list.includes(item.sourceId)) list.push(item.sourceId);
      articleSourceMap.set(item.articleId, list);
    }

    // Read every unprocessed article in the selected pool scope.
    const candidateArticles: Array<{
      article: any;
      revision: any;
      matchedSources: string[];
      content: string;
    }> = [];

    for (const poolItem of pool) {
      if (poolItem.processed) { counts.already_processed++; continue; }
      const artId=poolItem.id;
      const art = db.select().from(articlesTable).where(eq(articlesTable.id, artId)).get();
      if (!art?.latestRevision) throw new Error(`内容池文章 ${artId} 缺少正文版本，请修复存储后重试`);
      const rev = db.select().from(articleRevisionsTable).where(and(eq(articleRevisionsTable.articleId, artId),eq(articleRevisionsTable.revisionHash,art.latestRevision))).get();
      if (!rev) throw new Error(`内容池文章 ${artId} 的正文版本不存在，请修复存储后重试`);

      // Storage failures are errors, not a second admission filter or a silent skip.
      const content = fs.readFileSync(rev.contentRef, 'utf-8');

      candidateArticles.push({
        article: art,
        revision: rev,
        matchedSources: articleSourceMap.get(art.id) || [],
        content,
      });
    }

    counts.candidate = candidateArticles.length;
    db.update(runsTable).set({ countsJson: JSON.stringify(counts) }).where(eq(runsTable.id, runId)).run();

    // AI assessment of the entire candidate set.
    const qualifiedList: Array<{
      item: (typeof candidateArticles)[0];
      relevance: number;
      quality: number;
      score: number;
      reason: string;
      tags: string[];
      summary: string;
      cleanMarkdown: string;
      evidence: string[];
    }> = [];

    const assessmentSkill = await skillsService.getSkill(group.assessment_skill_id, group.ai_profile_id || 'default');
    if (!assessmentSkill || assessmentSkill.type !== 'extraction') throw new Error(`审核 Skill 不存在：${group.assessment_skill_id}`);
    const activeSkills = [assessmentSkill];
    const skillInstructions = assessmentSkill.system_prompt;

    // Resolve AI profile adapter with primary and fallback support
    const aiAdapter = getAIAdapterWithFallback(group.ai_profile_id);
    const activeTarget = (aiAdapter as FallbackAIAdapter)?.targets?.[0]?.target;

    if (candidateArticles.length > 0 && !aiAdapter) throw new Error('审核失败：请先配置可用的 AI 执行器');

    const assess = async (cand: (typeof candidateArticles)[number]) => {
      const matchedSourceId = cand.matchedSources[0] || '';

      let relevance = 0;
      let quality = 0;
      let reason = '';
      let summary = '';
      let tags: string[] = [];
      let usedPrompt = '';
      let usedModel = '';
      let executionDetails: unknown;
      let evidence: string[] = [];

      if (aiAdapter) {
        try {
          const prompt = buildAssessmentPrompt(group.assessment_skill_id, group);

          usedPrompt = prompt;
          const material = assessmentMaterial(cand.article.title || '', cand.content, {published_at:cand.article.publishedAt, sources:cand.matchedSources, completeness:cand.revision.bodyCompleteness, content_kind:cand.article.contentKind});
          const cacheKey = crypto.createHash('sha256').update(JSON.stringify([group.id,prompt,assessmentSkill.revision,material,group.ai_profile_id,activeTarget])).digest('hex');
          const cached = getSqliteDatabase().prepare('SELECT result_json FROM article_assessments WHERE cache_key=?').get(cacheKey) as {result_json:string} | undefined;
          let aiRes = cached ? {status:'success',result:JSON.parse(cached.result_json),error:undefined} : await aiAdapter.execute({
            jobId: `${runId}_${cand.article.id}`,
            runId, groupId: group.id, articleId: cand.article.id, articleTitle: cand.article.title || undefined,
            profileId: group.ai_profile_id!,
            taskType: 'assess',
            skillId: group.assessment_skill_id,
            skillRevision: assessmentSkill.revision,
            prompt,
            material,
            outputSchema: {
              type: 'object',
              properties: {
                relevance: { type: 'number' },
                quality: { type: 'number' },
                reason: { type: 'string' },
                summary: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                evidence_refs: {type:'array',items:{type:'string'}},
              },
              required: ['relevance', 'quality', 'reason', 'summary', 'evidence_refs'],
            },
          });

          // Retry malformed evidence once with precise feedback; never relax admission.
          if (!cached && aiRes.status === 'success' && aiRes.result && !hasGroundedEvidence(aiRes.result, cand.content)) {
            executionLogs.invalidate('trace_id' in aiRes ? aiRes.trace_id : undefined, '审核引用未通过正文核验，已要求重新返回');
            usedPrompt = `${prompt}\n\n上次返回的 evidence_refs 未通过原文核验。请重新读取 input/article.md，逐字复制至少一段完整原句（至少 16 字符）；保留原句措辞，不翻译或改写。重新返回完整 JSON。`;
            aiRes = await aiAdapter.execute({
              jobId: `${runId}_${cand.article.id}_evidence_retry`,
              runId, groupId: group.id, articleId: cand.article.id, articleTitle: cand.article.title || undefined,
              profileId: group.ai_profile_id!, taskType: 'assess',
              skillId: group.assessment_skill_id, skillRevision: assessmentSkill.revision,
              prompt: usedPrompt, material,
              outputSchema: {type:'object',properties:{relevance:{type:'number'},quality:{type:'number'},reason:{type:'string'},summary:{type:'string'},tags:{type:'array',items:{type:'string'}},evidence_refs:{type:'array',items:{type:'string'}}},required:['relevance','quality','reason','summary','evidence_refs']},
              });
          }

          usedModel = 'model' in aiRes ? String(aiRes.model) : 'cached';
          executionDetails = 'execution' in aiRes ? aiRes.execution : undefined;
          if (aiRes.status !== 'success' || !aiRes.result || !Number.isFinite(aiRes.result.relevance) || !Number.isFinite(aiRes.result.quality) || typeof aiRes.result.summary !== 'string') throw new Error(aiRes.error?.message || '审核返回结果不完整');
          if (!hasGroundedEvidence(aiRes.result, cand.content)) {
            executionLogs.invalidate('trace_id' in aiRes ? aiRes.trace_id : undefined, '审核缺少可核验的正文证据');
            throw new Error('审核缺少可核验的正文证据');
          }
          evidence = aiRes.result.evidence_refs;
          if (!cached) getSqliteDatabase().prepare('INSERT OR REPLACE INTO article_assessments VALUES (?,?,?,?,?)').run(cacheKey,cand.article.id,group.id,JSON.stringify(aiRes.result),new Date().toISOString());
          if (aiRes.status === 'success' && aiRes.result) {
            if (typeof aiRes.result.relevance === 'number') {
              relevance = Math.min(100, Math.max(0, Math.round(aiRes.result.relevance)));
            }
            if (typeof aiRes.result.quality === 'number') {
              quality = Math.min(100, Math.max(0, Math.round(aiRes.result.quality)));
            }
            if (aiRes.result.reason) {
              reason = aiRes.result.reason;
            }
            if (aiRes.result.summary) {
              summary = aiRes.result.summary;
            }
            if (Array.isArray(aiRes.result.tags) && aiRes.result.tags.length > 0) {
              tags = aiRes.result.tags;
            }
          }
        } catch (error: any) {
          throw new Error(`文章「${cand.article.title}」审核失败：${error.message}`);
        }
      }

      const overall = Number((0.7 * relevance + 0.3 * quality).toFixed(1));

      aiLogs.push({
        timestamp: new Date().toISOString(),
        article_id: cand.article.id,
        article_title: cand.article.title || 'Untitled Article',
        task_type: 'assess',
        skill_id: group.assessment_skill_id,
        model:
          usedModel || activeTarget?.model ||
          (activeTarget?.provider === 'gemini_cli'
            ? 'gemini-cli'
            : activeTarget
              ? 'codex-cli'
              : 'heuristic-ai-evaluator'),
        prompt_preview: usedPrompt,
        execution: executionDetails,
        response_preview: JSON.stringify(
          {
            relevance,
            quality,
            overall,
            decision: relevance >= 75 && quality >= 70 ? 'selected' : 'excluded',
            reason,
            summary,
            tags,
          },
          null,
          2,
        ),
        status: 'success',
      });

      db.update(runsTable).set({ countsJson: JSON.stringify(counts), aiLogsJson: JSON.stringify(aiLogs) }).where(eq(runsTable.id, runId)).run();

      // Threshold check: relevance >= 75 and quality >= 70
      if (relevance < 75 || quality < 70) {
        counts.excluded++;
        decisions.push({
          article_id: cand.article.id,
          revision: cand.revision.revisionHash,
          decision: 'excluded',
          reason: `Below score threshold (relevance: ${relevance}, quality: ${quality})`,
          matched_source_ids: [matchedSourceId],
          scores: { relevance, quality, overall },
        });
        return;
      }

      qualifiedList.push({
        item: cand,
        relevance,
        quality,
        score: overall,
        reason,
        tags,
        summary,
        cleanMarkdown: cand.content,
        evidence,
      });
    };
    const concurrency = Math.max(1, Math.min(4, activeTarget?.execution?.concurrency || 1));
    let nextCandidate = 0;
    let assessmentError: unknown;
    await Promise.all(Array.from({ length: Math.min(concurrency, candidateArticles.length) }, async () => {
      while (!assessmentError && nextCandidate < candidateArticles.length) {
        const candidate = candidateArticles[nextCandidate++];
        try { await assess(candidate); } catch (error) { assessmentError = error; }
      }
    }));
    if (assessmentError) throw assessmentError;

    // Sort qualified list by overall score desc, publishedAt desc
    qualifiedList.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dateA = a.item.article.publishedAt ? new Date(a.item.article.publishedAt).getTime() : 0;
      const dateB = b.item.article.publishedAt ? new Date(b.item.article.publishedAt).getTime() : 0;
      return dateB - dateA;
    });

    // 4. Select top `selectedLimit` (default 10)
    const selected = qualifiedList.slice(0, selectedLimit);
    const deferredBeyondLimit = qualifiedList.slice(selectedLimit);

    for (const def of deferredBeyondLimit) {
      counts.deferred++;
      decisions.push({
        article_id: def.item.article.id,
        revision: def.item.revision.revisionHash,
        decision: 'deferred',
        reason: 'Qualified but exceeded selected quota for this batch; deferred',
        matched_source_ids: def.item.matchedSources,
        scores: {
          relevance: def.relevance,
          quality: def.quality,
          overall: def.score,
        },
      });
    }

    // 5. Build structured entries and archive assets
    for (const sel of selected) {
      counts.selected++;
      const art = sel.item.article;
      const rev = sel.item.revision;
      const slug = slugify(art.title || art.id);

      // Find image links in content
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      const urlMap = new Map<string, string>();
      const assetRefs: string[] = [];

      while ((match = imageRegex.exec(sel.cleanMarkdown)) !== null) {
        const imgUrl = match[2];
        if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://') || imgUrl.startsWith('data:')) {
          const archived = await mediaAssetsArchiver.archiveImage(imgUrl, 'diagram');
          if (archived.status === 'downloaded' && archived.relativePath) {
            urlMap.set(imgUrl, archived.relativePath);
            assetRefs.push(archived.relativePath);

            // Save to media_assets db
            db.insert(mediaAssetsTable)
              .values({
                id: archived.assetId,
                articleId: art.id,
                originalUrl: imgUrl,
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
          }
        }
      }

      const rewrittenMarkdown = mediaAssetsArchiver.rewriteMarkdownImageUrls(
        sel.cleanMarkdown,
        urlMap,
      );

      entries.push({
        article_id: art.id,
        revision: rev.revisionHash,
        slug,
        title: art.title || slug,
        original_url: art.canonicalUrl,
        author: art.author,
        published_at: art.publishedAt,
        tags: sel.tags,
        summary: sel.summary,
        organized_markdown: rewrittenMarkdown,
        asset_refs: assetRefs,
        evidence_refs: sel.evidence,
        limitations: [],
      });

      decisions.push({
        article_id: art.id,
        revision: rev.revisionHash,
        decision: 'selected',
        reason: sel.reason,
        matched_source_ids: sel.item.matchedSources,
        scores: {
          relevance: sel.relevance,
          quality: sel.quality,
          overall: sel.score,
        },
      });

      // Save to group_items
      db.insert(groupItemsTable)
        .values({
          id: (getSqliteDatabase().prepare('SELECT id FROM group_items WHERE group_id=? AND article_id=?').get(group.id, art.id) as {id:string} | undefined)?.id || `gi_${crypto.randomUUID()}`,
          groupId: group.id,
          articleId: art.id,
          revisionHash: rev.revisionHash,
          rulesRevision: 'v1',
          decision: 'selected',
          reason: sel.reason,
          scoresJson: JSON.stringify({
            relevance: sel.relevance,
            quality: sel.quality,
            overall: sel.score,
            skills: activeSkills.map((s) => s.id),
          }),
          matchedSourceIdsJson: JSON.stringify(sel.item.matchedSources),
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: groupItemsTable.id,
          set: {
            decision: 'selected',
            reason: sel.reason,
            scoresJson: JSON.stringify({relevance:sel.relevance,quality:sel.quality,overall:sel.score}),
            revisionHash: rev.revisionHash,
            updatedAt: new Date().toISOString(),
          },
        })
        .run();
    }

    // Persist exclusions and deferrals too, so every assessed article has an explanation.
    const sqlite = getSqliteDatabase();
    for (const decision of decisions.filter(d => d.decision !== 'selected')) {
      const prior = sqlite.prepare('SELECT id FROM group_items WHERE group_id=? AND article_id=?').get(group.id,decision.article_id) as {id:string} | undefined;
      if (prior) sqlite.prepare('UPDATE group_items SET decision=?,reason=?,scores_json=?,revision_hash=?,updated_at=? WHERE id=?')
        .run(decision.decision,decision.reason,JSON.stringify(decision.scores || {}),decision.revision,new Date().toISOString(),prior.id);
      else sqlite.prepare('INSERT INTO group_items(id,group_id,article_id,revision_hash,rules_revision,decision,reason,scores_json,matched_source_ids_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(`gi_${crypto.randomUUID()}`,group.id,decision.article_id,decision.revision,'quality-v1',decision.decision,decision.reason,JSON.stringify(decision.scores || {}),JSON.stringify(decision.matched_source_ids),new Date().toISOString());
    }
    return { decisions, entries, counts, aiLogs, researchArticleIds: group.enable_research ? entries.slice(0, group.deep_analysis_count).map((entry) => entry.article_id) : [] };
  }

}

export const processingService = new ProcessingService();
