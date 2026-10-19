import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import {
  ExecutorConfigSchema,
  type ExecutionRequest,
} from '@openlore/contracts';
import {
  getSqliteDatabase,
  initDatabase,
} from '../src/infrastructure/persistence/sqlite/db.js';
import {
  executeInWorkspace,
  runProcess,
} from '../src/infrastructure/ai/workspace_runner.js';
import {
  readSkillBundle,
  bundleRevision,
} from '../src/infrastructure/ai/skill_bundle.js';
import { executionQueue } from '../src/modules/executors/queue.js';
import { executorService } from '../src/modules/executors/service.js';
import { settingsService } from '../src/modules/settings/service.js';
import {
  ExecutorAdapter,
  shellQuote,
} from '../src/infrastructure/ai/executor_adapter.js';
import { createServer } from '../src/http/server.js';

describe('Workspace execution and remote Worker', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'openlore-executor-test-'),
  );
  const skill = path.join(root, 'skills', 'probe');
  const fakeCli = path.join(root, 'fake-gemini');
  let request: ExecutionRequest;
  beforeAll(() => {
    process.env.OPENLORE_DATA_DIR = path.join(root, 'data');
    process.env.LOG_LEVEL = 'silent';
    initDatabase();
    fs.mkdirSync(path.join(skill, 'references'), { recursive: true });
    fs.writeFileSync(
      path.join(skill, 'SKILL.md'),
      '---\nname: probe\ndescription: Test skill\ntype: extraction\n---\nRead references/marker.txt.',
    );
    fs.writeFileSync(
      path.join(skill, 'references', 'marker.txt'),
      'TEST_SKILL_REVISION',
    );
    fs.writeFileSync(
      fakeCli,
      `#!${process.execPath}\nconst fs=require('fs');if(process.argv.includes('--version')){console.log('Fake Gemini');process.exit(0);}const prompt=process.argv[process.argv.indexOf('-p')+1];const marker=fs.readFileSync('.agents/skills/probe/references/marker.txt','utf8');fs.writeFileSync('output/note.md',marker);const finish=()=>console.log(JSON.stringify({response:JSON.stringify({marker,prompt,material:fs.readFileSync('input/article.md','utf8')})}));if(process.cwd().includes('worker-work')){process.stderr.write('Reading Skill and article');setTimeout(finish,11500);}else finish();`,
      { mode: 0o700 },
    );
    request = {
      provider: 'gemini_cli',
      cli_path: fakeCli,
      config: ExecutorConfigSchema.parse({
        workspace_root: path.join(root, 'work'),
        timeout_seconds: 10,
      }),
      input: {
        jobId: 'input/../../unsafe-id',
        profileId: 'worker',
        taskType: 'assess',
        skillId: 'probe',
        skillBundle: readSkillBundle('probe', skill),
        prompt: '$probe\nReview input/article.md',
        material: 'Actual material',
        outputSchema: { type: 'object' },
      },
    };
  });
  afterAll(() => {
    getSqliteDatabase().close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('copies complete Skill files into an isolated workspace and sends the exact preview prompt', async () => {
    const result = await executeInWorkspace(request);
    expect(result.status).toBe('success');
    expect(result.result).toMatchObject({
      marker: 'TEST_SKILL_REVISION',
      prompt: request.input.prompt,
      material: 'Actual material',
    });
    expect(result.execution?.skill_revision).toBe(
      request.input.skillBundle?.revision,
    );
    expect(
      result.execution?.workspace.startsWith(
        path.join(root, 'work', 'jobs', 'job-'),
      ),
    ).toBe(true);
    expect(result.artifacts?.[0].path).toBe('note.md');
    expect(
      fs.readFileSync(
        path.join(result.execution!.workspace, 'prompt.txt'),
        'utf8',
      ),
    ).toBe(request.input.prompt);
  });
  it('rejects traversal and mismatched revisions before invoking a CLI', async () => {
    const bundle = {
      ...request.input.skillBundle!,
      files: [
        ...request.input.skillBundle!.files,
        { path: '../../escape', content: 'eA==', executable: false },
      ],
    };
    bundle.revision = bundleRevision(bundle.files);
    expect(
      (
        await executeInWorkspace({
          ...request,
          input: { ...request.input, skillBundle: bundle },
        })
      ).status,
    ).toBe('failed');
    expect(fs.existsSync(path.join(root, 'escape'))).toBe(false);
    expect(
      (
        await executeInWorkspace({
          ...request,
          input: { ...request.input, skillRevision: 'wrong' },
        })
      ).error?.message,
    ).toContain('版本');
  });
  it('supports a configured Skill directory without global installation', async () => {
    const result = await executeInWorkspace({
      ...request,
      config: {
        ...request.config,
        skills_mode: 'local',
        skills_directory: path.join(root, 'skills'),
      },
      input: { ...request.input, skillBundle: undefined },
    });
    expect(result.status).toBe('success');
  });
  it('fails promptly on missing CLI binaries and cancels a running process', async () => {
    const missing = await executeInWorkspace({
      ...request,
      cli_path: path.join(root, 'missing-cli'),
    });
    expect(missing.status).toBe('failed');
    const controller = new AbortController();
    const processResult = runProcess(
      process.execPath,
      ['-e', 'setInterval(()=>{},1000)'],
      root,
      '',
      10000,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 50);
    const result = await processResult;
    expect(result.code).not.toBe(0);
  });
  it('authenticates per-executor and refuses stale or cross-executor lease results', async () => {
    await settingsService.saveAIProfile({
      id: 'worker',
      name: 'Worker',
      provider: 'gemini_cli',
      cliPath: fakeCli,
      execution: { transport: 'worker' },
    });
    const pair = executorService.pair('worker');
    expect(() => executorService.authenticate('worker', 'invalid')).toThrow();
    expect(executorService.authenticate('worker', pair.token).id).toBe(
      'worker',
    );
    const id = executionQueue.enqueue('worker', request);
    const lease = executionQueue.claim('worker', 1)!;
    expect(lease.id).toBe(id);
    expect(executionQueue.claim('worker', 1)).toBeNull();
    const result = {
      status: 'success',
      result: 'ok',
      provider: 'mock',
      model: 'mock',
      durationMs: 1,
    };
    expect(
      executionQueue.complete('other', id, lease.lease_token, result),
    ).toBe(false);
    getSqliteDatabase()
      .prepare('UPDATE ai_jobs SET lease_until=? WHERE id=?')
      .run(Date.now() - 1, id);
    expect(executionQueue.renew('worker', id, lease.lease_token)).toBe(false);
    const next = executionQueue.claim('worker', 1)!;
    expect(
      executionQueue.complete('worker', id, lease.lease_token, result),
    ).toBe(false);
    expect(
      executionQueue.complete('worker', id, next.lease_token, result),
    ).toBe(true);
    expect(
      executionQueue.complete('worker', id, next.lease_token, result),
    ).toBe(false);
  });
  it('executes the SSH entrypoint over JSON stdin without launching a web server', async () => {
    const result = await runProcess(
      process.execPath,
      [path.resolve('dist/cli/index.js'), 'execute-once'],
      process.cwd(),
      JSON.stringify({ action: 'execute', request }),
      10000,
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).result).toMatchObject({
      marker: 'TEST_SKILL_REVISION',
    });
  });
  it('streams progress and a final result through the SSH entrypoint protocol', async () => {
    const result = await runProcess(
      process.execPath,
      [path.resolve('dist/cli/index.js'), 'execute-once'],
      process.cwd(),
      JSON.stringify({ action: 'execute', request, stream: true }),
      10000,
    );
    expect(result.code).toBe(0);
    const events = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events[0]).toMatchObject({
      type: 'progress',
      progress: { execution: { prompt: request.input.prompt } },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      result: { status: 'success', result: { marker: 'TEST_SKILL_REVISION' } },
    });
  });
  it('requires management authentication when a server access token is configured', async () => {
    const previous = process.env.OPENLORE_ADMIN_TOKEN;
    process.env.OPENLORE_ADMIN_TOKEN = 'test-administrator-token';
    const app = await createServer();
    if (previous === undefined) delete process.env.OPENLORE_ADMIN_TOKEN;
    else process.env.OPENLORE_ADMIN_TOKEN = previous;
    try {
      expect((await app.inject('/api/v1/settings')).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            url: '/api/v1/settings',
            headers: { authorization: 'Bearer test-administrator-token' },
          })
        ).statusCode,
      ).toBe(200);
      const invalidWorker = await app.inject({
        method: 'POST',
        url: '/api/v1/worker/worker/claim',
        headers: { authorization: 'Bearer test-administrator-token' },
        payload: {},
      });
      expect(invalidWorker.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
  it('quotes SSH arguments as data', () => {
    expect(shellQuote("/tmp/a'b; touch /tmp/never")).toBe(
      "'/tmp/a'\\''b; touch /tmp/never'",
    );
  });
  it('runs the actual Worker client against an HTTP server and returns a CLI result', async () => {
    const config = ExecutorConfigSchema.parse({
      transport: 'worker',
      workspace_root: path.join(root, 'worker-work'),
      skills_mode: 'local',
      skills_directory: path.join(root, 'skills'),
      timeout_seconds: 20,
      queue_timeout_seconds: 20,
    });
    await settingsService.saveAIProfile({
      id: 'remote',
      name: 'Remote',
      provider: 'gemini_cli',
      cliPath: fakeCli,
      execution: config,
    });
    const pair = executorService.pair('remote');
    const app = await createServer();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const file = path.join(root, 'worker.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        server_url: address,
        profile_id: 'remote',
        token: pair.token,
        name: 'Test laptop',
      }),
      { mode: 0o600 },
    );
    const child = spawn(
      process.execPath,
      [path.resolve('dist/cli/index.js'), 'worker', file],
      { env: { ...process.env, OPENLORE_ADMIN_TOKEN: '' }, stdio: 'pipe' },
    );
    let errors = '';
    child.stderr?.on('data', (data) => (errors += data));
    try {
      await vi.waitFor(
        () =>
          expect(
            getSqliteDatabase()
              .prepare(
                "SELECT worker_last_seen FROM ai_profiles WHERE id='remote'",
              )
              .get(),
          ).toMatchObject({ worker_last_seen: expect.any(String) }),
        { timeout: 15000 },
      );
      const onProgress = vi.fn();
      const running = new ExecutorAdapter(
        'remote',
        'gemini_cli',
        fakeCli,
        config,
      ).execute({ ...request.input, profileId: 'remote' }, onProgress);
      await vi.waitFor(
        () =>
          expect(onProgress).toHaveBeenCalledWith(
            expect.objectContaining({
              diagnostics: expect.objectContaining({
                stderr: 'Reading Skill and article',
              }),
            }),
          ),
        { timeout: 15000 },
      );
      const result = await running;
      expect(result.status, errors).toBe('success');
      expect(result.result).toMatchObject({ marker: 'TEST_SKILL_REVISION' });
      const denied = await app.inject({
        method: 'POST',
        url: '/api/v1/worker/remote/claim',
        payload: {},
      });
      expect(denied.statusCode).toBe(401);
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.on('close', () => resolve()));
      await app.close();
    }
  }, 30000);
});
