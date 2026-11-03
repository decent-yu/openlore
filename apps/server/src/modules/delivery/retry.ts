import fs from 'node:fs';
import { StructuredEntrySchema, type Group, type ResearchTask, type RunOutput, type StructuredEntry } from '@openlore/contracts';
import { getSqliteDatabase } from '../../infrastructure/persistence/sqlite/db.js';
import { mediaAssetsArchiver } from '../../infrastructure/media_assets/archiver.js';
import { researchService } from '../research/service.js';
import { claimResearchArticle, releaseResearchClaims } from '../research/state.js';
import { deliveryService } from './service.js';
import { articleSlug } from './archive-layout.js';

/** Retry this run's saved publications without repeating selection or research. */
export async function retryRunDelivery(runId: string, group: Group): Promise<void> {
  const db = getSqliteDatabase();
  const row = db.prepare('SELECT snapshot_json,output_json,ai_logs_json FROM runs WHERE id=?').get(runId) as { snapshot_json: string; output_json: string; ai_logs_json: string };
  const snapshot = JSON.parse(row.snapshot_json);
  const output: RunOutput = JSON.parse(row.output_json);
  const history = JSON.parse(row.ai_logs_json);
  const tasks: ResearchTask[] = [];
  const entries: StructuredEntry[] = [];
  try {
    const available = await researchService.listResearchTasks(group.id);
    for (const item of output.entries) {
      const task = [...available].reverse().find(task => task.article_id === item.article_id && task.status === 'succeeded' && task.report_markdown.trim());
      if (!task) throw new Error(`缺少可复用研报：${item.title}；请先完成调研`);
      if (!claimResearchArticle(item.article_id, group.id, runId, true)) throw new Error(`内容正在其他任务中处理：${item.title}`);
      tasks.push(task);
      const saved = snapshot.processed_entries?.find((entry: StructuredEntry) => entry.article_id === item.article_id);
      if (saved) { entries.push(StructuredEntrySchema.parse(saved)); continue; }
      // Earlier runs did not persist full entries. Recover from the original revision and review.
      const article = db.prepare('SELECT * FROM articles WHERE id=?').get(item.article_id) as { title: string; canonical_url: string; author: string; published_at: string };
      const research = db.prepare('SELECT revision_hash FROM research_tasks WHERE id=?').get(task.id) as { revision_hash: string };
      const revision = db.prepare('SELECT content_ref FROM article_revisions WHERE article_id=? AND revision_hash=?').get(item.article_id, research.revision_hash) as { content_ref: string } | undefined;
      if (!revision || !fs.existsSync(revision.content_ref)) throw new Error(`原文材料缺失：${item.title}`);
      const review = db.prepare('SELECT result_json FROM article_reviews WHERE article_id=? AND revision_hash=?').get(item.article_id, research.revision_hash) as { result_json: string } | undefined;
      const assessment = JSON.parse(review?.result_json || '{}');
      const assets = db.prepare('SELECT original_url,local_path FROM media_assets WHERE article_id=?').all(item.article_id) as { original_url: string; local_path: string }[];
      let body = mediaAssetsArchiver.rewriteMarkdownImageUrls(fs.readFileSync(revision.content_ref, 'utf8'), new Map(assets.map(asset => [asset.original_url, asset.local_path])));
      let tags = assessment.tags || [];
      // Use the exact original source supplied to a saved translation, when present.
      const translation = db.prepare("SELECT input_json FROM ai_execution_logs WHERE run_id=? AND article_id=? AND task_type='translate' ORDER BY rowid DESC LIMIT 1").get(runId, item.article_id) as { input_json: string } | undefined;
      if (translation) {
        const material = JSON.parse(translation.input_json).material as string;
        const original = material.split('\n## 原文整理\n\n')[1];
        if (original !== undefined) body = original.replace(/\n$/, '');
        const tagLine = /^> \*\*标签\*\*: (.*)$/m.exec(material)?.[1];
        if (tagLine !== undefined) tags = tagLine ? tagLine.split(', ') : [];
      }
      entries.push({ article_id: item.article_id, revision: research.revision_hash, slug: articleSlug(article.title), title: article.title, original_url: article.canonical_url, author: article.author, published_at: article.published_at, tags, summary: item.summary, organized_markdown: body, asset_refs: [], evidence_refs: [], limitations: [] });
    }
    db.prepare('UPDATE runs SET snapshot_json=? WHERE id=?').run(JSON.stringify({ ...snapshot, processed_entries: entries }), runId);
    const delivered = await deliveryService.buildAndDeliverBatch({ group, runId, entries, researchTasks: tasks });
    if (!['updated', 'unchanged'].includes(delivered.syncResult.status)) throw new Error(delivered.syncResult.errors.map(error => error.message).join('；') || 'GitHub 归档失败');
    for (const item of output.entries) {
      item.is_deep_analyzed = true;
      const entry = delivered.bundle.entries.find(entry => entry.article_id === item.article_id);
      const repo = db.prepare('SELECT owner,repo,default_branch FROM repository_connections WHERE id=?').get(group.route.repository_connection_id) as { owner: string; repo: string; default_branch: string };
      if (entry && repo) item.document_url = `https://github.com/${repo.owner}/${repo.repo}/blob/${encodeURIComponent(repo.default_branch)}/${(entry.research_path || `${group.route.base_path}/${entry.directory}/research.md`).split('/').map(encodeURIComponent).join('/')}`;
    }
    output.commit_url = delivered.syncResult.commit_url;
    history.push({ timestamp: new Date().toISOString(), task_type: 'delivery', prompt_preview: '', response_preview: '复用本轮已有研报和译文完成交付；未重新选文或调研。', status: 'succeeded' });
    db.prepare("UPDATE runs SET status='succeeded',stage='completed',error_message=NULL,finished_at=?,output_json=?,ai_logs_json=? WHERE id=?").run(new Date().toISOString(), JSON.stringify(output), JSON.stringify(history), runId);
  } catch (error) {
    history.push({ timestamp: new Date().toISOString(), task_type: 'delivery', prompt_preview: '', response_preview: error instanceof Error ? error.message : String(error), status: 'failed' });
    db.prepare("UPDATE runs SET status='failed',stage='delivery',error_message=?,finished_at=?,ai_logs_json=? WHERE id=?").run(error instanceof Error ? error.message : String(error), new Date().toISOString(), JSON.stringify(history), runId);
  } finally { releaseResearchClaims(runId); }
}
