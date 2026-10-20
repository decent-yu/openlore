import { feedService } from "../../modules/feed/service.js";
import { completedResearchSql } from "../../modules/research/state.js";
import { articleReviewsService, getArticleReviews, CURRENT_REVIEW_JOIN } from "../../modules/processing/article-reviews.js";
import {
  getPublishedWikiLinks,
  wikiLinkKey,
} from "../../modules/delivery/wiki-links.js";
import fs from "node:fs";
import { LibraryQuerySchema, ReviewArticlesRequestSchema, type LibraryTimeRange } from "@openlore/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { LibraryArticle, LibraryResponse } from "@openlore/contracts";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { settingsService } from "../../modules/settings/service.js";
import {
  calendarDayBounds,
  calendarDateBounds,
} from "../../infrastructure/time/calendar.js";

export const libraryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/library", async (request): Promise<LibraryResponse> => {
    const sqlite = getSqliteDatabase();
    const query = LibraryQuerySchema.parse(request.query || {});
    const {
      source_id: sourceId,
      group_id: groupId,
      search,
      page,
      page_size: pageSize,
    } = query;
    const offset = (page - 1) * pageSize;
    const now = new Date();
    const { timezone } = await settingsService.getSettings();
    const today = calendarDayBounds(now, timezone);
    const threeDaysIso = new Date(now.getTime() - 3 * 86400000).toISOString();
    const nowEnd = new Date(now.getTime() + 1).toISOString();
    const deep = completedResearchSql("a.id");
    const scope: string[] = [];
    const scopeParams: string[] = [];
    if (sourceId) {
      scope.push(
        "EXISTS (SELECT 1 FROM source_items si WHERE si.article_id=a.id AND si.source_id=?)",
      );
      scopeParams.push(sourceId);
    }
    if (groupId) {
      scope.push(
        "EXISTS (SELECT 1 FROM group_items gi WHERE gi.article_id=a.id AND gi.group_id=?)",
      );
      scopeParams.push(groupId);
    }
    if (search) {
      scope.push("(a.title LIKE ? OR a.author LIKE ?)");
      scopeParams.push(`%${search}%`, `%${search}%`);
    }
    const scopedPool = `WITH pool AS (
      SELECT a.*, ${deep} AS deep_flag,
        CASE WHEN review.status='succeeded' THEN 1 ELSE 0 END AS assessed_flag
      FROM articles a ${CURRENT_REVIEW_JOIN}
    ), scoped AS (SELECT * FROM pool a ${scope.length ? "WHERE " + scope.join(" AND ") : ""})`;

    const timeClauses: string[] = [];
    const timeParams: string[] = [];
    const addTime = (
      column: string,
      range: LibraryTimeRange,
      from?: string,
      to?: string,
    ) => {
      if (range === "all") return;
      const bounds =
        range === "today"
          ? today
          : range === "3days"
            ? { start: threeDaysIso, end: nowEnd }
            : {
                start: calendarDateBounds(from!, timezone).start,
                end: calendarDateBounds(to!, timezone).end,
              };
      timeClauses.push(
        `julianday(${column}) >= julianday(?) AND julianday(${column}) < julianday(?)`,
      );
      timeParams.push(bounds.start, bounds.end);
    };
    addTime(
      "a.created_at",
      query.time_range,
      query.discovered_from,
      query.discovered_to,
    );
    addTime(
      "a.published_at",
      query.published_range,
      query.published_from,
      query.published_to,
    );
    const timeWhere = timeClauses.length
      ? "WHERE " + timeClauses.join(" AND ")
      : "";
    const timeCounts = sqlite
      .prepare(
        `${scopedPool} SELECT COUNT(*) AS total_count,
      COUNT(CASE WHEN julianday(a.created_at)>=julianday(?) AND julianday(a.created_at)<julianday(?) THEN 1 END) AS today_count,
      COUNT(CASE WHEN julianday(a.created_at)>=julianday(?) AND julianday(a.created_at)<julianday(?) THEN 1 END) AS three_days_count,
      COUNT(CASE WHEN julianday(a.published_at)>=julianday(?) AND julianday(a.published_at)<julianday(?) THEN 1 END) AS published_today_count,
      COUNT(CASE WHEN julianday(a.published_at)>=julianday(?) AND julianday(a.published_at)<julianday(?) THEN 1 END) AS published_three_days_count
      FROM scoped a`,
      )
      .get(
        ...scopeParams,
        today.start,
        today.end,
        threeDaysIso,
        nowEnd,
        today.start,
        today.end,
        threeDaysIso,
        nowEnd,
      ) as {
      total_count: number;
      today_count: number;
      three_days_count: number;
      published_today_count: number;
      published_three_days_count: number;
    };
    // Scoring and archived research are independent; a deep article may also be scored.
    const stateCounts = sqlite
      .prepare(
        `${scopedPool} SELECT
      COUNT(CASE WHEN NOT a.assessed_flag THEN 1 END) AS unreviewed_count,
      COUNT(CASE WHEN a.assessed_flag THEN 1 END) AS scored_count,
      COUNT(CASE WHEN a.deep_flag THEN 1 END) AS deep_count,
      COUNT(CASE WHEN a.user_interested=1 THEN 1 END) AS interested_count
      FROM scoped a ${timeWhere}`,
      )
      .get(...scopeParams, ...timeParams) as {
      unreviewed_count: number;
      scored_count: number;
      deep_count: number;
      interested_count: number;
    };
    const filterMeta = { ...timeCounts, ...stateCounts };
    const clauses = [...timeClauses];
    if (query.status_filter === "unreviewed")
      clauses.push("NOT a.assessed_flag");
    if (query.status_filter === "scored")
      clauses.push("a.assessed_flag");
    if (query.status_filter === "deep") clauses.push("a.deep_flag");
    if (query.interested_only) clauses.push("a.user_interested=1");
    const whereSql = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    const params = [...scopeParams, ...timeParams];
    const totalFiltered = (
      sqlite
        .prepare(
          `${scopedPool} SELECT COUNT(*) AS count FROM scoped a ${whereSql}`,
        )
        .get(...params) as { count: number }
    ).count;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
    const pageRows = sqlite
      .prepare(
        `${scopedPool} SELECT a.*,
      a.deep_flag AS is_deep_analyzed
      FROM scoped a ${whereSql}
      ORDER BY julianday(a.published_at) DESC, julianday(a.created_at) DESC, a.id LIMIT ? OFFSET ?
    `,
      )
      .all(...params, pageSize, offset) as Array<{
      id: string;
      date_evidence_json: string;
      title: string | null;
      author: string | null;
      canonical_url: string | null;
      published_at: string | null;
      created_at: string;
      updated_at: string | null;
      latest_revision: string | null;
      user_interested: number;
      is_deep_analyzed: number;
    }>;

    const articleIds = pageRows.map((r) => r.id);
    const reviews = getArticleReviews(articleIds);
    const wikiLinks = getPublishedWikiLinks(articleIds, groupId || undefined);
    const groupsByArticleId = new Map<
      string,
      Array<{
        id: string;
        name: string;
        decision?: string;
        is_deep_analyzed?: boolean;
      }>
    >();
    const sourcesByArticleId = new Map<string, string[]>();
    const snippetByRevision = new Map<string, string>();
    const researchArticleWikiUrls = new Map<string, string>();
    const researchByArticleId = new Map<
      string,
      {
        id: string;
        status: string;
        report_markdown: string;
        wiki_url?: string;
        questions: string[];
        evidence: any[];
        finished_at: string | null;
        archived_at: string | null;
      }
    >();

    if (articleIds.length > 0) {
      const placeholders = articleIds.map(() => "?").join(",");

      // Fetch group relations
      const groupRows = sqlite
        .prepare(
          `
          SELECT gi.article_id, g.id as group_id, g.name as group_name, gi.decision, gi.is_deep_analyzed
          FROM group_items gi
          JOIN groups g ON g.id = gi.group_id
          WHERE gi.article_id IN (${placeholders})
        `,
        )
        .all(...articleIds) as Array<{
        article_id: string;
        group_id: string;
        group_name: string;
        decision: string;
        is_deep_analyzed: number;
      }>;

      for (const gr of groupRows) {
        if (!groupsByArticleId.has(gr.article_id)) {
          groupsByArticleId.set(gr.article_id, []);
        }
        groupsByArticleId.get(gr.article_id)!.push({
          id: gr.group_id,
          name: gr.group_name,
          decision: gr.decision,
          is_deep_analyzed: Boolean(gr.is_deep_analyzed),
        });
      }

      // Fetch source items
      const sourceRows = sqlite
        .prepare(
          `
          SELECT si.article_id, si.source_id
          FROM source_items si
          WHERE si.article_id IN (${placeholders})
        `,
        )
        .all(...articleIds) as Array<{ article_id: string; source_id: string }>;

      for (const sr of sourceRows) {
        if (!sourcesByArticleId.has(sr.article_id)) {
          sourcesByArticleId.set(sr.article_id, []);
        }
        const list = sourcesByArticleId.get(sr.article_id)!;
        if (!list.includes(sr.source_id)) {
          list.push(sr.source_id);
        }
      }

      // Fetch revisions for snippet
      const revHashes = pageRows
        .map((r) => r.latest_revision)
        .filter(Boolean) as string[];
      if (revHashes.length > 0) {
        const revPlaceholders = revHashes.map(() => "?").join(",");
        const revRows = sqlite
          .prepare(
            `
            SELECT revision_hash, content_ref
            FROM article_revisions
            WHERE revision_hash IN (${revPlaceholders})
          `,
          )
          .all(...revHashes) as Array<{
          revision_hash: string;
          content_ref: string;
        }>;

        for (const rev of revRows) {
          if (rev.content_ref && fs.existsSync(rev.content_ref)) {
            try {
              const content = fs.readFileSync(rev.content_ref, "utf-8");
              snippetByRevision.set(
                rev.revision_hash,
                content
                  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
                  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
                  .replace(/<[^>]*>/g, " ")
                  .replace(/[#*`]/g, "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 300),
              );
            } catch {
              // Ignore read failure
            }
          }
        }
      }

      // Fetch research tasks
      const researchRows = sqlite
        .prepare(
          `
          SELECT id, article_id, group_id, status, questions_json, evidence_json, report_markdown, finished_at, archived_at
          FROM research_tasks
          WHERE article_id IN (${placeholders}) ${groupId ? "AND group_id=?" : ""}
          ORDER BY created_at DESC, rowid DESC
        `,
        )
        .all(...articleIds, ...(groupId ? [groupId] : [])) as Array<{
        id: string;
        article_id: string;
        group_id: string;
        status: string;
        questions_json: string;
        evidence_json: string;
        report_markdown: string;
        finished_at: string | null;
        archived_at: string | null;
      }>;

      for (const rr of researchRows) {
        if (!researchByArticleId.has(rr.article_id)) {
          const articleWikiUrl = wikiLinks.get(
            wikiLinkKey(rr.group_id, rr.article_id),
          )?.article_url;
          if (articleWikiUrl)
            researchArticleWikiUrls.set(rr.article_id, articleWikiUrl);
          let questions: string[] = [];
          let evidence: any[] = [];
          try {
            questions = JSON.parse(rr.questions_json || "[]");
          } catch {}
          try {
            evidence = JSON.parse(rr.evidence_json || "[]");
          } catch {}

          researchByArticleId.set(rr.article_id, {
            id: rr.id,
            status: rr.status,
            report_markdown: rr.report_markdown || "",
            wiki_url:
              rr.status === "succeeded" && rr.archived_at
                ? wikiLinks.get(wikiLinkKey(rr.group_id, rr.article_id))
                    ?.research_url
                : undefined,
            questions,
            evidence,
            finished_at: rr.finished_at,
            archived_at: rr.archived_at,
          });
        }
      }
    }

    const items: LibraryArticle[] = pageRows.map((r) => ({
      task_type: JSON.parse(r.date_evidence_json || '{}').repository_study ? 'repository_research' : 'article_research',
      id: r.id,
      review: reviews.get(r.id) || null,
      date_evidence: JSON.parse(r.date_evidence_json || "{}"),
      title: r.title || "Untitled",
      author: r.author,
      canonical_url: r.canonical_url,
      published_at: r.published_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      latest_revision: r.latest_revision,
      sources: sourcesByArticleId.get(r.id) || [],
      groups: groupsByArticleId.get(r.id) || [],
      is_deep_analyzed: Boolean(r.is_deep_analyzed),
      user_interested: Boolean(r.user_interested),
      wiki_url:
        researchArticleWikiUrls.get(r.id) ||
        (groupsByArticleId.get(r.id) || [])
          .map(
            (group) => wikiLinks.get(wikiLinkKey(group.id, r.id))?.article_url,
          )
          .find(Boolean),
      body_snippet:
        (r.latest_revision && snippetByRevision.get(r.latest_revision)) || "",
      research: researchByArticleId.get(r.id) || null,
    }));

    return {
      items,
      pagination: {
        page,
        page_size: pageSize,
        total_count: totalFiltered,
        total_pages: totalPages,
      },
      filter_meta: filterMeta,
    };
  });

  fastify.post("/library/review", async (request, reply) => {
    const body = ReviewArticlesRequestSchema.parse(request.body);
    const queued = articleReviewsService.enqueue(body.article_ids, body.force);
    articleReviewsService.processPending().catch(error => request.log.error(error));
    return reply.status(202).send({ queued });
  });

  fastify.post("/library/:id/research", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { group_id: string; instructions?: string };
    return feedService.researchArticle(body.group_id, id);
  });
};
