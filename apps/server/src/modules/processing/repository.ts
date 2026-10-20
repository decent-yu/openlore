import fs from "node:fs";
import { repositoryStudy, type Group } from "@openlore/contracts";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { sourcesService } from "../sources/service.js";
import { collectionService } from "../collection/service.js";
import { claimResearchArticle } from "../research/state.js";
import { articleSlug } from "../delivery/archive-layout.js";
import { listPoolCandidates } from "./candidates.js";
import {
  createProcessedBatch,
  recordProcessedEntry,
  saveProcessedBatch,
} from "./batch.js";
import type { ProcessedBatchResult } from "@openlore/contracts";

export class RepositoryProcessingService {
  async runProcessingForGroup(
    group: Group,
    runId: string,
  ): Promise<ProcessedBatchResult> {
    if (group.deep_analysis_count > 0)
      for (const source of await sourcesService.listSources()) {
        if (
          !source.enabled ||
          source.capability_id !== "github_repository" ||
          (group.source_ids.length && !group.source_ids.includes(source.id))
        )
          continue;
        const collected = await collectionService.discoverSource(source.id);
        if (collected.status === "failed")
          throw new Error(collected.errors[0]?.message || "仓库材料准备失败");
      }
    const pool = listPoolCandidates(group.source_ids, group.task_type);
    const result = createProcessedBatch(pool.length);
    const db = getSqliteDatabase();
    for (const item of pool) {
      if (item.processed || item.busy) {
        result.counts.already_processed++;
        continue;
      }
      result.counts.candidate++;
      if (result.entries.length >= group.deep_analysis_count) continue;
      const article = db
        .prepare("SELECT * FROM articles WHERE id=?")
        .get(item.id) as {
        id: string;
        title: string;
        latest_revision: string;
        author: string;
        published_at: string;
        date_evidence_json: string;
      };
      const study = repositoryStudy(JSON.parse(article.date_evidence_json));
      if (!study) throw new Error("仓库研读材料缺少固定版本信息");
      const revision = db
        .prepare(
          "SELECT content_ref FROM article_revisions WHERE article_id=? AND revision_hash=?",
        )
        .get(item.id, article.latest_revision) as
        { content_ref: string } | undefined;
      if (!revision || !fs.existsSync(revision.content_ref))
        throw new Error("仓库研读材料缺失");
      const content = fs.readFileSync(revision.content_ref, "utf8");
      if (!claimResearchArticle(item.id, group.id, runId)) continue;
      const sources = (
        db
          .prepare(
            "SELECT DISTINCT source_id FROM source_items WHERE article_id=?",
          )
          .all(item.id) as { source_id: string }[]
      ).map((row) => row.source_id);
      recordProcessedEntry(
        group,
        {
          article_id: item.id,
          revision: article.latest_revision,
          slug: articleSlug(article.title),
          title: article.title,
          original_url: study.repository_url,
          author: article.author,
          published_at: article.published_at,
          tags: ["GitHub", "仓库研读"],
          summary: study.focus || "研读源码，解释工作原理与设计取舍",
          organized_markdown: content,
          asset_refs: [],
          evidence_refs: study.files,
          limitations: [],
        },
        "每日仓库研读",
        sources,
        result,
      );
    }
    result.counts.planned = result.entries.length;
    result.counts.deferred = result.counts.candidate - result.counts.planned;
    saveProcessedBatch(runId, result);
    return result;
  }
}
export const repositoryProcessingService = new RepositoryProcessingService();
