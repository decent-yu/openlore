import {
  releaseResearchClaims,
  markResearchArchived,
} from "../research/state.js";
import crypto from "node:crypto";
import { buildResearchPrompt, RunOutputSchema } from "@openlore/contracts";
import { and, desc, eq } from "drizzle-orm";
import type {
  Group,
  PushDeliveryRecord,
  ResearchTask,
  Run,
  RunOutput,
} from "@openlore/contracts";
import {
  getDb,
  getSqliteDatabase,
} from "../../infrastructure/persistence/sqlite/db.js";
import {
  deliveriesTable,
  groupsTable,
  runsTable,
  repositoryConnectionsTable,
  reportPlansTable,
} from "../../infrastructure/persistence/sqlite/schema.js";
import { articleReviewsService } from "../processing/article-reviews.js";
import { collectionService } from "../collection/service.js";
import { deliveryService } from "../delivery/service.js";
import { groupsService } from "../groups/service.js";
import {
  getAIAdapterWithFallback,
  FallbackAIAdapter,
} from "../../infrastructure/ai/fallback_runner.js";
import { processingService } from "../processing/service.js";
import { researchService } from "../research/service.js";
import { sourcesService } from "../sources/service.js";
import { matchesCron } from "../../infrastructure/time/cron.js";
import { reportService } from "../reports/service.js";

type SseListener = (event: {
  entity_type: string;
  entity_id: string;
  status: string;
}) => void;

export {
  matchesCron,
  matchesCronPart,
} from "../../infrastructure/time/cron.js";

export class AppScheduler {
  private timer: NodeJS.Timeout | null = null;
  private sseListeners: SseListener[] = [];
  private isProcessing = false;
  private sourcePolling: Promise<string[]> | null = null;
  private reportSending = new Map<string, Promise<void>>();
  private lastPipelineMinutes = new Map<string, string>();
  private lastReportMinutes = new Map<string, string>();

  addSseListener(fn: SseListener): () => void {
    this.sseListeners.push(fn);
    return () => {
      this.sseListeners = this.sseListeners.filter(
        (listener) => listener !== fn,
      );
    };
  }

  notifySse(entity_type: string, entity_id: string, status: string): void {
    for (const listener of this.sseListeners) {
      try {
        listener({ entity_type, entity_id, status });
      } catch {}
    }
  }

  start(intervalMs = 30000): void {
    if (this.timer) return;
    articleReviewsService.recoverInterrupted();
    this.tick().catch(() => {});
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async pollDueSources(force = false): Promise<string[]> {
    if (this.sourcePolling) return this.sourcePolling;
    this.sourcePolling = this.pollSources(force);
    try {
      return await this.sourcePolling;
    } finally {
      this.sourcePolling = null;
    }
  }

  private async pollSources(force: boolean): Promise<string[]> {
    const sources = (await sourcesService.listSources()).filter(
      (source) => source.enabled,
    );
    const ids: string[] = [];
    for (const source of sources) {
      const last = source.last_polled_at
        ? Date.parse(source.last_polled_at)
        : 0;
      const sqlite = getSqliteDatabase();
      const pending = sqlite
        .prepare(
          "SELECT 1 FROM collection_candidates WHERE source_id=? AND status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?) LIMIT 1",
        )
        .get(source.id, new Date().toISOString());
      const continuation = sqlite
        .prepare(
          "SELECT 1 FROM source_states WHERE source_id=? AND json_extract(state_json,'$.pending_items_ref') IS NOT NULL LIMIT 1",
        )
        .get(source.id);
      if (
        !force &&
        !pending &&
        !continuation &&
        Date.now() - last < source.options.poll_interval_mins * 60000
      )
        continue;
      try {
        const result = await collectionService.discoverSource(source.id);
        this.notifySse("source", source.id, result.status);
        if (result.status !== "failed") ids.push(source.id);
      } catch (error: any) {
        await sourcesService.updateLastPolled(source.id, false, error.message);
        this.notifySse("source", source.id, "failed");
      }
    }
    return ids;
  }

  async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const now = new Date();
      const minute = now.toISOString().slice(0, 16);
      const groups = await groupsService.listGroups();
      for (const group of groups.filter((item) => item.enabled)) {
        if (
          matchesCron(group.schedule_cron, now, group.timezone) &&
          this.lastPipelineMinutes.get(group.id) !== minute
        ) {
          this.lastPipelineMinutes.set(group.id, minute);
          await this.triggerGroupRun(group.id);
        }
      }
      const db = getDb();
      for (const plan of await reportService.listPlans()) {
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: plan.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(now);
        const pending = db
          .select()
          .from(reportPlansTable)
          .where(eq(reportPlansTable.id, plan.id))
          .get()?.pendingDate;
        if (
          plan.enabled &&
          (matchesCron(plan.schedule_cron, now, plan.timezone) ||
            pending === day) &&
          this.lastReportMinutes.get(plan.id) !== minute &&
          !this.reportSending.has(plan.id)
        ) {
          this.lastReportMinutes.set(plan.id, minute);
          db.update(reportPlansTable)
            .set({ pendingDate: day })
            .where(eq(reportPlansTable.id, plan.id))
            .run();
          const sending = (async () => {
            const result = await reportService.send(plan.id);
            if (result.state !== "waiting") {
              db.update(reportPlansTable)
                .set({ pendingDate: null })
                .where(eq(reportPlansTable.id, plan.id))
                .run();
            }
            this.notifySse("delivery", plan.id, result.state);
          })()
            .catch(() => {})
            .finally(() => {
              this.reportSending.delete(plan.id);
            });
          this.reportSending.set(plan.id, sending);
        }
      }
      articleReviewsService.processPending().catch(() => {});
      this.pollDueSources().catch(() => {});
    } finally {
      this.isProcessing = false;
    }
  }

  async triggerAllEnabledGroups(): Promise<Run[]> {
    const runs: Run[] = [];
    for (const group of (await groupsService.listGroups()).filter(
      (item) => item.enabled,
    )) {
      runs.push(await this.triggerGroupRun(group.id));
    }
    return runs;
  }

  async triggerGroupRun(groupId: string): Promise<Run> {
    const group = await groupsService.getGroup(groupId);
    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    const db = getDb();

    // Check in-flight running task for this group
    const runningRun = db
      .select()
      .from(runsTable)
      .where(
        and(eq(runsTable.groupId, groupId), eq(runsTable.status, "running")),
      )
      .get();

    if (runningRun) {
      return this.formatRun(runningRun, group.name);
    }

    const runId = `run_${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    const snapshot = {
      group,
      triggered_at: now,
    };

    db.insert(runsTable)
      .values({
        id: runId,
        groupId,
        snapshotJson: JSON.stringify(snapshot),
        status: "running",
        stage: "processing",
        countsJson: JSON.stringify({
          observed: 0,
          already_processed: 0,
          candidate: 0,
          planned: 0,
          excluded: 0,
          deferred: 0,
        }),
        aiLogsJson: "[]",
        startedAt: now,
      })
      .run();

    this.notifySse("run", runId, "running");

    // Run pipeline asynchronously so API returns 202 immediately
    this.executePipeline(runId, group).catch((err) => {
      db.update(runsTable)
        .set({
          status: "failed",
          errorMessage: err.message,
          finishedAt: new Date().toISOString(),
        })
        .where(eq(runsTable.id, runId))
        .run();
      this.notifySse("run", runId, "failed");
    });

    const runRecord = db
      .select()
      .from(runsTable)
      .where(eq(runsTable.id, runId))
      .get()!;
    return this.formatRun(runRecord, group.name);
  }

  private async executePipeline(runId: string, group: Group): Promise<void> {
    const db = getDb();
    const setStage = (stage: string) => {
      db.update(runsTable).set({ stage }).where(eq(runsTable.id, runId)).run();
      this.notifySse("run", runId, stage);
    };
    try {
      setStage("processing");
      const result = await processingService.runProcessingForGroup(
        group,
        runId,
      );
      const output: RunOutput = {
        entries: result.entries.map((entry) => ({
          article_id: entry.article_id,
          title: entry.title,
          summary: entry.summary,
          original_url: entry.original_url,
          is_deep_analyzed: false,
        })),
      };
      const logs = [...(result.aiLogs || [])];
      const save = () =>
        db
          .update(runsTable)
          .set({
            countsJson: JSON.stringify(result.counts),
            aiLogsJson: JSON.stringify(logs),
            outputJson: JSON.stringify(output),
          })
          .where(eq(runsTable.id, runId))
          .run();
      save();
      const researchTasks: ResearchTask[] = [];
      if (result.entries.length) {
        setStage("research");
        const adapter = getAIAdapterWithFallback(
          group.ai_profile_id,
        ) as FallbackAIAdapter | null;
        const concurrency = Math.max(
          1,
          Math.min(
            4,
            adapter?.targets?.[0]?.target.execution?.concurrency || 1,
          ),
        );
        let next = 0;
        let failure: unknown;
        await Promise.all(
          Array.from(
            { length: Math.min(concurrency, result.entries.length) },
            async () => {
              while (!failure && next < result.entries.length) {
                const entry = result.entries[next++];
                try {
                  const task = await researchService.runResearchOnArticle(
                    group.id,
                    entry.article_id,
                    group.research_instructions,
                    runId,
                  );
                  if (!task || task.status !== "succeeded")
                    throw new Error(
                      `深度调研未完成：${entry.title}；${task?.error_message || "请检查 AI 执行器"}`,
                    );
                  researchTasks.push(task);
                  entry.title = task.article_title;
                  entry.slug = task.article_slug;
                  const publishedEntry = output.entries.find(item => item.article_id === entry.article_id);
                  if (publishedEntry) publishedEntry.title = task.article_title;
                  logs.push({
                    timestamp: new Date().toISOString(),
                    article_id: entry.article_id,
                    article_title: entry.title,
                    task_type: "research",
                    skill_id: group.research_skill_id,
                    model: task.model || "research-engine",
                    execution: task.execution,
                    prompt_preview: buildResearchPrompt(
                      group.research_skill_id,
                      group.research_instructions,
                    ),
                    response_preview: task.report_markdown.slice(0, 600),
                    status: "succeeded",
                  });
                  save();
                } catch (error) {
                  failure = error;
                }
              }
            },
          ),
        );
        if (failure) throw failure;
        setStage("delivery");
        const delivery = await deliveryService.buildAndDeliverBatch({
          group,
          runId,
          entries: result.entries,
          researchTasks,
        });
        if (!["updated", "unchanged"].includes(delivery.syncResult.status))
          throw new Error(
            delivery.syncResult.errors
              .map((error) => error.message)
              .join("; ") || "GitHub 归档失败",
          );
        markResearchArchived(researchTasks.map((task) => task.id));
        output.commit_url = delivery.syncResult.commit_url;
        const repo = db
          .select()
          .from(repositoryConnectionsTable)
          .where(
            eq(
              repositoryConnectionsTable.id,
              group.route.repository_connection_id,
            ),
          )
          .get();
        for (const entry of output.entries) {
          entry.is_deep_analyzed = true;
          const location = delivery.bundle.entries.find(
            (item) => item.article_id === entry.article_id,
          );
          if (repo && location)
            entry.document_url = `https://github.com/${repo.owner}/${repo.repo}/blob/${encodeURIComponent(repo.defaultBranch)}/${(location.research_path || [group.route.base_path, location.directory, "research.md"].join("/")).split("/").map(encodeURIComponent).join("/")}`;
        }
      }
      db.update(runsTable)
        .set({
          status: "succeeded",
          stage: "completed",
          finishedAt: new Date().toISOString(),
          aiLogsJson: JSON.stringify(logs),
          outputJson: JSON.stringify(output),
        })
        .where(eq(runsTable.id, runId))
        .run();
      this.notifySse("run", runId, "succeeded");
    } finally {
      releaseResearchClaims(runId);
    }
  }

  async listPushDeliveries(): Promise<PushDeliveryRecord[]> {
    const db = getDb();
    const rows = db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.targetKind, "webhook"))
      .orderBy(desc(deliveriesTable.createdAt))
      .all();

    return rows.map((r) => {
      let meta: any = {};
      try {
        meta = JSON.parse(r.responseJson || "{}");
      } catch {
        meta = { platform_response: r.responseJson };
      }
      return {
        id: r.id,
        batch_id: r.batchId,
        ai_log_id: meta.ai_log_id,
        report_plan_id: meta.report_plan_id,
        pipeline_ids: meta.pipeline_ids || [],
        group_id: r.groupId,
        status: r.status,
        webhook_name: meta.webhook_name || "群通知 Webhook",
        headline: meta.headline || "每日研报",
        summary: meta.summary || "",
        total_count: meta.total_count ?? 0,
        deep_count: meta.deep_count ?? 0,
        candidate_count: meta.candidate_count ?? 0,
        platform_response: meta.platform_response,
        error_message: r.errorMessage || undefined,
        created_at: r.createdAt,
      };
    });
  }

  private formatRun(r: any, groupName: string): Run {
    let aiLogs = [];
    try {
      if (r.aiLogsJson) aiLogs = JSON.parse(r.aiLogsJson);
    } catch {}
    return {
      id: r.id,
      group_id: r.groupId,
      group_name: groupName,
      status: r.status,
      stage: r.stage,
      counts: JSON.parse(r.countsJson || "{}"),
      started_at: r.startedAt,
      finished_at: r.finishedAt,
      error_message: r.errorMessage,
      ai_logs: aiLogs,
      output: RunOutputSchema.parse(JSON.parse(r.outputJson || "{}")),
    };
  }

  async listRuns(groupId?: string): Promise<Run[]> {
    const db = getDb();
    const rows = groupId
      ? db
          .select()
          .from(runsTable)
          .where(eq(runsTable.groupId, groupId))
          .orderBy(desc(runsTable.startedAt))
          .all()
      : db.select().from(runsTable).orderBy(desc(runsTable.startedAt)).all();

    const groups = db.select().from(groupsTable).all();
    const groupNameMap = new Map(groups.map((g) => [g.id, g.name]));

    return rows.map((r) =>
      this.formatRun(r, groupNameMap.get(r.groupId) || "Unknown Group"),
    );
  }

  async getRun(id: string): Promise<Run | null> {
    const db = getDb();
    const r = db.select().from(runsTable).where(eq(runsTable.id, id)).get();
    if (!r) return null;
    const g = db
      .select()
      .from(groupsTable)
      .where(eq(groupsTable.id, r.groupId))
      .get();
    return this.formatRun(r, g?.name || "Unknown Group");
  }
}

export const appScheduler = new AppScheduler();
