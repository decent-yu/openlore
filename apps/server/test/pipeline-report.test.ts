import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ResearchTask, StructuredEntry } from '@openlore/contracts';
import {
  initDatabase,
  getSqliteDatabase,
} from '../src/infrastructure/persistence/sqlite/db.js';
import { AppScheduler } from '../src/modules/scheduler/scheduler.js';
import { groupsService } from '../src/modules/groups/service.js';
import { processingService } from '../src/modules/processing/service.js';
import { collectionService } from '../src/modules/collection/service.js';
import { researchService } from '../src/modules/research/service.js';
import { deliveryService } from '../src/modules/delivery/service.js';
import { sourcesService } from '../src/modules/sources/service.js';
import {
  ReportService,
  reportService,
} from '../src/modules/reports/service.js';
import { GenericWebhookSender } from '../src/infrastructure/notifications/generic_webhook/sender.js';
import { GitHubClient } from '../src/infrastructure/repositories/github/client.js';
import { secretsStore } from '../src/infrastructure/secrets/local_file/secrets_store.js';
import * as aiAdapters from '../src/infrastructure/ai/fallback_runner.js';

const entries: StructuredEntry[] = [1, 2].map((n) => ({
  article_id: `article-${n}`,
  revision: 'revision',
  slug: `article-${n}`,
  title: `Article ${n}`,
  original_url: `https://example.com/${n}`,
  tags: [],
  summary: 'Summary',
  organized_markdown: 'Article body',
  asset_refs: [],
  evidence_refs: [],
  limitations: [],
}));
const counts = {
  observed: 2,
  already_processed: 0,
  candidate: 2,
  planned: 2,
  excluded: 0,
  deferred: 0,
};

describe('Task execution and independent multi-task reports', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'openlore-pipeline-test-'),
  );
  const report = new ReportService();
  beforeAll(async () => {
    process.env.OPENLORE_DATA_DIR = dataDir;
    initDatabase();
    for (const id of ['task', 'agent', 'frontend'])
      await groupsService.saveGroup({
        id,
        name: id,
        repository_connection_id: 'repo',
        base_path: `docs/${id}`,
        source_ids: [],
        deep_analysis_count: 1,
        schedule_cron: '0 8 * * *',
      });
    getSqliteDatabase()
      .prepare(
        "INSERT INTO notification_connections (id, name, revision, url_secret_ref, state) VALUES ('channel', 'Engineering', 'v1', 'secret', 'ready')",
      )
      .run();
    await report.savePlan({
      id: 'daily',
      name: 'Daily',
      enabled: true,
      pipeline_ids: ['agent', 'frontend'],
      notification_connection_id: 'channel',
      timezone: 'Asia/Shanghai',
    });
  });
  beforeEach(() => {
    getSqliteDatabase().exec('DELETE FROM runs; DELETE FROM deliveries; DELETE FROM research_tasks; DELETE FROM articles; DELETE FROM research_claims');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    getSqliteDatabase().close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const successfulDelivery = () => ({
    bundle: {
      group_id: 'task',
      run_id: 'run',
      collection_id: 'col',
      batch_id: 'batch',
      snapshot_ref: 'snap',
      kind: 'collection' as const,
      entries: [],
      assets: [],
      files: [],
    },
    syncResult: {
      status: 'updated' as const,
      changed_paths: [],
      errors: [],
      commit_url: 'https://github.com/example/commit/test',
    },
  });
  it('does not collect or send notifications during a task, and waits for research before GitHub', async () => {
    const scheduler = new AppScheduler();
    const collect = vi.spyOn(collectionService, 'discoverSource');
    const push = vi.spyOn(GenericWebhookSender, 'send');
    vi.spyOn(processingService, 'runProcessingForGroup').mockResolvedValue({
      entries: entries.slice(0,1),
      decisions: [],
      counts,
      aiLogs: [],
    });
    let finishResearch!: (task: ResearchTask) => void;
    const research = vi
      .spyOn(researchService, 'runResearchOnArticle')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finishResearch = resolve;
          }),
      );
    const delivery = vi
      .spyOn(deliveryService, 'buildAndDeliverBatch')
      .mockResolvedValue(successfulDelivery());
    const run = await scheduler.triggerGroupRun('task');
    await vi.waitFor(() => expect(research).toHaveBeenCalledTimes(1));
    expect(research.mock.calls[0][3]).toBe(run.id);
    expect((await scheduler.getRun(run.id))?.stage).toBe('research');
    expect(delivery).not.toHaveBeenCalled();
    finishResearch({
      id: 'research',
      group_id: 'task',
      article_id: 'article-1',
      article_title: 'Article 1',
      article_slug: 'article-1',
      status: 'succeeded',
      questions: [],
      evidence: [],
      report_markdown: '# Research',
      created_at: new Date().toISOString(),
    });
    await vi.waitFor(async () =>
      expect((await scheduler.getRun(run.id))?.status).toBe('succeeded'),
    );
    expect(delivery.mock.calls[0][0].researchTasks?.[0].article_id).toBe(
      'article-1',
    );
    expect(
      (await scheduler.getRun(run.id))?.output.entries[0].is_deep_analyzed,
    ).toBe(true);
    expect(collect).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('marks a GitHub failure as failed rather than reporting the task complete', async () => {
    const scheduler = new AppScheduler();
    vi.spyOn(processingService, 'runProcessingForGroup').mockResolvedValue({
      entries: entries.slice(0,1),
      decisions: [],
      counts,
      aiLogs: [],
    });
    vi.spyOn(researchService, 'runResearchOnArticle').mockResolvedValue({
      id: 'research',
      group_id: 'task',
      article_id: 'article-1',
      article_title: 'Article 1',
      article_slug: 'article-1',
      status: 'succeeded',
      questions: [],
      evidence: [],
      report_markdown: 'Research',
      created_at: new Date().toISOString(),
    });
    vi.spyOn(deliveryService, 'buildAndDeliverBatch').mockResolvedValue({
      ...successfulDelivery(),
      syncResult: {
        status: 'blocked',
        changed_paths: [],
        errors: [
          { code: 'blocked', message: 'Branch protected', retryable: false },
        ],
      },
    });
    const run = await scheduler.triggerGroupRun('task');
    await vi.waitFor(async () =>
      expect((await scheduler.getRun(run.id))?.status).toBe('failed'),
    );
    expect((await scheduler.getRun(run.id))?.error_message).toContain(
      'Branch protected',
    );
  });

  function seedRun(
    id: string,
    groupId: string,
    status: string,
    articleId: string,
  ) {
    const now = new Date().toISOString();
    if(status==='succeeded') {
      const db=getSqliteDatabase();
      db.prepare('INSERT OR IGNORE INTO articles(id,title) VALUES (?,?)').run(articleId,articleId);
      db.prepare("INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status,report_markdown,archived_at) VALUES (?,?,?,'rev','succeeded','# Report',?)").run(`report_${id}`,groupId,articleId,now);
    }
    getSqliteDatabase()
      .prepare(
        'INSERT INTO runs (id, group_id, snapshot_json, status, stage, started_at, finished_at, output_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        groupId,
        '{}',
        status,
        status === 'succeeded' ? 'completed' : 'processing',
        now,
        status === 'succeeded' ? now : null,
        JSON.stringify({
          entries: [
            {
              article_id: articleId,
              title: articleId,
              summary: 'Summary',
              document_url: 'https://github.com/example/docs/article.md',
              is_deep_analyzed: true,
            },
          ],
        }),
      );
  }
  it('waits for all selected tasks and sends one deduplicated report instead of one per task', async () => {
    seedRun('agent-run', 'agent', 'succeeded', 'shared-article');
    seedRun('frontend-run', 'frontend', 'running', 'shared-article');
    const sender = vi
      .spyOn(GenericWebhookSender, 'send')
      .mockResolvedValue({ status: 'sent' });
    vi.spyOn(secretsStore, 'getSecret').mockReturnValue(
      'https://example.com/webhook',
    );
    expect((await report.send('daily')).state).toBe('waiting');
    expect(sender).not.toHaveBeenCalled();
    getSqliteDatabase()
      .prepare(
        "UPDATE runs SET status='succeeded', finished_at=? WHERE id='frontend-run'",
      )
      .run(new Date().toISOString());
    getSqliteDatabase().prepare("INSERT OR IGNORE INTO articles(id,title) VALUES ('article','article')").run();
    getSqliteDatabase().prepare("INSERT OR REPLACE INTO research_tasks(id,group_id,article_id,revision_hash,status,archived_at) VALUES ('report_frontend','frontend','shared-article','rev','succeeded',?)").run(new Date().toISOString());
    const preview = await report.preview('daily');
    expect(preview.tasks).toHaveLength(2);
    expect(preview.articles).toHaveLength(1);
    expect(preview.articles[0].is_deep_analyzed).toBe(true);
    expect((await report.send('daily')).state).toBe('sent');
    expect((await report.send('daily')).state).toBe('sent');
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][1].summary).toContain('agent');
    expect(sender.mock.calls[0][1].summary).toContain('frontend');
  });
  it('blocks an incomplete or failed task from being included in a report', async () => {
    seedRun('agent-run', 'agent', 'succeeded', 'agent-article');
    seedRun('frontend-run', 'frontend', 'failed', 'frontend-article');
    expect((await report.preview('daily')).state).toBe('waiting');
    await expect(
      report.savePlan({
        id: 'daily',
        name: 'Daily',
        enabled: true,
        pipeline_ids: [],
      }),
    ).rejects.toThrow('请选择任务');
  });
  it('sends the exact template preview without using an AI executor',async()=>{
    seedRun('scope-agent-run','agent','succeeded','article');
    await report.savePlan({id:'digest-scope',name:'Digest scope',enabled:true,pipeline_ids:['agent'],notification_connection_id:'channel'});
    const execute=vi.fn().mockResolvedValue({status:'success',provider:'test',model:'test',durationMs:1,result:'AI generated summary',trace_id:'ai-specific-digest-call'});
    vi.spyOn(aiAdapters,'getAIAdapterWithFallback').mockReturnValue({execute,testConnection:async()=>({ok:true,message:'test'})});
    vi.spyOn(secretsStore,'getSecret').mockReturnValue('https://example.com/webhook');
    vi.spyOn(GenericWebhookSender,'send').mockResolvedValue({status:'sent'});
    const preview=await report.preview('digest-scope');
    expect((await report.send('digest-scope')).state).toBe('sent');
    expect(execute).not.toHaveBeenCalled();
    const push=(await new AppScheduler().listPushDeliveries()).find(push=>push.report_plan_id==='digest-scope');
    expect(push).toMatchObject({pipeline_ids:['agent'],summary:preview.summary});
    expect(push?.ai_log_id).toBeUndefined();
    await report.deletePlan('digest-scope');
  });
  it('uses the archived article initial positioning for both preview and delivery instead of long summaries', async () => {
    seedRun('positioning-run', 'agent', 'succeeded', 'article');
    const db = getSqliteDatabase();
    const positioning = '面向健康辅导等具有严格业务边界的对话系统，介绍如何结合单轮评测、动态多轮模拟、运行时安全检查与专家审核改进评测体系。适合参考评测架构、评分准则治理和发布门禁设计，属于工程实践案例，尚不足以作为安全有效性的验证报告。';
    db.prepare("UPDATE articles SET latest_revision='new-revision' WHERE id='article'").run();
    const insert = db.prepare("INSERT INTO article_reviews(article_id,revision_hash,status,result_json,created_at) VALUES ('article',?,'succeeded',?,?)");
    insert.run('rev', JSON.stringify({positioning, summary: 'Long initial-review problem, method, conclusion and limitations'}), new Date().toISOString());
    insert.run('new-revision', JSON.stringify({positioning: 'Newer revision positioning must not replace the archived revision'}), new Date().toISOString());
    await report.savePlan({id: 'positioning-report', name: '日报', enabled: false, pipeline_ids: ['agent'], notification_connection_id: 'channel'});
    const ai = vi.spyOn(aiAdapters, 'getAIAdapterWithFallback').mockImplementation(() => { throw new Error('Reports must not use AI'); });
    vi.spyOn(secretsStore, 'getSecret').mockReturnValue('https://example.com/webhook');
    const sender = vi.spyOn(GenericWebhookSender, 'send').mockResolvedValue({status: 'sent'});

    const preview = await report.preview('positioning-report');
    expect(preview.articles[0].summary).toBe(positioning);
    expect(preview.summary).toContain(positioning);
    expect(preview.summary).toContain('[article](https://github.com/example/docs/article.md)');
    for (const text of ['Summary', 'Long initial-review', 'Newer revision', '含深度调研']) expect(preview.summary).not.toContain(text);
    expect((await report.send('positioning-report')).state).toBe('sent');
    expect(sender.mock.calls[0][1].summary).toBe(preview.summary);
    expect(sender.mock.calls[0][1].articles?.[0].summary).toBe(positioning);
    expect(ai).not.toHaveBeenCalled();
  });

  it('keeps the article link without falling back to long text when positioning is missing', async () => {
    seedRun('missing-positioning-run', 'agent', 'succeeded', 'article');
    getSqliteDatabase().prepare("INSERT INTO article_reviews(article_id,revision_hash,status,result_json,created_at) VALUES ('article','rev','succeeded',?,?)")
      .run(JSON.stringify({summary: 'Long initial-review text'}), new Date().toISOString());
    await report.savePlan({id: 'missing-positioning', name: '日报', enabled: false, pipeline_ids: ['agent']});
    const preview = await report.preview('missing-positioning');
    expect(preview.articles[0].summary).toBe('');
    expect(preview.summary).toContain('[article](https://github.com/example/docs/article.md)');
    expect(preview.summary).not.toContain('Long initial-review text');
    expect(preview.summary).not.toContain('Summary');
  });

  it('allows manual repeats with unique event IDs while scheduled delivery still skips the day', async () => {
    seedRun('repeat-report-run', 'agent', 'succeeded', 'article');
    await report.savePlan({id: 'repeat-report', name: '可重复测试日报', enabled: false, pipeline_ids: ['agent'], notification_connection_id: 'channel'});
    vi.spyOn(secretsStore, 'getSecret').mockReturnValue('https://example.com/webhook');
    const sender = vi.spyOn(GenericWebhookSender, 'send').mockResolvedValue({status: 'sent'});
    expect((await report.send('repeat-report', {force: true})).state).toBe('sent');
    expect((await report.send('repeat-report', {force: true})).state).toBe('sent');
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[0][1].event_id).not.toBe(sender.mock.calls[1][1].event_id);
    const records = getSqliteDatabase().prepare("SELECT batch_id,status FROM deliveries WHERE group_id='repeat-report'").all() as Array<{batch_id: string; status: string}>;
    expect(records).toHaveLength(2);
    expect(records[0].batch_id).toBe(records[1].batch_id);
    expect((await report.send('repeat-report')).message).toContain('未重复推送');
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('does not bypass readiness or the in-flight send lock for manual repeat sends', async () => {
    seedRun('repeat-waiting-run', 'agent', 'running', 'article');
    await report.savePlan({id: 'repeat-waiting', name: '测试等待', enabled: false, pipeline_ids: ['agent'], notification_connection_id: 'channel'});
    const sender = vi.spyOn(GenericWebhookSender, 'send');
    expect((await report.send('repeat-waiting', {force: true})).state).toBe('waiting');
    expect(sender).not.toHaveBeenCalled();
    seedRun('repeat-ready-run', 'agent', 'succeeded', 'ready-article');
    getSqliteDatabase().prepare("DELETE FROM runs WHERE id='repeat-waiting-run'").run();
    let finish!: (value: {status: 'sent'}) => void;
    sender.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.spyOn(secretsStore, 'getSecret').mockReturnValue('https://example.com/webhook');
    const first = report.send('repeat-waiting', {force: true});
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    expect((await report.send('repeat-waiting', {force: true})).message).toBe('汇报正在发送中');
    finish({status: 'sent'});
    expect((await first).state).toBe('sent');
  });

  it('checks task schedules while a source request is still running and does not re-trigger within the minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    const scheduler = new AppScheduler();
    const trigger = vi
      .spyOn(scheduler, 'triggerGroupRun')
      .mockResolvedValue({ id: 'mock-run' } as any);
    vi.spyOn(sourcesService, 'listSources').mockResolvedValue([
      {
        id: 'slow',
        name: 'Slow',
        url: 'https://example.com/feed',
        description: '',
        capability_id: 'web_feed',
        enabled: true,
        options: {
          poll_interval_mins: 30,
          keywords: [],
          excluded_keywords: [],
          keyword_mode: 'any',
        },
      },
    ]);
    let finish!: (value: any) => void;
    const collect = vi
      .spyOn(collectionService, 'discoverSource')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    try {
      await scheduler.tick();
      await scheduler.tick();
      expect(trigger).toHaveBeenCalledTimes(3);
      expect(collect).toHaveBeenCalledTimes(1);
      getSqliteDatabase()
        .prepare(
          "UPDATE groups SET schedule_cron = '1 8 * * *' WHERE id = 'agent'",
        )
        .run();
      vi.setSystemTime(new Date('2026-10-16T00:01:00Z'));
      await scheduler.tick();
      expect(trigger).toHaveBeenCalledTimes(4);
      finish({ status: 'not_modified' });
      await scheduler.pollDueSources();
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues checking a pending report after its scheduled minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T01:00:00Z'));
    const scheduler = new AppScheduler();
    vi.spyOn(scheduler, 'pollDueSources').mockResolvedValue([]);
    const sender = vi
      .spyOn(reportService, 'send')
      .mockResolvedValueOnce({
        ok: false,
        state: 'waiting',
        message: 'Waiting',
      })
      .mockResolvedValueOnce({ ok: true, state: 'sent', message: 'Sent' });
    try {
      await scheduler.tick();
      await vi.waitFor(() =>
        expect(
          getSqliteDatabase()
            .prepare(
              "SELECT pending_date AS value FROM report_plans WHERE id='daily'",
            )
            .get(),
        ).toBeDefined(),
      );
      await Promise.resolve();
      vi.setSystemTime(new Date('2026-10-16T01:01:00Z'));
      await scheduler.tick();
      await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(2));
      await vi.waitFor(() =>
        expect(
          getSqliteDatabase()
            .prepare(
              "SELECT pending_date AS value FROM report_plans WHERE id='daily'",
            )
            .get(),
        ).toEqual({ value: null }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('archives research with the articles in one GitHub batch and never sends task notifications', async () => {
    vi.spyOn(aiAdapters, 'getAIAdapterWithFallback').mockReturnValue({
      execute: async (input) => ({
        status: 'success', provider: 'mock', model: 'mock', durationMs: 1,
        result: {markdown: input.material.replaceAll('Article body', '文章正文')},
      }),
      testConnection: async () => ({ok: true, message: 'mock'}),
    });
    const db = getSqliteDatabase();
    db.prepare(
      "INSERT INTO repository_connections (id, name, revision, owner, repo, default_branch, credential_ref, state) VALUES ('repo', 'Repo', 'v1', 'owner', 'knowledge', 'main', 'secret', 'ready')",
    ).run();
    const sync = vi.spyOn(GitHubClient, 'syncFiles').mockResolvedValue({
      status: 'updated',
      changedPaths: [],
      commitSha: 'test',
      commitUrl: 'https://github.com/owner/knowledge/commit/test',
    });
    vi.spyOn(secretsStore, 'getSecret').mockReturnValue('test-token');
    const send = vi.spyOn(GenericWebhookSender, 'send');
    const group = (await groupsService.getGroup('task'))!;
    const delivery = await deliveryService.buildAndDeliverBatch({
      group,
      runId: 'archive-test',
      entries,
      researchTasks: [
        {
          id: 'research',
          group_id: group.id,
          article_id: 'article-1',
          article_title: 'Article 1',
          article_slug: 'article-1',
          status: 'succeeded',
          questions: [],
          evidence: [],
          report_markdown: '# Research included',
          created_at: new Date().toISOString(),
        },
      ],
    });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(
      delivery.bundle.files.some((file) =>
        file.path.endsWith('/01-article-1/research.md'),
      ),
    ).toBe(true);
    expect(
      delivery.bundle.files.some((file) =>
        file.path.endsWith('/02-article-2/research.md'),
      ),
    ).toBe(false);
    const secondArticle = delivery.bundle.files.find((file) =>
      file.path.endsWith('/02-article-2/article.md'),
    )!;
    expect(
      Buffer.from(secondArticle.content_bytes!, 'base64').toString(),
    ).not.toContain('(research.md)');
    expect(send).not.toHaveBeenCalled();
  });

  it('returns an empty output list for historical runs without result snapshots', async () => {
    getSqliteDatabase()
      .prepare(
        "INSERT INTO runs (id, group_id, snapshot_json, status, stage) VALUES ('legacy', 'agent', '{}', 'succeeded', 'completed')",
      )
      .run();
    expect((await new AppScheduler().getRun('legacy'))?.output.entries).toEqual(
      [],
    );
  });

  it('includes work that starts yesterday and finishes today in the report timezone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T22:00:00Z'));
    try {
      seedRun('agent-overnight', 'agent', 'succeeded', 'agent-article');
      seedRun(
        'frontend-overnight',
        'frontend',
        'succeeded',
        'frontend-article',
      );
      getSqliteDatabase()
        .prepare("UPDATE runs SET started_at = '2026-10-15T15:00:00Z'")
        .run();
      const preview = await report.preview('daily');
      expect(preview.date).toBe('2026-10-16');
      expect(preview.state).toBe('ready');
      expect(preview.articles).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('routes separate report plans to groups A and B without sharing wait or deduplication state', async () => {
    getSqliteDatabase()
      .prepare(
        "INSERT INTO notification_connections (id, name, revision, url_secret_ref, state) VALUES ('channel-b', 'Frontend Group', 'v1', 'secret-b', 'ready')",
      )
      .run();
    await report.savePlan({
      id: 'plan-a',
      name: 'Agent 日报',
      enabled: true,
      pipeline_ids: ['agent'],
      notification_connection_id: 'channel',
    });
    await report.savePlan({
      id: 'plan-b',
      name: '前端日报',
      enabled: true,
      pipeline_ids: ['frontend'],
      notification_connection_id: 'channel-b',
    });
    seedRun('agent-ready', 'agent', 'succeeded', 'agent-article');
    seedRun('frontend-working', 'frontend', 'running', 'frontend-article');
    const sender = vi
      .spyOn(GenericWebhookSender, 'send')
      .mockResolvedValue({ status: 'sent' });
    vi.spyOn(secretsStore, 'getSecret').mockImplementation((key) =>
      key === 'secret-b'
        ? 'https://example.com/group-b'
        : 'https://example.com/group-a',
    );
    expect((await report.send('plan-b')).state).toBe('waiting');
    expect((await report.send('plan-a')).state).toBe('sent');
    expect(sender.mock.calls[0][0]).toBe('https://example.com/group-a');
    expect(
      sender.mock.calls[0][1].articles?.map((entry) => entry.title),
    ).toEqual(['agent-article']);
    getSqliteDatabase()
      .prepare(
        "UPDATE runs SET status='succeeded', finished_at=? WHERE id='frontend-working'",
      )
      .run(new Date().toISOString());
    getSqliteDatabase().prepare("INSERT OR IGNORE INTO articles(id,title) VALUES ('frontend-article','frontend-article')").run();
    getSqliteDatabase().prepare("INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status,archived_at) VALUES ('report-b','frontend','frontend-article','rev','succeeded',?)").run(new Date().toISOString());
    expect((await report.send('plan-b')).state).toBe('sent');
    expect(sender.mock.calls[1][0]).toBe('https://example.com/group-b');
    expect(
      sender.mock.calls[1][1].articles?.map((entry) => entry.title),
    ).toEqual(['frontend-article']);
    await report.send('plan-a');
    await report.send('plan-b');
    expect(sender).toHaveBeenCalledTimes(2);
    expect((await report.listPlans()).map((plan) => plan.id)).toContain(
      'plan-b',
    );
  });
});
