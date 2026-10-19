import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import {
  ExecutorConfigSchema,
  type ExecutionRequest,
} from '@openlore/contracts';
import { initDatabase } from '../src/infrastructure/persistence/sqlite/db.js';
import { getAppPaths } from '../src/infrastructure/config/paths.js';
import {
  executeInWorkspace,
  runProcess,
} from '../src/infrastructure/ai/workspace_runner.js';
import { FallbackAIAdapter } from '../src/infrastructure/ai/fallback_runner.js';
import { executionLogs } from '../src/infrastructure/ai/execution_logs.js';
import { readSkillBundle } from '../src/infrastructure/ai/skill_bundle.js';

beforeAll(() => initDatabase());
const sessionId = '12345678-1234-4234-8234-123456789abc';
const article =
  'This article explains the actual implementation with reproducible engineering evidence.';
function fixture(provider: 'codex_cli' | 'gemini_cli', suffix = '') {
  const root = path.join(getAppPaths().dataDir, provider + suffix);
  fs.mkdirSync(root, { recursive: true });
  const skill = path.join(root, 'skill');
  fs.mkdirSync(skill);
  fs.writeFileSync(
    path.join(skill, 'SKILL.md'),
    'Read input/article.md and return the required JSON.',
  );
  const cli = path.join(root, 'fake-cli');
  fs.writeFileSync(
    cli,
    `#!${process.execPath}\nconst fs=require('fs');const args=process.argv.slice(2);const provider=${JSON.stringify(provider)};const resumed=args.includes('resume')||args.includes('--resume');const emit=x=>console.log(JSON.stringify(x));
    const calls=fs.existsSync('calls.json')?JSON.parse(fs.readFileSync('calls.json','utf8')):[];
    calls.push({args,cwd:process.cwd()});fs.writeFileSync('calls.json',JSON.stringify(calls));
    if(args.includes('--ephemeral')||args.includes('--last'))process.exit(4);
    if(resumed) {
      const i=args.indexOf(provider==='codex_cli'?'resume':'--resume');if(args[i+1]!==${JSON.stringify(sessionId)})process.exit(5);
      if(fs.readFileSync('context.txt','utf8')!=='original-context')process.exit(6);
    } else {fs.readFileSync('.agents/skills/review/SKILL.md','utf8');fs.readFileSync('input/article.md','utf8');fs.writeFileSync('context.txt','original-context');}
    const answer={quality:80,evidence_refs:resumed?[${JSON.stringify(article)}]:['Title: Wrapped metadata is not article evidence.']};
    if(provider==='codex_cli') {emit({type:'thread.started',thread_id:${JSON.stringify(sessionId)}});fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(answer));emit({type:'turn.completed',usage:{input_tokens:20,output_tokens:5,cached_input_tokens:10}});}
    else {emit({type:'init',session_id:${JSON.stringify(sessionId)},model:'test'});if(!resumed)emit({type:'tool_use',tool_name:'read_file',parameters:{file_path:'input/article.md'}});emit({type:'message',role:'assistant',content:JSON.stringify(answer),delta:true});emit({type:'result',status:'success'});}
  `,
    { mode: 0o700 },
  );
  const request: ExecutionRequest = {
    provider,
    cli_path: cli,
    config: ExecutorConfigSchema.parse({
      workspace_root: path.join(root, 'work'),
    }),
    input: {
      jobId: 'review-session-' + provider + suffix,
      profileId: 'profile',
      articleId: 'article',
      taskType: 'assess',
      skillId: 'review',
      skillBundle: readSkillBundle('review', skill),
      prompt: 'Load the Skill and read input/article.md.',
      material: article,
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          quality: { type: 'number' },
          evidence_refs: { type: 'array', items: { type: 'string' } },
        },
        required: ['quality', 'evidence_refs'],
      },
    },
  };
  return request;
}
for (const provider of ['codex_cli', 'gemini_cli'] as const) {
  it(`${provider}: repairs in the exact session/workspace, preserves the original result and uses one task log`, async () => {
    const request = fixture(provider);
    const adapter = new FallbackAIAdapter([
      {
        target: {
          id: 'profile',
          name: 'Executor',
          provider,
          cliPath: request.cli_path,
          isPrimary: true,
          execution: request.config,
        },
        adapter: {
          execute: (input, progress) =>
            executeInWorkspace({ ...request, input }, undefined, progress),
          testConnection: async () => ({ ok: true, message: '' }),
        },
      },
    ]);
    const result = await adapter.execute(request.input, undefined, {
      validateResult: (data: any) =>
        data.evidence_refs[0] === article
          ? []
          : [
              {
                path: 'evidence_refs[0]',
                code: 'ungrounded_evidence',
                message: 'The quote comes from Title, not the article.',
              },
            ],
    });
    expect(result.status).toBe('success');
    const log = executionLogs.get(result.trace_id!)!;
    expect(log.job_id).toBe(request.input.jobId);
    expect(log.attempts).toHaveLength(2);
    expect(log.attempts[0]).toMatchObject({
      phase: 'execute',
      status: 'invalid_output',
      validation_issues: [{ path: 'evidence_refs[0]' }],
    });
    expect(log.attempts[1]).toMatchObject({
      phase: 'correction',
      correction_of: 1,
      status: 'success',
      session_id: sessionId,
      resumed: true,
    });
    expect(log.attempts[1].execution?.workspace).toBe(
      log.attempts[0].execution?.workspace,
    );
    expect(log.attempts[1].execution?.prompt).toContain('previous_result');
    expect(log.attempts[1].execution?.prompt).toContain(
      'Title, not the article',
    );
    expect(log.attempts[0].output).toContain('Wrapped metadata');
    if (provider === 'codex_cli')
      expect(log.usage_summary).toMatchObject({
        recorded_attempts: 2,
        total_attempts: 2,
        usage: { promptTokens: 40, totalTokens: 50, cachedTokens: 20 },
      });
    expect(
      executionLogs.list({
        job_id: request.input.jobId,
        page: 1,
        page_size: 20,
      }).total,
    ).toBe(1);
    const workspace = result.session!.workspace;
    expect(fs.readFileSync(path.join(workspace, 'prompt.txt'), 'utf8')).toBe(
      request.input.prompt,
    );
    const calls = JSON.parse(
      fs.readFileSync(path.join(workspace, 'calls.json'), 'utf8'),
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].args).toContain(
      provider === 'codex_cli' ? 'resume' : '--resume',
    );
    expect(calls[1].args).toContain(sessionId);
    expect(calls[1].args).not.toContain('--ephemeral');
    const changed = await executeInWorkspace({
      ...request,
      input: {
        ...request.input,
        material: article + ' Changed',
        session: result.session,
      },
    });
    expect(changed.status).toBe('failed');
    expect(changed.error?.message).toContain('不匹配');
    const wrongJob = await executeInWorkspace({
      ...request,
      input: { ...request.input, jobId: 'other-task', session: result.session },
    });
    expect(wrongJob.status).toBe('failed');
    expect(
      JSON.parse(fs.readFileSync(path.join(workspace, 'calls.json'), 'utf8')),
    ).toHaveLength(2);
  });
}
it('returns invalid output without restarting when no resumable session exists', async () => {
  let calls = 0;
  const adapter = new FallbackAIAdapter([
    {
      target: {
        id: 'profile',
        name: 'Executor',
        provider: 'gemini_cli',
        cliPath: 'test',
        isPrimary: true,
      },
      adapter: {
        execute: async () => {
          calls++;
          return {
            status: 'success',
            result: { quality: 80 },
            provider: 'gemini_cli',
            model: 'test',
            durationMs: 1,
          };
        },
        testConnection: async () => ({ ok: true, message: '' }),
      },
    },
  ]);
  const result = await adapter.execute(
    {
      jobId: 'missing-session',
      profileId: 'profile',
      taskType: 'assess',
      prompt: 'Review',
      material: article,
    },
    undefined,
    {
      validateResult: () => [
        { path: 'evidence_refs', code: 'missing', message: 'Missing evidence' },
      ],
    },
  );
  expect(result.status).toBe('invalid_output');
  expect(result.error?.code).toBe('session_unavailable');
  expect(calls).toBe(1);
});
it('stops after one correction and preserves both invalid results', async () => {
  const request = fixture('gemini_cli', '-bounded');
  let calls = 0;
  const adapter = new FallbackAIAdapter([
    {
      target: {
        id: 'profile',
        name: 'Executor',
        provider: 'gemini_cli',
        cliPath: request.cli_path,
        isPrimary: true,
      },
      adapter: {
        execute: async (input) => {
          calls++;
          return executeInWorkspace({ ...request, input });
        },
        testConnection: async () => ({ ok: true, message: '' }),
      },
    },
  ]);
  const result = await adapter.execute(request.input, undefined, {
    validateResult: () => [
      { path: 'evidence_refs', code: 'invalid', message: 'Still invalid' },
    ],
  });
  expect(result.status).toBe('invalid_output');
  expect(calls).toBe(2);
  expect(
    executionLogs
      .get(result.trace_id!)
      ?.attempts.every((attempt) => attempt.status === 'invalid_output'),
  ).toBe(true);
});
it('carries the session through the independent SSH entrypoint', async () => {
  const request = fixture('gemini_cli', '-ssh');
  const invoke = async (req: ExecutionRequest) => {
    const result = await runProcess(
      process.execPath,
      [path.resolve('dist/cli/index.js'), 'execute-once'],
      process.cwd(),
      JSON.stringify({ action: 'execute', request: req }),
      10000,
    );
    expect(result.code).toBe(0);
    return JSON.parse(result.stdout);
  };
  const first = await invoke(request);
  expect(first.session?.id).toBe(sessionId);
  const next = await invoke({
    ...request,
    input: {
      ...request.input,
      session: first.session,
      prompt: 'Correct only evidence_refs.',
    },
  });
  expect(next.status).toBe('success');
  expect(next.execution.workspace).toBe(first.execution.workspace);
});
