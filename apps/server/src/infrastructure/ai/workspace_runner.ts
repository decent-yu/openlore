import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  ExecutionRequestSchema,
  type ExecutionRequest,
  type ExecutionResult,
  type SkillBundle,
  type ExecutionProgress,
} from '@openlore/contracts';
import { classifyProcessFailure, parseGeminiOutput } from './cli_output.js';
import {
  scanSkillDirectory,
  safeRelativePath,
  validateBundle,
  MAX_BUNDLE_BYTES,
} from './skill_bundle.js';

function expand(value: string): string {
  return value.startsWith('~/')
    ? path.join(os.homedir(), value.slice(2))
    : path.resolve(value);
}
export async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  input: string,
  timeout: number,
  signal?: AbortSignal,
  options: {
    onOutput?: (stdout: string, stderr: string) => void;
    shouldStop?: (stdout: string, stderr: string) => boolean;
    onStdoutChunk?: (chunk: string) => void;
    stdoutTailBytes?: number;
  } = {},
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stderrTruncated: boolean;
}> {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('OPENLORE_'),
      ),
    );
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env,
      detached: process.platform !== 'win32',
    });
    let stdout = '',
      stderr = '',
      stderrTruncated = false,
      timedOut = false,
      settled = false;
    let observerError: unknown;
    let lastPublished = 0;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const publish = (force = false) => {
      if (observerError) return;
      try {
        if (force || Date.now() - lastPublished >= 1000) {
          if (publishTimer) {
            clearTimeout(publishTimer);
            publishTimer = undefined;
          }
          lastPublished = Date.now();
          options.onOutput?.(stdout, stderr);
        } else if (!publishTimer) {
          publishTimer = setTimeout(
            () => {
              publishTimer = undefined;
              publish(true);
            },
            1000 - (Date.now() - lastPublished),
          );
        }
        if (!force && options.shouldStop?.(stdout, stderr)) terminate();
      } catch (error) {
        observerError = error;
        terminate();
      }
    };
    const stop = () => {
      try {
        if (child.pid && process.platform !== 'win32')
          process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {}
    };
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      stop();
      if (!hardTimer)
        hardTimer = setTimeout(() => {
          try {
            if (child.pid && process.platform !== 'win32')
              process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch {}
        }, 2000);
    };
    const abort = () => terminate();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeout);
    const finish = () => {
      clearTimeout(timer);
      if (publishTimer) clearTimeout(publishTimer);
      if (hardTimer) clearTimeout(hardTimer);
      signal?.removeEventListener('abort', abort);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      if (
        !options.stdoutTailBytes &&
        Buffer.byteLength(stdout) + Buffer.byteLength(data) > 16 * 1024 * 1024
      ) {
        terminate();
        return;
      }
      stdout += data;
      if (options.stdoutTailBytes)
        stdout = stdout.slice(-options.stdoutTailBytes);
      try {
        if (!observerError) options.onStdoutChunk?.(data);
      } catch (error) {
        observerError = error;
        terminate();
      }
      publish();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > 512 * 1024) {
        stderrTruncated = true;
        stderr = stderr.slice(-512 * 1024);
      }
      publish();
    });
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        finish();
        reject(error);
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        finish();
        publish(true);
        if (observerError) reject(observerError);
        else resolve({ code, stdout, stderr, timedOut, stderrTruncated });
      }
    });
    if (signal?.aborted) terminate();
    else child.stdin.end(input);
  });
}
export function collectArtifacts(
  folder: string,
): NonNullable<ExecutionResult['artifacts']> {
  if (fs.lstatSync(folder).isSymbolicLink())
    throw new Error('Output directory cannot be a symlink');
  const files: NonNullable<ExecutionResult['artifacts']> = [];
  let size = 0;
  function walk(dir: string, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error('Output symlinks are not allowed');
      const full = path.join(dir, entry.name),
        relative = prefix + entry.name;
      if (entry.isDirectory()) walk(full, relative + '/');
      else if (entry.isFile()) {
        safeRelativePath(relative);
        size += fs.statSync(full).size;
        if (size > MAX_BUNDLE_BYTES || files.length >= 200)
          throw new Error('Output artifacts exceed limits');
        files.push({
          path: relative,
          content: fs.readFileSync(full).toString('base64'),
          executable: false,
        });
      }
    }
  }
  walk(folder);
  return files;
}
export async function executeInWorkspace(
  raw: ExecutionRequest,
  signal?: AbortSignal,
  onProgress?: (progress: ExecutionProgress) => void,
): Promise<ExecutionResult> {
  const request = ExecutionRequestSchema.parse(raw),
    { input, config } = request;
  const started = Date.now();
  let model = input.model || 'default';
  let diagnostics: ExecutionResult['diagnostics'];
  let execution: ExecutionResult['execution'];
  let usage: ExecutionResult['usage'];
  const root = expand(
    config.workspace_root ||
      path.join(os.homedir(), '.openlore', 'executor-workspace'),
  );
  fs.mkdirSync(path.join(root, 'jobs'), { recursive: true, mode: 0o700 });
  // Only finished workspaces owned by this runner are eligible for retention cleanup.
  for (const entry of fs.readdirSync(path.join(root, 'jobs'), {
    withFileTypes: true,
  })) {
    const completed = path.join(
      root,
      'jobs',
      entry.name,
      '.openlore-completed',
    );
    if (
      entry.isDirectory() &&
      entry.name.startsWith('job-') &&
      fs.existsSync(completed) &&
      Date.now() - fs.statSync(completed).mtimeMs >
        config.retention_days * 86400000
    )
      fs.rmSync(path.dirname(completed), { recursive: true, force: true });
  }
  const workspace = fs.mkdtempSync(path.join(root, 'jobs', 'job-'));
  fs.mkdirSync(path.join(workspace, 'input'));
  fs.mkdirSync(path.join(workspace, 'output'));
  fs.mkdirSync(path.join(workspace, '.git'));
  let bundle: SkillBundle | undefined = input.skillBundle;
  try {
    if (input.skillId) {
      if (config.skills_mode === 'local') {
        const item = scanSkillDirectory(expand(config.skills_directory)).find(
          (item) => item.skill.id === input.skillId,
        );
        if (!item) throw new Error(`执行机上找不到 Skill：${input.skillId}`);
        bundle = item.bundle;
      }
      if (!bundle || bundle.id !== input.skillId)
        throw new Error('Missing requested Skill package');
      validateBundle(bundle);
      if (input.skillRevision && bundle.revision !== input.skillRevision)
        throw new Error('Skill 版本已变化，请刷新执行器 Skills 后重试');
      const target = path.join(workspace, '.agents', 'skills', bundle.id);
      for (const file of bundle.files) {
        const dest = path.join(target, safeRelativePath(file.path));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(file.content, 'base64'), {
          mode: file.executable ? 0o700 : 0o600,
        });
      }
    }
    const mode = request.provider === 'codex_cli' ? 'native' : 'explicit-path';
    const prompt = input.prompt;
    fs.writeFileSync(
      path.join(workspace, 'input', 'article.md'),
      input.material,
    );
    fs.writeFileSync(path.join(workspace, 'prompt.txt'), prompt);
    fs.writeFileSync(
      path.join(workspace, 'manifest.json'),
      JSON.stringify(
        {
          job_id: input.jobId,
          skill: bundle?.id,
          revision: bundle?.revision,
          mode,
          created_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    const resultFile = path.join(workspace, 'response.txt');
    let args: string[];
    if (request.provider === 'codex_cli') {
      args = ['--no-daemon', '-a', 'never'];
      if (config.config_profile) args.push('-p', config.config_profile);
      args.push(
        'exec',
        '--ignore-rules',
        '--sandbox',
        'workspace-write',
        '--skip-git-repo-check',
        '--ephemeral',
        '-C',
        workspace,
        '--json',
      );
      if (!config.inherit_user_config) args.push('--ignore-user-config');
      if (input.model) args.push('-m', input.model);
      if (input.outputSchema) {
        const schema = path.join(workspace, 'schema.json');
        fs.writeFileSync(schema, JSON.stringify(input.outputSchema));
        args.push('--output-schema', schema);
      }
      args.push('--output-last-message', resultFile, '-');
    } else {
      args = [
        '-p',
        prompt,
        '--output-format',
        'stream-json',
        '--approval-mode',
        'auto_edit',
        '--skip-trust',
      ];
      if (input.model) args.push('-m', input.model);
    }
    execution = {
      workspace,
      skill_id: bundle?.id,
      skill_revision: bundle?.revision,
      prompt,
      mode,
      skill_instructions: bundle?.files.find((file) => file.path === 'SKILL.md')
        ? Buffer.from(
            bundle.files.find((file) => file.path === 'SKILL.md')!.content,
            'base64',
          ).toString('utf8')
        : undefined,
      skill_files: bundle?.files.map((file) => file.path),
    };
    let lastOutputAt: string | undefined;
    let previousStdout = '',
      previousStderr = '';
    const progress = (stdout = '', stderr = '') => {
      if (stdout !== previousStdout || stderr !== previousStderr)
        lastOutputAt = new Date().toISOString();
      previousStdout = stdout;
      previousStderr = stderr;
      fs.writeFileSync(path.join(workspace, 'events.log'), stdout, {
        mode: 0o600,
      });
      fs.writeFileSync(path.join(workspace, 'stderr.log'), stderr, {
        mode: 0o600,
      });
      onProgress?.({
        updated_at: new Date().toISOString(),
        last_output_at: lastOutputAt,
        execution,
        diagnostics: {
          stdout: stdout.slice(-65536),
          stderr: stderr.slice(-65536),
          exit_code: null,
          timed_out: false,
          timeout_seconds: config.timeout_seconds,
          output_truncated: stdout.length > 65536 || stderr.length > 65536,
        },
      });
    };
    progress();
    const res = await runProcess(
      request.cli_path,
      args,
      workspace,
      request.provider === 'codex_cli' ? prompt : '',
      config.timeout_seconds * 1000,
      signal,
      {
        onOutput: progress,
        shouldStop: (stdout, stderr) =>
          ['gemini_policy_unavailable', 'invalid_json_schema'].includes(
            classifyProcessFailure(stdout, stderr)?.error.code || '',
          ),
      },
    );
    const diagnosticLimit = 512 * 1024;
    diagnostics = {
      stdout: res.stdout.slice(-diagnosticLimit),
      stderr: res.stderr,
      exit_code: res.code,
      timed_out: res.timedOut,
      timeout_seconds: config.timeout_seconds,
      output_truncated:
        res.stdout.length > diagnosticLimit || res.stderrTruncated,
    };
    if (res.timedOut) {
      const document = path.join(
        workspace,
        'output',
        input.taskType === 'digest' ? 'digest.md' : 'research.md',
      );
      if (
        fs.existsSync(document) &&
        !fs.lstatSync(document).isSymbolicLink() &&
        fs.statSync(document).size <= diagnosticLimit
      ) {
        diagnostics.partial_document = fs.readFileSync(document, 'utf8');
      }
    }
    fs.writeFileSync(path.join(workspace, 'events.log'), res.stdout);
    const knownFailure =
      res.code !== 0 || res.timedOut
        ? classifyProcessFailure(res.stdout, res.stderr)
        : undefined;
    if (knownFailure)
      return {
        ...knownFailure,
        provider: request.provider,
        model,
        durationMs: Date.now() - started,
        execution,
        diagnostics,
      };
    if (res.timedOut)
      return {
        status: 'timeout',
        provider: request.provider,
        model,
        durationMs: Date.now() - started,
        execution,
        diagnostics,
        error: {
          code: 'timeout',
          message: `AI 执行达到 ${config.timeout_seconds} 秒上限，CLI 尚未结束，已终止本次执行${diagnostics.partial_document ? '；已保留生成文件供核查' : ''}`,
        },
      };
    if (res.code !== 0)
      return {
        status: 'failed',
        provider: request.provider,
        model,
        durationMs: Date.now() - started,
        execution,
        diagnostics,
        error: {
          code: 'cli_failed',
          message: `AI CLI 执行失败（退出码 ${res.code}），请查看本次尝试的标准输出与错误日志`,
        },
      };
    let result: any;
    if (request.provider === 'codex_cli') {
      if (
        !fs.existsSync(resultFile) ||
        fs.lstatSync(resultFile).isSymbolicLink()
      )
        throw new Error('CLI 未生成有效结果文件');
      const text = fs.readFileSync(resultFile, 'utf8').trim();
      result = input.outputSchema ? JSON.parse(text) : text;
      for (const line of res.stdout.split('\n')) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'turn.completed' && event.usage) {
            usage ||= {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              cachedTokens: 0,
            };
            usage.promptTokens! += event.usage.input_tokens || 0;
            usage.completionTokens! += event.usage.output_tokens || 0;
            usage.cachedTokens! += event.usage.cached_input_tokens || 0;
            usage.totalTokens! +=
              (event.usage.input_tokens || 0) +
              (event.usage.output_tokens || 0);
          }
        } catch {
          /* Non-JSON CLI lines are retained in diagnostics. */
        }
      }
    } else {
      const envelope = parseGeminiOutput(res.stdout);
      const models = Object.entries(envelope.stats?.models || {}) as Array<
        [string, any]
      >;
      if (models.length)
        model = models.sort(
          (a, b) =>
            (b[1].tokens?.total || b[1].api?.totalRequests || 0) -
            (a[1].tokens?.total || a[1].api?.totalRequests || 0),
        )[0][0];
      if (models.some(([, metrics]) => metrics.tokens)) {
        usage = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cachedTokens: 0,
          reasoningTokens: 0,
        };
        for (const [, metrics] of models) {
          usage.promptTokens! += metrics.tokens?.prompt || 0;
          usage.completionTokens! += metrics.tokens?.candidates || 0;
          usage.totalTokens! += metrics.tokens?.total || 0;
          usage.cachedTokens! += metrics.tokens?.cached || 0;
          usage.reasoningTokens! += metrics.tokens?.thoughts || 0;
        }
      }
      if (envelope.error) throw new Error('Gemini CLI returned an error');
      const response = envelope.response ?? envelope.text ?? envelope;
      result =
        input.outputSchema && typeof response === 'string'
          ? JSON.parse(response.replace(/^```json\s*|\s*```$/g, ''))
          : response;
    }
    if (fs.lstatSync(path.join(workspace, 'output')).isSymbolicLink())
      throw new Error('Output directory cannot be a symlink');
    const document =
      input.taskType === 'research_report'
        ? path.join(workspace, 'output', 'research.md')
        : input.taskType === 'digest'
          ? path.join(workspace, 'output', 'digest.md')
          : null;
    if (
      !input.outputSchema &&
      document &&
      fs.existsSync(document) &&
      !fs.lstatSync(document).isSymbolicLink()
    )
      result = fs.readFileSync(document, 'utf8');
    if (!result) throw new Error('AI 返回空结果');
    return {
      status: 'success',
      result,
      provider: request.provider,
      model,
      durationMs: Date.now() - started,
      execution,
      diagnostics,
      usage,
      artifacts: collectArtifacts(path.join(workspace, 'output')),
    };
  } catch (error: any) {
    return {
      status: 'failed',
      provider: request.provider,
      model,
      durationMs: Date.now() - started,
      execution,
      diagnostics,
      error: { code: 'execution_failed', message: error.message },
    };
  } finally {
    fs.writeFileSync(path.join(workspace, '.openlore-completed'), '');
  }
}
