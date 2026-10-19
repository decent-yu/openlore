import { executionLogs, redactExecutionText } from './execution_logs.js';
import type { AIExecutionAttempt } from '@openlore/contracts';
import type { AIAdapter, AIResult, AITaskInput } from './adapter.js';
import { ExecutorConfigSchema, type ExecutorConfig } from '@openlore/contracts';
import { ExecutorAdapter } from './executor_adapter.js';
import { getDb } from '../persistence/sqlite/db.js';
import {
  aiProfilesTable,
  workspaceSettingsTable,
} from '../persistence/sqlite/schema.js';

export interface AIProfileExecutionTarget {
  id: string;
  name: string;
  provider: 'codex_cli' | 'gemini_cli';
  cliPath: string;
  model?: string;
  isPrimary: boolean;
  execution?: ExecutorConfig;
}

export class FallbackAIAdapter implements AIAdapter {
  constructor(
    public targets: Array<{
      target: AIProfileExecutionTarget;
      adapter: AIAdapter;
    }>,
  ) {}

  async execute(input: AITaskInput): Promise<AIResult> {
    const started = Date.now();
    const traceId = executionLogs.start(input);
    if (this.targets.length === 0) {
      const failure: AIResult = {
        status: 'failed',
        provider: 'none',
        model: 'none',
        durationMs: 0,
        trace_id: traceId,
        error: {
          code: 'no_ai_executors',
          message: '未配置任何本地 AI 执行器',
        },
      };
      executionLogs.finish(traceId, failure, Date.now() - started);
      return failure;
    }

    const attempts: AIExecutionAttempt[] = [];
    let lastError: any = null;

    for (let i = 0; i < this.targets.length; i++) {
      const { target, adapter } = this.targets[i];
      const isPrimary = target.isPrimary;
      const roleStr = isPrimary ? '主执行器' : `备用执行器 #${i}`;

      const attempt: AIExecutionAttempt = {
        index: i + 1,
        profile_id: target.id,
        executor_name: target.name,
        provider: target.provider,
        transport: target.execution?.transport || 'local',
        model: input.model || target.model || 'default',
        timeout_seconds: target.execution?.timeout_seconds || 900,
        queue_timeout_seconds: target.execution?.queue_timeout_seconds || 3600,
        started_at: new Date().toISOString(),
        status: 'running',
      };
      attempts.push(attempt);
      executionLogs.attempts(traceId, attempts);
      const attemptStarted = Date.now();
      try {
        const res = await adapter.execute(
          {
            ...input,
            profileId: target.id,
            model: input.model || target.model,
          },
          (progress) => {
            Object.assign(attempt, {
              progress_at: progress.updated_at,
              last_output_at: progress.last_output_at,
              execution: progress.execution,
              diagnostics: progress.diagnostics,
            });
            executionLogs.attempts(traceId, attempts);
          },
        );

        Object.assign(attempt, {
          status: res.status,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - attemptStarted,
          model: res.model,
          error: res.error,
          usage: res.usage,
          execution: res.execution,
          diagnostics: res.diagnostics,
          output:
            typeof res.result === 'string'
              ? res.result
              : JSON.stringify(res.result, null, 2),
        });
        executionLogs.attempts(traceId, attempts);
        if (res.status === 'success') {
          if (!isPrimary) {
            console.warn(
              `[AI Fallback] 备用执行器 "${target.name}" (${target.provider}) 成功接管并完成任务 (Job: ${input.jobId}, Type: ${input.taskType})`,
            );
          }
          executionLogs.finish(traceId, res, Date.now() - started);
          return { ...res, trace_id: traceId };
        }

        lastError = res.error || {
          code: res.status,
          message: `Status: ${res.status}`,
        };
        console.warn(
          redactExecutionText(
            `[AI Fallback] ${roleStr} "${target.name}" (${target.provider}) 执行异常 [${res.status}: ${lastError.message}]，准备切换后续执行器...`,
          ),
        );
      } catch (err: any) {
        lastError = err;
        Object.assign(attempt, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - attemptStarted,
          error: { code: 'executor_error', message: err.message },
        });
        executionLogs.attempts(traceId, attempts);
        console.warn(
          redactExecutionText(
            `[AI Fallback] ${roleStr} "${target.name}" (${target.provider}) 抛出异常 [${err.message}]，准备切换后续执行器...`,
          ),
        );
      }
    }

    const failure: AIResult = {
      status: 'failed',
      provider: this.targets[0].target.provider,
      model: this.targets[0].target.model || 'unknown',
      durationMs: Date.now() - started,
      trace_id: traceId,
      error: {
        code: 'all_executors_failed',
        message: `所有 AI 执行器均无法完成任务：${attempts.map((attempt) => `${attempt.executor_name} [${attempt.error?.code || attempt.status}] ${attempt.error?.message || '未知错误'}`).join('；')}`,
      },
    };
    executionLogs.finish(traceId, failure, Date.now() - started);
    return failure;
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (this.targets.length === 0) {
      return { ok: false, message: '未配置任何 AI 执行器' };
    }
    return this.targets[0].adapter.testConnection();
  }
}

export function getAIAdapterWithFallback(
  preferredProfileId?: string | null,
): AIAdapter | null {
  const db = getDb();
  const allProfiles = db.select().from(aiProfilesTable).all();

  if (allProfiles.length === 0) {
    return null;
  }

  // Get default / primary profile id from settings
  const settingRows = db.select().from(workspaceSettingsTable).all();
  const defaultProfileId = settingRows.find(
    (s) => s.key === 'default_ai_profile_id',
  )?.value;

  // Determine primary profile
  let primaryIndex = -1;
  if (preferredProfileId) {
    primaryIndex = allProfiles.findIndex((p) => p.id === preferredProfileId);
  }
  if (primaryIndex === -1 && defaultProfileId) {
    primaryIndex = allProfiles.findIndex((p) => p.id === defaultProfileId);
  }
  if (primaryIndex === -1) {
    primaryIndex = 0;
  }

  const primaryProfile = allProfiles[primaryIndex];
  const otherProfiles = allProfiles.filter((_, idx) => idx !== primaryIndex);

  const orderedTargets: AIProfileExecutionTarget[] = [
    {
      id: primaryProfile.id,
      name: primaryProfile.name,
      provider: primaryProfile.provider as any,
      cliPath: primaryProfile.cliPath,
      model: primaryProfile.model || undefined,
      isPrimary: true,
      execution: ExecutorConfigSchema.parse(
        JSON.parse(primaryProfile.executionJson || '{}'),
      ),
    },
    ...otherProfiles.map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider as any,
      cliPath: p.cliPath,
      model: p.model || undefined,
      isPrimary: false,
      execution: ExecutorConfigSchema.parse(
        JSON.parse(p.executionJson || '{}'),
      ),
    })),
  ];

  const targetsWithAdapters = orderedTargets.map((t) => {
    const adapter: AIAdapter = new ExecutorAdapter(
      t.id,
      t.provider,
      t.cliPath,
      t.execution!,
    );
    return { target: t, adapter };
  });

  return new FallbackAIAdapter(targetsWithAdapters);
}
