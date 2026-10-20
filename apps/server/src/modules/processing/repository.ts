import crypto from "node:crypto";
import fs from "node:fs";
import {
  parseGitHubRepository,
  repositoryStudy,
  type Group,
  type ProcessedBatchResult,
  type Source,
} from "@openlore/contracts";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { sourcesService } from "../sources/service.js";
import { collectionService } from "../collection/service.js";
import { claimResearchArticle } from "../research/state.js";
import {
  refreshRepository,
  repositoryStudyService,
  type RepositorySnapshot,
} from "../repository-study/service.js";
import { articleSlug } from "../delivery/archive-layout.js";
import {
  createProcessedBatch,
  recordProcessedEntry,
  saveProcessedBatch,
} from "./batch.js";

export class RepositoryProcessingService {
  async runProcessingForGroup(
    group: Group,
    runId: string,
  ): Promise<ProcessedBatchResult> {
    const db = getSqliteDatabase();
    const sources = (await sourcesService.listSources()).filter(
      (source) =>
        source.enabled &&
        source.capability_id === "github_repository" &&
        (!group.source_ids.length || group.source_ids.includes(source.id)),
    );
    const result = createProcessedBatch(sources.length);
    // Each run gives every selected repository its own allocation.
    const budget = sources.length * group.deep_analysis_count;
    const planned = new Map<string, number>();
    const snapshots = new Map<string, RepositorySnapshot>();
    const last = (id: string) =>
      (
        db
          .prepare(
            "SELECT last_selected_at FROM repository_rotation WHERE source_id=?",
          )
          .get(id) as { last_selected_at: string } | undefined
      )?.last_selected_at || "";
    // Round robin across repositories, including across runs and pipelines. One turn per repository per round.
    sources.sort(
      (a, b) =>
        last(a.id).localeCompare(last(b.id)) || a.id.localeCompare(b.id),
    );
    const selected = new Set<string>();
    while (result.entries.length < budget && sources.length) {
      let progress = false;
      for (const source of sources) {
        if ((planned.get(source.id) || 0) >= group.deep_analysis_count)
          continue;
        const history = repositoryStudyService.history(source.id);
        const unfinished = history.filter(
          (item) =>
            item.status !== "completed" && !selected.has(item.article_id),
        );
        // An existing attempt, including an upload retry, keeps its identity and snapshot.
        const retry = unfinished.find(
          (item) =>
            !selected.has(item.article_id) &&
            item.status !== "running" &&
            (!item.reports.length ||
              item.reports.some((report) => report.group_id === group.id)),
        );
        if (!retry && unfinished.length) continue;
        let articleId = retry?.article_id;
        let created = false;
        if (!articleId) {
          let snapshot = snapshots.get(source.id);
          if (!snapshot) {
            snapshot = await this.snapshot(source);
            snapshots.set(source.id, snapshot);
          }
          articleId = this.allocate(source, snapshot, selected);
          if (!articleId) continue;
          created = true;
        }
        if (!claimResearchArticle(articleId, group.id, runId)) continue;
        // Failed generation uses fresh default-branch code; successful reports awaiting upload stay unchanged.
        if (!created && !retry?.reports.length) {
          let snapshot = snapshots.get(source.id);
          if (!snapshot) {
            snapshot = await this.snapshot(source);
            snapshots.set(source.id, snapshot);
          }
          this.materialize(source, snapshot, articleId);
        }
        const article = db
          .prepare("SELECT * FROM articles WHERE id=?")
          .get(articleId) as {
          title: string;
          latest_revision: string;
          author: string;
          published_at: string;
          date_evidence_json: string;
        };
        const study = repositoryStudy(JSON.parse(article.date_evidence_json));
        if (!study) throw new Error("仓库材料缺少源码快照");
        const revision = db
          .prepare(
            "SELECT content_ref FROM article_revisions WHERE article_id=? AND revision_hash=?",
          )
          .get(articleId, article.latest_revision) as { content_ref: string };
        recordProcessedEntry(
          group,
          {
            article_id: articleId,
            revision: article.latest_revision,
            slug: articleSlug(article.title),
            title: article.title,
            original_url: source.url,
            author: article.author,
            published_at: article.published_at,
            tags: ["GitHub", "仓库研读"],
            summary: study.focus || "深入理解核心架构、设计方案与实现思想",
            organized_markdown: fs.readFileSync(revision.content_ref, "utf8"),
            asset_refs: [],
            evidence_refs: [],
            limitations: [],
          },
          retry ? "继续未交付研读" : "根据来源目标与历史研报持续研读",
          [source.id],
          result,
        );
        db.prepare(
          "INSERT INTO repository_rotation(source_id,last_selected_at) VALUES (?,?) ON CONFLICT(source_id) DO UPDATE SET last_selected_at=excluded.last_selected_at",
        ).run(
          source.id,
          `${new Date().toISOString()}:${String(result.entries.length).padStart(3, "0")}`,
        );
        selected.add(articleId);
        planned.set(source.id, (planned.get(source.id) || 0) + 1);
        progress = true;
      }
      if (!progress) break;
    }
    result.counts.candidate = result.entries.length;
    result.counts.planned = result.entries.length;
    saveProcessedBatch(runId, result);
    return result;
  }

  private async snapshot(source: Source): Promise<RepositorySnapshot> {
    try {
      const snapshot = await refreshRepository(source);
      await sourcesService.updateLastPolled(source.id, true);
      return snapshot;
    } catch (error: any) {
      await sourcesService.updateLastPolled(source.id, false, error.message);
      throw error;
    }
  }

  private allocate(
    source: Source,
    snapshot: RepositorySnapshot,
    selected: Set<string>,
  ): string | undefined {
    const id = `art_${crypto.randomUUID()}`;
    // Allocation and material are durable before claims/research. Source-wide IDs survive other pipelines.
    return getSqliteDatabase().transaction(() => {
      if (
        repositoryStudyService
          .history(source.id)
          .some(
            (item) =>
              item.status !== "completed" && !selected.has(item.article_id),
          )
      )
        return undefined;
      this.materialize(source, snapshot, id);
      return id;
    })();
  }

  private materialize(
    source: Source,
    snapshot: RepositorySnapshot,
    articleId: string,
  ): void {
    const repository = parseGitHubRepository(source.url)!;
    const now = new Date().toISOString();
    const study = {
      repository_url: source.url,
      directory: repository.directory,
      source_id: source.id,
      study_id: articleId,
      commit: snapshot.commit,
      day: now.slice(0, 10),
      focus: source.options.research_focus,
      files: snapshot.files,
      questions: [],
    };
    const existing = getSqliteDatabase()
      .prepare("SELECT title FROM articles WHERE id=?")
      .get(articleId) as { title: string } | undefined;
    collectionService.persistContentItem(
      {
        source_id: source.id,
        source_item_id: `${source.id}:${articleId}`,
        native_id: articleId,
        original_url: source.url,
        final_url: source.url,
        canonical_url: `${source.url}?openlore-study=${articleId}`,
        title:
          existing?.title ||
          `${repository.owner}/${repository.repo} · 深入研读`,
        author: repository.owner,
        published_at: now,
        date_evidence: { repository_study: study },
        body: {
          value: `# ${repository.owner}/${repository.repo}\n\n研读目标：${study.focus || "核心架构、设计方案与实现思想"}\n默认分支：${snapshot.branch}\nCommit：${snapshot.commit}\n\n## 本地完整目录\n${snapshot.files.join("\n")}\n\n## README\n${snapshot.readme}`,
          format: "markdown",
          completeness: "full",
        },
        attachments: [],
        fetched_at: now,
        fetch_method: "github_repository",
        issues: [],
      },
      articleId,
    );
  }
}
export const repositoryProcessingService = new RepositoryProcessingService();
