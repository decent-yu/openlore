import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import {
  ExecutorConfigSchema,
  ExecutionRequestSchema,
  type ExecutorConfig,
  type ExecutionProgress,
} from '@openlore/contracts';
import {
  executeInWorkspace,
  runProcess,
} from '../../infrastructure/ai/workspace_runner.js';
import { scanSkillDirectory } from '../../infrastructure/ai/skill_bundle.js';

const WorkerConfiguration = z.object({
  server_url: z.string().url(),
  profile_id: z.string(),
  token: z.string().min(32),
  name: z.string().default(os.hostname()),
  overrides: ExecutorConfigSchema.partial().default({}),
  cli_path: z.string().optional(),
});
const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
export async function inspectExecutor(config: ExecutorConfig, cliPath: string) {
  const version = await runProcess(
    cliPath,
    ['--version'],
    process.cwd(),
    '',
    10000,
  );
  if (version.code !== 0) throw new Error('CLI version check failed');
  return {
    version: version.stdout.trim(),
    catalog:
      config.skills_mode === 'local'
        ? scanSkillDirectory(config.skills_directory)
        : [],
  };
}
export async function executeOnce() {
  let text = '';
  for await (const part of process.stdin) {
    text += part;
    if (Buffer.byteLength(text) > 24 * 1024 * 1024)
      throw new Error('Request too large');
  }
  const envelope = JSON.parse(text);
  const result =
    envelope.action === 'inspect'
      ? await inspectExecutor(
          ExecutorConfigSchema.parse(envelope.config),
          z.string().parse(envelope.cli_path),
        )
      : await executeInWorkspace(
          ExecutionRequestSchema.parse(envelope.request),
          undefined,
          envelope.stream
            ? (progress) =>
                process.stdout.write(
                  JSON.stringify({ type: 'progress', progress }) + '\n',
                )
            : undefined,
        );
  process.stdout.write(
    JSON.stringify(envelope.stream ? { type: 'result', result } : result) +
      '\n',
  );
}
export async function runWorker(configPath: string) {
  const local = WorkerConfiguration.parse(
    JSON.parse(fs.readFileSync(configPath, 'utf8')),
  );
  const server = new URL(local.server_url);
  if (
    server.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(server.hostname)
  )
    throw new Error('远程 Worker 连接需要 HTTPS');
  const endpoint = new URL(
    `/api/v1/worker/${encodeURIComponent(local.profile_id)}/`,
    server,
  ).href;
  let stopping = false;
  const controllers = new Set<AbortController>();
  const shutdown = () => {
    stopping = true;
    for (const controller of controllers) controller.abort();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  const request = async (route: string, body?: unknown) => {
    const result = await fetch(endpoint + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${local.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok)
      throw Object.assign(new Error(`Worker API ${result.status}`), {
        status: result.status,
      });
    return result.json() as Promise<any>;
  };
  const active = new Set<Promise<void>>();
  let lastHeartbeat = 0;
  let configuration: any;
  console.log(`OpenLore Worker ${local.name} 启动，连接 ${server.origin}`);
  try {
    while (!stopping) {
      try {
        if (Date.now() - lastHeartbeat > 10000) {
          configuration = await request('configuration');
          const config = ExecutorConfigSchema.parse({
            ...configuration.config,
            ...local.overrides,
          });
          const inspected = await inspectExecutor(
            config,
            local.cli_path || configuration.cli_path,
          );
          await request('heartbeat', {
            name: local.name,
            catalog: inspected.catalog,
          });
          lastHeartbeat = Date.now();
        }
        if (
          active.size <
          Math.min(
            configuration.config.concurrency,
            local.overrides.concurrency || 4,
          )
        ) {
          const job = await request('claim', {});
          if (job) {
            const controller = new AbortController();
            controllers.add(controller);
            const run = (async () => {
              let lastRenewal = Date.now();
              let renewing = false;
              let progress: ExecutionProgress | undefined;
              const timer = setInterval(async () => {
                if (renewing) return;
                renewing = true;
                try {
                  const result = await request(`jobs/${job.id}/renew`, {
                    lease_token: job.lease_token,
                    progress,
                  });
                  if (!result.active) controller.abort();
                  else lastRenewal = Date.now();
                } catch {
                  if (Date.now() - lastRenewal > 40000) controller.abort();
                } finally {
                  renewing = false;
                }
              }, 10000);
              try {
                const envelope = ExecutionRequestSchema.parse(job.request);
                envelope.config = ExecutorConfigSchema.parse({
                  ...envelope.config,
                  ...local.overrides,
                });
                envelope.cli_path = local.cli_path || envelope.cli_path;
                const result = await executeInWorkspace(
                  envelope,
                  controller.signal,
                  (update) => {
                    progress = update;
                  },
                );
                if (controller.signal.aborted) return;
                for (let attempt = 0; attempt < 5 && !stopping; attempt++) {
                  try {
                    await request(`jobs/${job.id}/result`, {
                      lease_token: job.lease_token,
                      result,
                    });
                    console.log(`任务 ${job.id}：${result.status}`);
                    break;
                  } catch (error: any) {
                    if (error.status === 409) break;
                    if (attempt === 4) throw error;
                    await delay(2000);
                  }
                }
              } finally {
                clearInterval(timer);
                controllers.delete(controller);
              }
            })().catch((error) =>
              console.error(`任务 ${job.id} 回传失败：${error.message}`),
            );
            active.add(run);
            void run.finally(() => active.delete(run));
            continue;
          }
        }
      } catch (error: any) {
        console.error(`执行器连接异常：${error.message}`);
        if (error.status === 401)
          throw new Error('执行器令牌已失效，请重新配对');
        lastHeartbeat = 0;
      }
      await delay(2000);
    }
  } finally {
    shutdown();
    await Promise.allSettled(active);
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
  }
}
export async function writeWorkerConfiguration(
  file: string,
  serverUrl: string,
  profileId: string,
) {
  const token = process.env.OPENLORE_WORKER_TOKEN;
  if (!token)
    throw new Error(
      '请设置 OPENLORE_WORKER_TOKEN 后初始化，令牌不会写进命令参数',
    );
  const data = WorkerConfiguration.parse({
    server_url: serverUrl,
    profile_id: profileId,
    token,
  });
  fs.mkdirSync(path.dirname(path.resolve(file)), {
    recursive: true,
    mode: 0o700,
  });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(`Worker 配置已保存：${file}`);
}
