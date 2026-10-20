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
import { repositoryStudyService } from "../repository-study/service.js";
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
          articleId = this.allocate(source, selected, runId);
          if (!articleId) continue;
          created = true;
        }
        if (!claimResearchArticle(articleId, group.id, runId, Boolean(retry)))
          continue;
        // Publication retries keep their approved report; new research sends only intent.
        if (!created && !retry?.reports.some((report) => !report.archived_at))
          this.materialize(source, articleId, runId);
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
        if (!study) throw new Error("仓库研读缺少来源与目标");
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

  /** Explicit manual research sends a fresh source intent to the execution machine. */
  async prepareManualResearch(
    group: Group,
    articleId: string,
  ): Promise<string> {
    const db = getSqliteDatabase();
    const row = db
      .prepare("SELECT date_evidence_json FROM articles WHERE id=?")
      .get(articleId) as { date_evidence_json: string } | undefined;
    const study = repositoryStudy(JSON.parse(row?.date_evidence_json || "{}"));
    if (!study) throw new Error("仓库研读缺少源码版本信息");
    const sourceId =
      study.source_id ||
      (
        db
          .prepare(
            "SELECT source_id FROM source_items WHERE article_id=? LIMIT 1",
          )
          .get(articleId) as { source_id: string } | undefined
      )?.source_id;
    const source = sourceId ? await sourcesService.getSource(sourceId) : null;
    if (!source || source.capability_id !== "github_repository")
      throw new Error("仓库来源不存在");
    this.materialize(source, articleId);
    return articleId;
  }

  private allocate(
    source: Source,
    selected: Set<string>,
    runId: string,
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
      this.materialize(source, id, runId);
      return id;
    })();
  }

  private materialize(
    source: Source,
    articleId: string,
    runId?: string,
  ): void {
    const repository = parseGitHubRepository(source.url)!;
    const now = new Date().toISOString();
    const old = getSqliteDatabase()
      .prepare("SELECT date_evidence_json FROM articles WHERE id=?")
      .get(articleId) as { date_evidence_json: string } | undefined;
    const previous = repositoryStudy(
      JSON.parse(old?.date_evidence_json || "{}"),
    );
    const study = {
      repository_url: source.url,
      directory: repository.directory,
      source_id: source.id,
      study_id: articleId,
      run_id: runId,
      day: now.slice(0, 10),
      focus: source.options.research_focus,
      questions: previous?.questions || [],
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
          value: `# ${repository.owner}/${repository.repo}\n\n研读目标：${study.focus || "核心架构、设计方案与实现思想"}\n仓库：${source.url}\n源码由 AI 执行器在研读时准备。`,
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
