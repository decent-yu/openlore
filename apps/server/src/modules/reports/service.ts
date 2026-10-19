import { getPublishedWikiLinks, wikiLinkKey } from '../delivery/wiki-links.js';
import crypto from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import {
  ReportPlanSchema,
  renderReportTemplate,
  renderReportCardTitle,
  type ReportPlan,
  type ReportPreview,
  type RunOutput,
} from '@openlore/contracts';
import { getDb } from '../../infrastructure/persistence/sqlite/db.js';
import {
  deliveriesTable,
  groupsTable,
  notificationConnectionsTable,
  runsTable,
  reportPlansTable,
} from '../../infrastructure/persistence/sqlite/schema.js';
import { calendarDayBounds } from '../../infrastructure/time/calendar.js';
import { GenericWebhookSender } from '../../infrastructure/notifications/generic_webhook/sender.js';
import { secretsStore } from '../../infrastructure/secrets/local_file/secrets_store.js';
import { validateCron } from '../../infrastructure/time/cron.js';

export class ReportService {
  private sending = new Set<string>();

  async listPlans(): Promise<ReportPlan[]> {
    return getDb()
      .select()
      .from(reportPlansTable)
      .all()
      .map((record) =>
        ReportPlanSchema.parse({
          ...JSON.parse(record.configurationJson),
          id: record.id,
          name: record.name,
        }),
      );
  }

  async getPlan(id: string): Promise<ReportPlan> {
    const record = getDb()
      .select()
      .from(reportPlansTable)
      .where(eq(reportPlansTable.id, id))
      .get();
    if (!record)
      throw Object.assign(new Error('汇报方案不存在'), { statusCode: 404 });
    return ReportPlanSchema.parse({
      ...JSON.parse(record.configurationJson),
      id: record.id,
      name: record.name,
    });
  }

  async savePlan(input: unknown): Promise<ReportPlan> {
    const raw = input as Record<string, unknown>;
    const config = ReportPlanSchema.parse({
      ...raw,
      id: raw.id || `report_${crypto.randomUUID().slice(0, 12)}`,
    });
    validateCron(config.schedule_cron);
    new Intl.DateTimeFormat('en', { timeZone: config.timezone });
    config.pipeline_ids = [...new Set(config.pipeline_ids)];
    const db = getDb();
    const ids = new Set(
      db
        .select({ id: groupsTable.id })
        .from(groupsTable)
        .all()
        .map((group) => group.id),
    );
    if (config.pipeline_ids.some((id) => !ids.has(id)))
      throw Object.assign(new Error('所选流水线任务不存在，请重新选择'), { statusCode: 400 });
    if (
      config.enabled &&
      (!config.notification_connection_id || config.pipeline_ids.length === 0)
    )
      throw Object.assign(new Error('启用定时汇报前，请选择任务和群通知通道'), { statusCode: 400 });
    if (
      config.notification_connection_id &&
      !db
        .select()
        .from(notificationConnectionsTable)
        .where(
          eq(
            notificationConnectionsTable.id,
            config.notification_connection_id,
          ),
        )
        .get()
    )
      throw Object.assign(new Error('通知通道不存在'), { statusCode: 400 });
    const now = new Date().toISOString();
    db.insert(reportPlansTable)
      .values({
        id: config.id,
        name: config.name,
        configurationJson: JSON.stringify(config),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: reportPlansTable.id,
        set: {
          name: config.name,
          configurationJson: JSON.stringify(config),
          pendingDate: null,
          updatedAt: now,
        },
      })
      .run();
    return config;
  }

  async deletePlan(id: string): Promise<{ ok: boolean }> {
    if (this.sending.has(id)) throw new Error('方案正在推送，请完成后再删除');
    getDb().delete(reportPlansTable).where(eq(reportPlansTable.id, id)).run();
    return { ok: true };
  }

  async preview(id: string, now = new Date()): Promise<ReportPreview> {
    const config = await this.getPlan(id);
    const { start, end } = calendarDayBounds(now, config.timezone);
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const result: ReportPreview = {
      state: 'ready',
      message: '',
      date,
      summary: '',
      card_title: config.name,
      tasks: [],
      articles: [],
    };
    if (config.pipeline_ids.length === 0)
      return {
        ...result,
        state: 'invalid_config',
        message: '请选择至少一个要汇报的流水线任务',
      };
    const db = getDb();
    const groups = db.select().from(groupsTable).all();
    const runs = db
      .select()
      .from(runsTable)
      .orderBy(desc(runsTable.startedAt))
      .all();
    const sections: string[] = [];
    const articles = new Map<string, ReportPreview['articles'][number]>();
    for (const id of config.pipeline_ids) {
      const group = groups.find((item) => item.id === id);
      const taskRuns = runs.filter(
        (run) =>
          run.groupId === id &&
          (run.status === 'running' ||
            ((run.finishedAt || run.startedAt) >= start &&
              (run.finishedAt || run.startedAt) < end)),
      );
      const latest = taskRuns[0];
      const status = !group ? 'missing' : latest?.status || 'not_run';
      const entries = new Map<string, RunOutput['entries'][number]>();
      for (const run of taskRuns.filter(
        (item) => item.status === 'succeeded',
      )) {
        const output: RunOutput = JSON.parse(run.outputJson || '{}');
        for (const entry of output.entries || []) {
          if (!entries.has(entry.article_id))
            entries.set(entry.article_id, entry);
        }
      }
      const wikiLinks = getPublishedWikiLinks([...entries.keys()], id);
      const readingUrl = (entry: RunOutput['entries'][number]) => {
        const wiki = wikiLinks.get(wikiLinkKey(id, entry.article_id));
        return wiki?.research_url || wiki?.article_url || entry.document_url || entry.original_url || undefined;
      };
      result.tasks.push({
        id,
        name: group?.name || id,
        status,
        count: entries.size,
      });
      // Never mix a failed/in-progress task into a seemingly complete report.
      if (
        !latest ||
        latest.status !== 'succeeded' ||
        taskRuns.some((run) => run.status === 'running') ||
        !group
      )
        result.state = 'waiting';
      sections.push(
        `### ${group?.name || id}\n\n` +
          (entries.size
            ? [...entries.values()]
                .map(
                  (entry) =>
                    `- [${entry.title}](${readingUrl(entry) || '#'})${entry.is_deep_analyzed ? ' · 含深度调研' : ''}\n  ${entry.summary}`,
                )
                .join('\n')
            : status === 'succeeded'
              ? '本次暂无新增精选。'
              : '等待任务成功完成归档。'),
      );
      for (const entry of entries.values()) {
        const previous = articles.get(entry.article_id);
        articles.set(entry.article_id, {
          article_id: entry.article_id,
          title: entry.title,
          summary: entry.summary,
          url: previous?.is_deep_analyzed
            ? previous.url
            : readingUrl(entry),
          is_deep_analyzed:
            entry.is_deep_analyzed || previous?.is_deep_analyzed || false,
        });
      }
    }
    result.articles = [...articles.values()];
    const templateValues = {
      report_name: config.name, date, task_count: result.tasks.length,
      article_count: result.articles.length,
      deep_count: result.articles.filter((article) => article.is_deep_analyzed).length,
      content: sections.join('\n\n'),
    };
    result.summary = renderReportTemplate(config.template, templateValues);
    result.card_title = renderReportCardTitle(config.card_title_template, templateValues);
    if (result.state === 'waiting')
      result.message = '等待所选任务今天全部成功完成并归档后再汇报';
    else if (result.articles.length === 0) {
      result.state = 'empty';
      result.message = '所选任务已完成，今天暂无新增精选，跳过推送';
    } else result.message = '所有任务已完成，可汇总推送';
    return result;
  }

  async send(
    id: string,
  ): Promise<{ ok: boolean; state: string; message: string }> {
    const config = await this.getPlan(id);
    const planId = config.id;
    if (this.sending.has(planId))
      return { ok: false, state: 'waiting', message: '汇报正在发送中' };
    this.sending.add(planId);
    try {
      const preview = await this.preview(planId);
      if (preview.state !== 'ready')
        return { ok: false, state: preview.state, message: preview.message };
      const db = getDb();
      const connection = config.notification_connection_id
        ? db
            .select()
            .from(notificationConnectionsTable)
            .where(
              eq(
                notificationConnectionsTable.id,
                config.notification_connection_id,
              ),
            )
            .get()
        : null;
      const url = connection
        ? secretsStore.getSecret(connection.urlSecretRef)
        : null;
      if (!connection || !url)
        return {
          ok: false,
          state: 'invalid_config',
          message: '请配置有效的群通知通道',
        };
      const key = crypto
        .createHash('sha256')
        .update(
          JSON.stringify([
            config.id,
            preview.date,
            connection.id,
            [...config.pipeline_ids].sort(),
          ]),
        )
        .digest('hex')
        .slice(0, 24);
      const batchId = `report_${key}`;
      const prior = db
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.batchId, batchId))
        .all();
      if (prior.some((delivery) => delivery.status === 'sent'))
        return {
          ok: true,
          state: 'sent',
          message: '今天这些任务的汇报已发送，未重复推送',
        };
      const summary = preview.summary;
      const deepCount = preview.articles.filter(
        (article) => article.is_deep_analyzed,
      ).length;
      const response = await GenericWebhookSender.send(url, {
        event: 'daily_push.completed',
        event_id: batchId,
        status: 'success',
        summary,
        card_title: preview.card_title,
        counts: { selected: preview.articles.length, failed: 0, deferred: 0 },
        articles: preview.articles,
      });
      db.insert(deliveriesTable)
        .values({
          id: `del_${crypto.randomUUID()}`,
          groupId: config.id,
          batchId,
          targetKind: 'webhook',
          status: response.status,
          responseJson: JSON.stringify({
            headline: preview.card_title,
            summary,
            webhook_name: connection.name,
            report_plan_id: config.id,
            report_plan_name: config.name,
            pipeline_ids: config.pipeline_ids,
            total_count: preview.articles.length,
            deep_count: deepCount,
            candidate_count: preview.articles.length - deepCount,
            platform_response: response.platform_response,
          }),
          errorMessage: response.error?.message,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();
      return {
        ok: response.status === 'sent',
        state: response.status,
        message:
          response.status === 'sent'
            ? `汇报已发送到「${connection.name}」`
            : response.error?.message || '发送失败',
      };
    } finally {
      this.sending.delete(planId);
    }
  }
}

export const reportService = new ReportService();
