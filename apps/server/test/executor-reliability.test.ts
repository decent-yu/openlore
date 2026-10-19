import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, expect, it, vi } from 'vitest';
import {
  ExecutorConfigSchema,
  type ExecutionProgress,
} from '@openlore/contracts';
import {
  initDatabase,
  getSqliteDatabase,
} from '../src/infrastructure/persistence/sqlite/db.js';
import { getAppPaths } from '../src/infrastructure/config/paths.js';
import {
  classifyProcessFailure,
  parseGeminiOutput,
} from '../src/infrastructure/ai/cli_output.js';
import {
  executeInWorkspace,
  runProcess,
} from '../src/infrastructure/ai/workspace_runner.js';
import { FallbackAIAdapter } from '../src/infrastructure/ai/fallback_runner.js';
import { executionLogs } from '../src/infrastructure/ai/execution_logs.js';
import { executionQueue } from '../src/modules/executors/queue.js';
import { readSkillBundle } from '../src/infrastructure/ai/skill_bundle.js';

beforeAll(() => initDatabase());
const config = () =>
  ExecutorConfigSchema.parse({
    workspace_root: path.join(getAppPaths().dataDir, 'reliability-work'),
  });
const input = {
  jobId: 'reliability',
  profileId: 'primary',
  taskType: 'assess' as const,
  prompt: 'Read input/article.md using the Skill.',
  material: 'Article source text',
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { quality: { type: 'number' } },
    required: ['quality'],
  },
};
const cli = (name: string, code: string) => {
  const file = path.join(getAppPaths().dataDir, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${code}`, { mode: 0o700 });
  return file;
};
const target = (id: string) => ({
  id,
  name: id,
  provider: 'gemini_cli' as const,
  cliPath: 'test',
  isPrimary: id === 'primary',
  execution: config(),
});

it('keeps the original file-based Skill prompt, streams tool activity before completion and preserves the common 900-second timeout', async () => {
  const skillDir = path.join(getAppPaths().dataDir, 'reliability-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    'Read input/article.md and score it.',
  );
  const release = path.join(skillDir, 'release');
  const fake = cli(
    'streaming-gemini',
    `const fs=require('fs');const emit=x=>console.log(JSON.stringify(x));
    if(process.argv[process.argv.indexOf('--output-format')+1]!=='stream-json')process.exit(4);
    const prompt=process.argv[process.argv.indexOf('-p')+1];
    if(prompt.includes('Article source text')||prompt!==${JSON.stringify(input.prompt)})process.exit(5);
    fs.readFileSync('.agents/skills/review/SKILL.md','utf8');fs.readFileSync('input/article.md','utf8');
    emit({type:'init',model:'test-model'});emit({type:'tool_use',tool_name:'read_file',parameters:{file_path:'input/article.md'}});
    process.stderr.write('api_key=test-private-value');
    const timer=setInterval(()=>{if(!fs.existsSync(${JSON.stringify(release)}))return;clearInterval(timer);emit({type:'message',role:'assistant',content:'{"quality":80}',delta:true});emit({type:'result',status:'success',stats:{models:{'test-model':{input_tokens:20,output_tokens:5,total_tokens:25,cached:2}}}});},20);`,
  );
  const adapter = new FallbackAIAdapter([
    {
      target: target('primary'),
      adapter: {
        execute: (task, onProgress) =>
          executeInWorkspace(
            {
              provider: 'gemini_cli',
              cli_path: fake,
              config: config(),
              input: {
                ...task,
                skillId: 'review',
                skillBundle: readSkillBundle('review', skillDir),
              },
            },
            undefined,
            onProgress,
          ),
        testConnection: async () => ({ ok: true, message: '' }),
      },
    },
  ]);
  const pending = adapter.execute({ ...input, jobId: 'streaming-call' });
  let running!: ReturnType<typeof executionLogs.get>;
  try {
    await vi.waitFor(
      () => {
        const summary = executionLogs.list({
          job_id: 'streaming-call',
          page: 1,
          page_size: 10,
        }).items[0];
        running = executionLogs.get(summary.id);
        expect(running?.attempts[0].diagnostics?.stdout).toContain('tool_use');
      },
      { timeout: 3000 },
    );
    expect(running?.status).toBe('running');
    expect(running?.attempts[0].execution?.prompt).toBe(input.prompt);
    expect(running?.attempts[0].timeout_seconds).toBe(900);
    expect(running?.attempts[0].last_output_at).toBeTruthy();
    expect(JSON.stringify(running)).not.toContain('test-private-value');
  } finally {
    fs.writeFileSync(release, '');
  }
  const result = await pending;
  expect(result.status).toBe('success');
  expect(result.result).toEqual({ quality: 80 });
  expect(result.usage).toMatchObject({
    promptTokens: 20,
    completionTokens: 5,
    totalTokens: 25,
    cachedTokens: 2,
  });
});

it('ends a failed Gemini policy check promptly and lets the backup take over without labeling the whole account exhausted', async () => {
  const fake = cli(
    'policy-failed-gemini',
    `process.stderr.write('Policy enforcement failed: 429 RESOURCE_EXHAUSTED');setInterval(()=>{},1000);`,
  );
  const adapter = new FallbackAIAdapter([
    {
      target: target('primary'),
      adapter: {
        execute: (task, update) =>
          executeInWorkspace(
            {
              provider: 'gemini_cli',
              cli_path: fake,
              config: config(),
              input: task,
            },
            undefined,
            update,
          ),
        testConnection: async () => ({ ok: true, message: '' }),
      },
    },
    {
      target: target('backup'),
      adapter: {
        execute: async () => ({
          status: 'success',
          result: { quality: 70 },
          provider: 'codex_cli',
          model: 'backup',
          durationMs: 1,
        }),
        testConnection: async () => ({ ok: true, message: '' }),
      },
    },
  ]);
  const result = await adapter.execute({ ...input, jobId: 'policy-call' });
  expect(result.status).toBe('success');
  const log = executionLogs.get(result.trace_id!)!;
  expect(log.attempts[0].error?.code).toBe('gemini_policy_unavailable');
  expect(log.attempts[0].error?.message).toContain(
    '不代表主模型或整个账号额度耗尽',
  );
  expect(log.attempts[0].duration_ms).toBeLessThan(5000);
  expect(log.attempts[1].status).toBe('success');
});

it('retains both failure causes instead of reporting only the last executor', async () => {
  const adapter = new FallbackAIAdapter(
    ['primary', 'backup'].map((id) => ({
      target: target(id),
      adapter: {
        execute: async () => ({
          status: 'failed' as const,
          provider: 'test',
          model: 'test',
          durationMs: 1,
          error: {
            code:
              id === 'primary'
                ? 'gemini_policy_unavailable'
                : 'invalid_json_schema',
            message: id + ' failed',
          },
        }),
        testConnection: async () => ({ ok: true, message: '' }),
      },
    })),
  );
  const result = await adapter.execute({ ...input, jobId: 'all-failed-call' });
  expect(result.error?.message).toContain(
    'primary [gemini_policy_unavailable]',
  );
  expect(result.error?.message).toContain('backup [invalid_json_schema]');
});

it('does not mistake article text or tool output quoting an error for a process failure', () => {
  const content =
    'Policy enforcement failed: 429 RESOURCE_EXHAUSTED invalid_json_schema';
  expect(
    classifyProcessFailure(
      JSON.stringify({ type: 'message', role: 'user', content }),
      '',
    ),
  ).toBeUndefined();
  expect(
    classifyProcessFailure(
      JSON.stringify({ type: 'tool_result', output: content }),
      '',
    ),
  ).toBeUndefined();
  expect(
    classifyProcessFailure(
      JSON.stringify({ type: 'error', message: 'invalid_json_schema' }),
      '',
    )?.error.code,
  ).toBe('invalid_json_schema');
  expect(classifyProcessFailure('', '429 RESOURCE_EXHAUSTED')?.error.code).toBe(
    'model_rate_limited',
  );
  expect(
    classifyProcessFailure('', 'at read_file (runner.js:429:12)'),
  ).toBeUndefined();
});

it('requires a successful final stream event and excludes user and tool messages from the answer', () => {
  const message = {
    type: 'message',
    role: 'assistant',
    content: '{"quality":80}',
    delta: true,
  };
  expect(() => parseGeminiOutput(JSON.stringify(message))).toThrow(
    '未返回完成事件',
  );
  expect(() =>
    parseGeminiOutput(
      JSON.stringify({
        type: 'result',
        status: 'error',
        error: { message: 'Request rejected' },
      }),
    ),
  ).toThrow('Request rejected');
  const events = [
    { type: 'message', role: 'user', content: 'not the answer' },
    { type: 'tool_result', output: 'not the answer' },
    {
      type: 'message',
      role: 'assistant',
      content: 'I will read the file first.',
      delta: true,
    },
    { type: 'tool_use', tool_name: 'read_file' },
    message,
    { type: 'result', status: 'success' },
  ];
  expect(
    parseGeminiOutput(events.map((x) => JSON.stringify(x)).join('\n')).response,
  ).toBe('{"quality":80}');
});

it('only accepts progress with a live matching Worker lease, redacts it and discards old progress after reclaim', async () => {
  const request = {
    provider: 'gemini_cli' as const,
    cli_path: 'test',
    config: config(),
    input,
  };
  const id = executionQueue.enqueue('progress-worker', request);
  const lease = executionQueue.claim('progress-worker', 1)!;
  const progress: ExecutionProgress = {
    updated_at: new Date().toISOString(),
    diagnostics: {
      stdout: 'reading article',
      stderr: 'api_key=private-progress-token',
      exit_code: null,
      timed_out: false,
      timeout_seconds: 900,
      output_truncated: false,
    },
  };
  expect(
    executionQueue.renew('other-worker', id, lease.lease_token, progress),
  ).toBe(false);
  expect(
    executionQueue.renew('progress-worker', id, 'wrong-token', progress),
  ).toBe(false);
  expect(
    executionQueue.renew('progress-worker', id, lease.lease_token, progress),
  ).toBe(true);
  const row = getSqliteDatabase()
    .prepare('SELECT progress_json FROM ai_jobs WHERE id=?')
    .get(id) as { progress_json: string };
  expect(row.progress_json).toContain('reading article');
  expect(row.progress_json).not.toContain('private-progress-token');
  const onProgress = vi.fn();
  const waiting = executionQueue.wait(id, request, onProgress);
  expect(onProgress).toHaveBeenCalledWith(
    expect.objectContaining({ updated_at: progress.updated_at }),
  );
  executionQueue.complete('progress-worker', id, lease.lease_token, {
    status: 'success',
    result: 'ok',
    provider: 'test',
    model: 'test',
    durationMs: 1,
  });
  expect((await waiting).status).toBe('success');
  const secondId = executionQueue.enqueue('reclaim-worker', request);
  const old = executionQueue.claim('reclaim-worker', 1)!;
  executionQueue.renew('reclaim-worker', secondId, old.lease_token, progress);
  getSqliteDatabase()
    .prepare('UPDATE ai_jobs SET lease_until=? WHERE id=?')
    .run(Date.now() - 1, secondId);
  const next = executionQueue.claim('reclaim-worker', 1)!;
  expect(
    executionQueue.renew('reclaim-worker', secondId, old.lease_token, progress),
  ).toBe(false);
  expect(
    getSqliteDatabase()
      .prepare('SELECT progress_json FROM ai_jobs WHERE id=?')
      .get(next.id),
  ).toEqual({ progress_json: null });
});

it('decodes multibyte streaming output without corrupting split UTF-8 bytes', async () => {
  const fake = cli(
    'utf8-cli',
    `const b=Buffer.from('正文读取完成');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),20);`,
  );
  const result = await runProcess(fake, [], process.cwd(), '', 1000);
  expect(result.stdout).toBe('正文读取完成');
});

// A recoverable model 429 must not be treated like a failed policy checker.
it('allows Gemini to recover from a transient model rate-limit warning within the shared execution time limit', async () => {
  const fake = cli(
    'recoverable-rate-limit',
    `process.stderr.write('HTTP 429 Too Many Requests; retrying');setTimeout(()=>console.log(JSON.stringify({response:'Recovered answer'})),30);`,
  );
  const result = await executeInWorkspace({
    provider: 'gemini_cli',
    cli_path: fake,
    config: config(),
    input: { ...input, outputSchema: undefined },
  });
  expect(result.status).toBe('success');
  expect(result.result).toBe('Recovered answer');
  expect(result.diagnostics?.stderr).toContain('429');
});
