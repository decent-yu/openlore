import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { DailyFeedArticle, Group } from "@openlore/contracts";
import {
  getDb,
  getSqliteDatabase,
} from "../../infrastructure/persistence/sqlite/db.js";
import {
  articlesTable,
  runsTable,
} from "../../infrastructure/persistence/sqlite/schema.js";
import { groupsService } from "../groups/service.js";
import { researchService } from "../research/service.js";
import { deliveryService } from "../delivery/service.js";
import {
  claimResearchArticle,
  releaseResearchClaims,
} from "../research/state.js";
import { settingsService } from "../settings/service.js";
import { getPublishedWikiLinks, wikiLinkKey } from "../delivery/wiki-links.js";
import { listPoolCandidates } from "../processing/candidates.js";

export interface DailyFeedResponse {
  group: Group | null;
  groups: Array<{ id: string; name: string }>;
  date: string;
  has_run_today: boolean;
  current_run?: {
    id: string;
    status: string;
    stage: string;
    error_message?: string | null;
  };
  available_dates: string[];
  stats: {
    pool_count: number;
    deep_analyzed_count: number;
    pending_count: number;
  };
  deep_articles: DailyFeedArticle[];
}
export class FeedService {
  async getDailyFeed(
    groupId?: string,
    dateStr?: string,
  ): Promise<DailyFeedResponse> {
    const groups = await groupsService.listGroups();
    const { timezone } = await settingsService.getSettings();
    const dateKey = (value: string | Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value));
    const today = dateKey(new Date());
    const date =
      dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : today;
    const group = groups.find((item) => item.id === groupId) || null;
    const scopedGroups = groupId ? (group ? [group] : []) : groups;
    const groupsById = new Map(scopedGroups.map((item) => [item.id, item]));
    const response: DailyFeedResponse = {
      group,
      groups: groups.map(({ id, name }) => ({ id, name })),
      date,
      has_run_today: false,
      available_dates: [today],
      stats: { pool_count: 0, deep_analyzed_count: 0, pending_count: 0 },
      deep_articles: [],
    };
    if (!scopedGroups.length) return response;
    const db = getSqliteDatabase();
    const runs = getDb()
      .select()
      .from(runsTable)
      .where(group ? eq(runsTable.groupId, group.id) : undefined)
      .orderBy(desc(runsTable.startedAt))
      .all()
      .filter((run) => groupsById.has(run.groupId));
    const current =
      runs.find((run) => run.status === "running") ||
      runs.find((run) => dateKey(run.finishedAt || run.startedAt) === date);
    response.current_run = current
      ? {
          id: current.id,
          status: current.status,
          stage: current.stage,
          error_message: current.errorMessage,
        }
      : undefined;
    const sourceIds = scopedGroups.some((item) => !item.source_ids.length)
      ? []
      : [...new Set(scopedGroups.flatMap((item) => item.source_ids))];
    const pool = listPoolCandidates(sourceIds);
    response.stats.pool_count = pool.length;
    response.stats.pending_count = pool.filter(
      (item) => !item.processed && !item.busy,
    ).length;
    const tasks = (await researchService.listResearchTasks(group?.id))
      .filter(
        (task) =>
          groupsById.has(task.group_id) &&
          task.status === "succeeded" &&
          task.archived_at,
      )
      .sort((a, b) => b.archived_at!.localeCompare(a.archived_at!));
    response.available_dates = [
      ...new Set([today, ...tasks.map((task) => dateKey(task.archived_at!))]),
    ]
      .sort()
      .reverse();
    response.has_run_today =
      tasks.some((task) => dateKey(task.archived_at!) === today) ||
      runs.some(
        (run) =>
          run.status === "succeeded" &&
          dateKey(run.finishedAt || run.startedAt) === today,
      );
    const seen = new Set<string>();
    const dated = tasks.filter(
      (task) =>
        dateKey(task.archived_at!) === date &&
        !seen.has(wikiLinkKey(task.group_id, task.article_id)) &&
        Boolean(seen.add(wikiLinkKey(task.group_id, task.article_id))),
    );
    const links = getPublishedWikiLinks(
      dated.map((task) => task.article_id),
      group?.id,
    );
    for (const task of dated) {
      const group = groupsById.get(task.group_id)!;
      const article = getDb()
        .select()
        .from(articlesTable)
        .where(eq(articlesTable.id, task.article_id))
        .get();
      if (!article) continue;
      const wiki = links.get(wikiLinkKey(group.id, article.id));
      const delivery = db
        .prepare(
          `SELECT d.commit_sha,d.commit_url FROM deliveries d
        LEFT JOIN artifact_bundles b ON b.batch_id=d.batch_id
        WHERE d.group_id=? AND d.target_kind='github' AND d.status IN ('updated','unchanged')
        AND (d.batch_id=? OR (b.bundle_json IS NOT NULL AND EXISTS (
          SELECT 1 FROM json_each(b.bundle_json,'$.entries') e WHERE json_extract(e.value,'$.article_id')=?)))
        ORDER BY d.created_at DESC,d.rowid DESC LIMIT 1`,
        )
        .get(group.id, `research_${task.id}`, article.id) as
        { commit_sha: string | null; commit_url: string | null } | undefined;
      const assessment = db
        .prepare(
          "SELECT r.result_json FROM article_reviews r JOIN articles a ON a.id=r.article_id AND a.latest_revision=r.revision_hash WHERE r.article_id=? AND r.status='succeeded'",
        )
        .get(article.id) as { result_json: string } | undefined;
      let summary = "";
      if (assessment) {
        try {
          summary = JSON.parse(assessment.result_json).summary || "";
        } catch {}
      }
      const sources = db
        .prepare(
          `
        SELECT DISTINCT s.id, s.name FROM source_items si
        JOIN sources s ON s.id=si.source_id
        WHERE si.article_id=? ORDER BY s.name, s.id
      `,
        )
        .all(article.id) as Array<{ id: string; name: string }>;
      response.deep_articles.push({
        id: article.id,
        title: article.title || "Untitled",
        slug: task.article_slug,
        author: article.author,
        original_url: article.canonicalUrl,
        published_at: article.publishedAt,
        sources,
        summary,
        tags: [group.name],
        group_id: group.id,
        group_name: group.name,
        is_deep_analyzed: true,
        user_interested: Boolean(article.userInterested),
        selection_source: "research",
        wiki_url: wiki?.article_url,
        research: {
          id: task.id,
          status: task.status,
          report_markdown: task.report_markdown,
          wiki_url: wiki?.research_url,
          questions: task.questions,
          evidence: task.evidence,
        },
        delivery: delivery?.commit_url
          ? { commit_sha: delivery.commit_sha, commit_url: delivery.commit_url }
          : undefined,
      });
    }
    response.stats.deep_analyzed_count = response.deep_articles.length;
    return response;
  }

  async researchArticle(groupId: string, articleId: string) {
    const group = await groupsService.getGroup(groupId);
    if (!group) throw new Error("流水线任务不存在");
    const owner = `manual_${crypto.randomUUID()}`;
    if (!claimResearchArticle(articleId, groupId, owner, true))
      throw Object.assign(new Error("文章正在调研，请稍候"), {
        statusCode: 409,
      });
    try {
      const task = await researchService.runResearchOnArticle(
        groupId,
        articleId,
        group.research_instructions,
        undefined,
        owner,
      );
      if (task.status !== "succeeded") return task;
      const archive = await deliveryService.deliverResearchReport(group, task);
      if (
        !["updated", "unchanged"].includes(archive.status) ||
        archive.errors.length
      )
        throw Object.assign(
          new Error(
            `研报已生成，GitHub 归档失败：${archive.errors.map((error) => error.message).join("；") || archive.status}`,
          ),
          { statusCode: 502 },
        );
      getDb()
        .update(articlesTable)
        .set({ userInterested: true, updatedAt: new Date().toISOString() })
        .where(eq(articlesTable.id, articleId))
        .run();
      return (await researchService.listResearchTasks(groupId)).find(
        (item) => item.id === task.id,
      )!;
    } finally {
      releaseResearchClaims(owner);
    }
  }
  async toggleArticleInterest(articleId: string, interested?: boolean) {
    const db = getDb();
    const article = db
      .select()
      .from(articlesTable)
      .where(eq(articlesTable.id, articleId))
      .get();
    if (!article) throw new Error("文章不存在");
    const value = interested ?? !article.userInterested;
    db.update(articlesTable)
      .set({ userInterested: value, updatedAt: new Date().toISOString() })
      .where(eq(articlesTable.id, articleId))
      .run();
    return { ok: true, article_id: articleId, user_interested: value };
  }
}
export const feedService = new FeedService();
