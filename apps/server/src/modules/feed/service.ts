import { getPublishedWikiLinks, wikiLinkKey } from '../delivery/wiki-links.js';
import fs from 'node:fs';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { RunOutputSchema, type DailyFeedArticle, type Group } from '@openlore/contracts';
import { getDb } from '../../infrastructure/persistence/sqlite/db.js';
import {
  articleRevisionsTable,
  articlesTable,
  deliveriesTable,
  groupItemsTable,
  groupsTable,
  researchTasksTable,
  sourceItemsTable,
  runsTable,
} from '../../infrastructure/persistence/sqlite/schema.js';
import { deliveryService } from '../delivery/service.js';
import { groupsService } from '../groups/service.js';
import { researchService } from '../research/service.js';
import { calendarDayBounds } from '../../infrastructure/time/calendar.js';
import { listPoolCandidates } from '../processing/candidates.js';
import { settingsService } from '../settings/service.js';

export interface DailyFeedResponse {
  group: Group | null;
  groups: Array<{ id: string; name: string }>;
  date: string;
  has_run_today: boolean;
  current_run?: { id: string; status: string; stage: string; error_message?: string | null };

  available_dates: string[];
  stats: {
    pool_count: number;
    total_selected_count: number;
    deep_analyzed_count: number;
    candidate_remaining_count: number;
  };
  deep_articles: DailyFeedArticle[];
  candidate_articles: DailyFeedArticle[];
}

export class FeedService {
  async getDailyFeed(groupId?: string, dateStr?: string): Promise<DailyFeedResponse> {
    const db = getDb();
    const allGroups = await groupsService.listGroups();
    const now = new Date();
    const settings = await settingsService.getSettings();
    const dateKey = (date: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
    const todayStr = dateKey(now);
    const targetDate = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : todayStr;

    if (allGroups.length === 0) {
      return {
        group: null,
        groups: [],
        date: targetDate,
        has_run_today: false,
        available_dates: [todayStr],
        stats: {
          pool_count: 0,
          total_selected_count: 0,
          deep_analyzed_count: 0,
          candidate_remaining_count: 0,
        },
        deep_articles: [],
        candidate_articles: [],
      };
    }

    const group = (groupId ? allGroups.find((g) => g.id === groupId) : allGroups[0]) || allGroups[0];

    // Compute available dates from group_items and runs
    const availableDatesSet = new Set<string>();
    availableDatesSet.add(todayStr);

    const allGroupItems = db
      .select({ updatedAt: groupItemsTable.updatedAt })
      .from(groupItemsTable)
      .where(and(eq(groupItemsTable.groupId, group.id), eq(groupItemsTable.decision, 'selected')))
      .all();
    for (const gi of allGroupItems) {
      if (gi.updatedAt) availableDatesSet.add(dateKey(gi.updatedAt));
    }

    const taskRuns = db.select().from(runsTable).where(eq(runsTable.groupId, group.id)).orderBy(desc(runsTable.startedAt)).all();
    for (const run of taskRuns) {
      if (run.status === 'succeeded') availableDatesSet.add(dateKey(run.finishedAt || run.startedAt));
    }
    const availableDates = Array.from(availableDatesSet).sort().reverse();
    const pool = listPoolCandidates(group.source_ids);
    const currentRun = taskRuns.find((run) => run.status === 'running' || dateKey(run.finishedAt || run.startedAt) === targetDate);
    const finishedOnDate = taskRuns.filter((run) => run.status === 'succeeded' && dateKey(run.finishedAt || run.startedAt) === targetDate);
    const archivedOutputs = new Map<string, ReturnType<typeof RunOutputSchema.parse>['entries'][number]>();
    const archivedCommits = new Map<string, string>();
    for (const run of finishedOnDate) {
      const output = RunOutputSchema.parse(JSON.parse(run.outputJson || '{}'));
      for (const entry of output.entries) {
        if (archivedOutputs.has(entry.article_id)) continue;
        archivedOutputs.set(entry.article_id, entry);
        if (output.commit_url) archivedCommits.set(entry.article_id, output.commit_url);
      }
    }
    // Get selected group items
    const rawGroupItems = db
      .select()
      .from(groupItemsTable)
      .where(and(eq(groupItemsTable.groupId, group.id), eq(groupItemsTable.decision, 'selected')))
      .orderBy(desc(groupItemsTable.updatedAt))
      .all();

    // Keep archived selections available on their original delivery date.
    const validGroupItems = rawGroupItems.filter((gi) => db.select({id:articlesTable.id}).from(articlesTable).where(eq(articlesTable.id,gi.articleId)).get());

    const itemsOnDate = validGroupItems.filter(
      (gi) => archivedOutputs.has(gi.articleId) || (finishedOnDate.some((run) => run.outputJson === '{}') && Boolean(gi.updatedAt) && dateKey(gi.updatedAt) === targetDate),
    );
    const hasRunToday = taskRuns.some((run) => run.status === 'succeeded' && dateKey(run.finishedAt || run.startedAt) === todayStr);
    const groupItems = itemsOnDate;

    const deepArticles: DailyFeedArticle[] = [];
    const candidateArticles: DailyFeedArticle[] = [];
    let completedResearch = 0;
    const wikiLinks = getPublishedWikiLinks(groupItems.map((item) => item.articleId), group.id);

    for (const gi of groupItems) {
      const art = db.select().from(articlesTable).where(eq(articlesTable.id, gi.articleId)).get();
      if (!art) continue;

      const savedOutput = archivedOutputs.get(art.id);
      let summary = savedOutput?.summary || gi.reason || '';
      if (!summary && art.latestRevision) {
        const rev = db
          .select()
          .from(articleRevisionsTable)
          .where(eq(articleRevisionsTable.revisionHash, art.latestRevision))
          .get();
        if (rev && fs.existsSync(rev.contentRef)) {
          summary = fs.readFileSync(rev.contentRef, 'utf-8').slice(0, 200).replace(/[#*`\n]/g, ' ').trim();
        }
      }

      // Check research task
      const researchTask = db
        .select()
        .from(researchTasksTable)
        .where(
          and(
            eq(researchTasksTable.groupId, group.id),
            eq(researchTasksTable.articleId, art.id),
          ),
        )
        .orderBy(desc(researchTasksTable.createdAt))
        .get();

      const isDeep = Boolean(gi.isDeepAnalyzed || (researchTask && researchTask.status === 'succeeded'));
      if (isDeep) completedResearch++;
      const researchDelivery = researchTask ? db.select().from(deliveriesTable).where(and(
        eq(deliveriesTable.groupId, group.id),
        eq(deliveriesTable.batchId, `research_${researchTask.id}`),
        eq(deliveriesTable.targetKind, 'github'),
      )).get() : undefined;
      const archiveUrl = researchDelivery
        ? (['updated', 'unchanged'].includes(researchDelivery.status) ? researchDelivery.commitUrl : null)
        : archivedCommits.get(art.id);

      const wiki = wikiLinks.get(wikiLinkKey(group.id, art.id));
      const feedArticle: DailyFeedArticle = {
        wiki_url: wiki?.article_url,
        id: art.id,
        title: art.title || 'Untitled',
        slug: art.id,
        author: art.author,
        original_url: art.canonicalUrl,
        published_at: art.publishedAt,
        summary: summary || '暂无摘要描述',
        tags: [group.name.split(' ')[0] || 'Tech'],
        group_id: group.id,
        group_name: group.name,
        is_deep_analyzed: isDeep,
        user_interested: Boolean(art.userInterested),
        selection_source: gi.selectionSource || 'ai_daily_auto',
        research: researchTask
          ? {
              id: researchTask.id,
              status: researchTask.status,
              report_markdown: researchTask.reportMarkdown,
              wiki_url: researchTask.status === 'succeeded' ? wiki?.research_url : undefined,
              questions: JSON.parse(researchTask.questionsJson || '[]'),
              evidence: JSON.parse(researchTask.evidenceJson || '[]'),
            }
          : null,
        delivery:
          archiveUrl
            ? {
                commit_sha: archiveUrl.split('/').pop(),
                commit_url: archiveUrl,
              }
            : null,
      };

      if (isDeep && deepArticles.length < (group.deep_analysis_count ?? 3)) {
        deepArticles.push(feedArticle);
      } else {
        candidateArticles.push(feedArticle);
      }
    }

    return {
      group,
      groups: allGroups.map((g) => ({ id: g.id, name: g.name })),
      date: targetDate,
      has_run_today: hasRunToday,
      current_run: currentRun ? { id: currentRun.id, status: currentRun.status, stage: currentRun.stage, error_message: currentRun.errorMessage } : undefined,
      available_dates: availableDates,
      stats: {
        pool_count: pool.length,
        total_selected_count: groupItems.length,
        deep_analyzed_count: completedResearch,
        candidate_remaining_count: pool.filter(article=>!article.processed).length,
      },
      deep_articles: deepArticles,
      candidate_articles: candidateArticles,
    };
  }

  async researchArticle(
    groupId: string,
    articleId: string,
    source: 'user_interest' | 'ai_daily_auto' = 'user_interest',
  ) {
    const group = await groupsService.getGroup(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);

    const resTask = await researchService.runResearchOnArticle(
      groupId,
      articleId,
      group.research_instructions,
    );

    if (resTask && resTask.status === 'succeeded') {
      const archive = await deliveryService.deliverResearchReport(group, resTask);
      if (archive.status === 'failed' || archive.status === 'conflict' || archive.errors.length) {
        throw Object.assign(new Error(`研报已生成，GitHub 归档失败：${archive.errors.map(error => error.message).join('；') || archive.status}`), {statusCode: 502});
      }

      const db = getDb();
      const now = new Date().toISOString();

      // Automatically mark as interested since user requested deep research
      db.update(articlesTable)
        .set({ userInterested: true, updatedAt: now })
        .where(eq(articlesTable.id, articleId))
        .run();

      db.update(groupItemsTable)
        .set({
          isDeepAnalyzed: true,
          selectionSource: source,
          updatedAt: now,
        })
        .where(
          and(
            eq(groupItemsTable.groupId, groupId),
            eq(groupItemsTable.articleId, articleId),
          ),
        )
        .run();
    }

    return resTask;
  }

  async toggleArticleInterest(
    articleId: string,
    interested?: boolean,
    groupId?: string,
  ) {
    const db = getDb();
    const art = db.select().from(articlesTable).where(eq(articlesTable.id, articleId)).get();
    if (!art) throw new Error(`Article not found: ${articleId}`);

    const newInterested = interested !== undefined ? interested : !art.userInterested;
    const now = new Date().toISOString();

    db.update(articlesTable)
      .set({ userInterested: newInterested, updatedAt: now })
      .where(eq(articlesTable.id, articleId))
      .run();

    if (groupId) {
      db.update(groupItemsTable)
        .set({
          selectionSource: newInterested ? 'user_interest' : 'ai_daily_auto',
          updatedAt: now,
        })
        .where(
          and(
            eq(groupItemsTable.groupId, groupId),
            eq(groupItemsTable.articleId, articleId),
          ),
        )
        .run();
    }

    return { ok: true, article_id: articleId, user_interested: newInterested };
  }
}

export const feedService = new FeedService();
