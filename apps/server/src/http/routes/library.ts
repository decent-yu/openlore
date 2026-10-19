import { getPublishedWikiLinks, wikiLinkKey } from '../../modules/delivery/wiki-links.js';
import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import type { LibraryArticle, LibraryResponse } from '@openlore/contracts';
import { getSqliteDatabase } from '../../infrastructure/persistence/sqlite/db.js';
import { researchService } from '../../modules/research/service.js';
import { settingsService } from '../../modules/settings/service.js';
import { calendarDayBounds } from '../../infrastructure/time/calendar.js';

interface LibraryQuery {
  time_range?: 'today' | '3days' | 'published7' | 'all';
  status_filter?: 'all' | 'selected' | 'deep' | 'interested';
  source_id?: string;
  group_id?: string;
  search?: string;
  page?: string | number;
  page_size?: string | number;
}

export const libraryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: LibraryQuery }>('/library', async (request): Promise<LibraryResponse> => {
    const sqlite = getSqliteDatabase();
    const query = request.query || {};

    const timeRange = query.time_range || 'all';
    const statusFilter = query.status_filter || 'all';
    const sourceId = (query.source_id || '').trim();
    const groupId = (query.group_id || '').trim();
    const search = (query.search || '').trim();
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(query.page_size) || 12));
    const offset = (page - 1) * pageSize;

    const now = new Date();
    const { timezone } = await settingsService.getSettings();
    const today = calendarDayBounds(now, timezone);
    const threeDaysIso = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Calculate filter_meta (scoped to source_id or group_id if provided)
    const metaSourceClause = sourceId
      ? 'WHERE EXISTS (SELECT 1 FROM source_items si WHERE si.article_id = a.id AND si.source_id = ?)'
      : groupId
      ? 'WHERE EXISTS (SELECT 1 FROM group_items gi WHERE gi.article_id = a.id AND gi.group_id = ?)'
      : '';
    const metaParams = sourceId
      ? [today.start, today.end, threeDaysIso, sourceId]
      : groupId
      ? [today.start, today.end, threeDaysIso, groupId]
      : [today.start, today.end, threeDaysIso];

    const metaRow = sqlite
      .prepare(`
        SELECT
          COUNT(*) as total_count,
          COUNT(CASE WHEN a.created_at >= ? AND a.created_at < ? THEN 1 END) as today_count,
          COUNT(CASE WHEN a.created_at >= ? THEN 1 END) as three_days_count,
          COUNT(CASE WHEN EXISTS(SELECT 1 FROM group_items gi WHERE gi.article_id = a.id AND gi.decision = 'selected') THEN 1 END) as selected_count,
          COUNT(CASE WHEN EXISTS(SELECT 1 FROM group_items gi WHERE gi.article_id = a.id AND gi.is_deep_analyzed = 1) OR EXISTS(SELECT 1 FROM research_tasks rt WHERE rt.article_id = a.id AND rt.status = 'succeeded') THEN 1 END) as deep_count,
          COUNT(CASE WHEN a.user_interested = 1 THEN 1 END) as interested_count
        FROM articles a
        ${metaSourceClause}
      `)
      .get(...metaParams) as {
        total_count: number;
        today_count: number;
        three_days_count: number;
        selected_count: number;
        deep_count: number;
        interested_count: number;
      };

    const filterMeta = {
      total_count: metaRow?.total_count || 0,
      today_count: metaRow?.today_count || 0,
      three_days_count: metaRow?.three_days_count || 0,
      selected_count: metaRow?.selected_count || 0,
      deep_count: metaRow?.deep_count || 0,
      interested_count: metaRow?.interested_count || 0,
    };

    // 2. Build where clauses for filtered list
    const whereClauses: string[] = [];
    const whereParams: any[] = [];

    if (sourceId) {
      whereClauses.push('EXISTS (SELECT 1 FROM source_items si WHERE si.article_id = a.id AND si.source_id = ?)');
      whereParams.push(sourceId);
    } else if (groupId) {
      whereClauses.push('EXISTS (SELECT 1 FROM group_items gi WHERE gi.article_id = a.id AND gi.group_id = ?)');
      whereParams.push(groupId);
    }

    if (timeRange === 'published7') {
      whereClauses.push('julianday(a.published_at) >= julianday(?) AND julianday(a.published_at) <= julianday(?)');
      whereParams.push(new Date(now.getTime()-7*86400000).toISOString(),now.toISOString());
    } else if (timeRange === 'today') {
      whereClauses.push('a.created_at >= ? AND a.created_at < ?');
      whereParams.push(today.start, today.end);
    } else if (timeRange === '3days') {
      whereClauses.push('a.created_at >= ?');
      whereParams.push(threeDaysIso);
    }

    if (statusFilter === 'selected') {
      whereClauses.push("EXISTS (SELECT 1 FROM group_items gi WHERE gi.article_id = a.id AND gi.decision = 'selected')");
    } else if (statusFilter === 'deep') {
      whereClauses.push(
        "(EXISTS (SELECT 1 FROM group_items gi WHERE gi.article_id = a.id AND gi.is_deep_analyzed = 1) OR EXISTS (SELECT 1 FROM research_tasks rt WHERE rt.article_id = a.id AND rt.status = 'succeeded'))"
      );
    } else if (statusFilter === 'interested') {
      whereClauses.push('a.user_interested = 1');
    }

    if (search) {
      whereClauses.push('(a.title LIKE ? OR a.author LIKE ?)');
      whereParams.push(`%${search}%`, `%${search}%`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 3. Count total items matching filter
    const totalRow = sqlite
      .prepare(`SELECT COUNT(*) as count FROM articles a ${whereSql}`)
      .get(...whereParams) as { count: number };
    const totalFiltered = totalRow?.count || 0;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));

    // 4. Query current page items
    const pageRows = sqlite
      .prepare(`
        SELECT
          a.id, a.content_kind, a.date_evidence_json,
          a.title,
          a.author,
          a.canonical_url,
          a.published_at,
          a.created_at,
          a.updated_at,
          a.latest_revision,
          a.user_interested,
          EXISTS (SELECT 1 FROM group_items gi WHERE gi.article_id = a.id AND gi.decision = 'selected') as is_selected,
          (EXISTS (SELECT 1 FROM group_items gi WHERE gi.article_id = a.id AND gi.is_deep_analyzed = 1) OR EXISTS (SELECT 1 FROM research_tasks rt WHERE rt.article_id = a.id AND rt.status = 'succeeded')) as is_deep_analyzed
        FROM articles a
        ${whereSql}
        ORDER BY julianday(a.published_at) DESC, a.created_at DESC, a.id
        LIMIT ? OFFSET ?
      `)
      .all(...whereParams, pageSize, offset) as Array<{
        id: string;
        content_kind: string; date_evidence_json: string;
        title: string | null;
        author: string | null;
        canonical_url: string | null;
        published_at: string | null;
        created_at: string;
        updated_at: string | null;
        latest_revision: string | null;
        user_interested: number;
        is_selected: number;
        is_deep_analyzed: number;
      }>;

    const articleIds = pageRows.map((r) => r.id);
    const wikiLinks = getPublishedWikiLinks(articleIds, groupId || undefined);
    const groupsByArticleId = new Map<string, Array<{ id: string; name: string; decision?: string; is_deep_analyzed?: boolean }>>();
    const sourcesByArticleId = new Map<string, string[]>();
    const snippetByRevision = new Map<string, string>();
    const researchArticleWikiUrls = new Map<string, string>();
    const researchByArticleId = new Map<string, {
      id: string;
      status: string;
      report_markdown: string;
      wiki_url?: string;
      questions: string[];
      evidence: any[];
      finished_at: string | null;
    }>();

    if (articleIds.length > 0) {
      const placeholders = articleIds.map(() => '?').join(',');

      // Fetch group relations
      const groupRows = sqlite
        .prepare(`
          SELECT gi.article_id, g.id as group_id, g.name as group_name, gi.decision, gi.is_deep_analyzed
          FROM group_items gi
          JOIN groups g ON g.id = gi.group_id
          WHERE gi.article_id IN (${placeholders})
        `)
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
        .prepare(`
          SELECT si.article_id, si.source_id
          FROM source_items si
          WHERE si.article_id IN (${placeholders})
        `)
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
      const revHashes = pageRows.map((r) => r.latest_revision).filter(Boolean) as string[];
      if (revHashes.length > 0) {
        const revPlaceholders = revHashes.map(() => '?').join(',');
        const revRows = sqlite
          .prepare(`
            SELECT revision_hash, content_ref
            FROM article_revisions
            WHERE revision_hash IN (${revPlaceholders})
          `)
          .all(...revHashes) as Array<{ revision_hash: string; content_ref: string }>;

        for (const rev of revRows) {
          if (rev.content_ref && fs.existsSync(rev.content_ref)) {
            try {
              const content = fs.readFileSync(rev.content_ref, 'utf-8');
              snippetByRevision.set(rev.revision_hash, content.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, ' ').replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300));
            } catch {
              // Ignore read failure
            }
          }
        }
      }

      // Fetch research tasks
      const researchRows = sqlite
        .prepare(`
          SELECT id, article_id, group_id, status, questions_json, evidence_json, report_markdown, finished_at
          FROM research_tasks
          WHERE article_id IN (${placeholders}) ${groupId ? 'AND group_id=?' : ''}
          ORDER BY created_at DESC, rowid DESC
        `)
        .all(...articleIds, ...(groupId ? [groupId] : [])) as Array<{
          id: string;
          article_id: string;
          group_id: string;
          status: string;
          questions_json: string;
          evidence_json: string;
          report_markdown: string;
          finished_at: string | null;
        }>;

      for (const rr of researchRows) {
        if (!researchByArticleId.has(rr.article_id)) {
          const articleWikiUrl = wikiLinks.get(wikiLinkKey(rr.group_id, rr.article_id))?.article_url;
          if (articleWikiUrl) researchArticleWikiUrls.set(rr.article_id, articleWikiUrl);
          let questions: string[] = [];
          let evidence: any[] = [];
          try {
            questions = JSON.parse(rr.questions_json || '[]');
          } catch {}
          try {
            evidence = JSON.parse(rr.evidence_json || '[]');
          } catch {}

          researchByArticleId.set(rr.article_id, {
            id: rr.id,
            status: rr.status,
            report_markdown: rr.report_markdown || '',
            wiki_url: rr.status === 'succeeded' ? wikiLinks.get(wikiLinkKey(rr.group_id, rr.article_id))?.research_url : undefined,
            questions,
            evidence,
            finished_at: rr.finished_at,
          });
        }
      }
    }

    const items: LibraryArticle[] = pageRows.map((r) => ({
      id: r.id,
      content_kind: r.content_kind, date_evidence: JSON.parse(r.date_evidence_json || '{}'),
      title: r.title || 'Untitled',
      author: r.author,
      canonical_url: r.canonical_url,
      published_at: r.published_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      latest_revision: r.latest_revision,
      sources: sourcesByArticleId.get(r.id) || [],
      groups: groupsByArticleId.get(r.id) || [],
      is_selected: Boolean(r.is_selected),
      is_deep_analyzed: Boolean(r.is_deep_analyzed),
      user_interested: Boolean(r.user_interested),
      wiki_url: researchArticleWikiUrls.get(r.id) || (groupsByArticleId.get(r.id) || []).map((group) => wikiLinks.get(wikiLinkKey(group.id, r.id))?.article_url).find(Boolean),
      body_snippet: (r.latest_revision && snippetByRevision.get(r.latest_revision)) || '',
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

  fastify.post('/library/:id/research', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { group_id: string; instructions?: string };
    return researchService.runResearchOnArticle(body.group_id, id, body.instructions);
  });
};
