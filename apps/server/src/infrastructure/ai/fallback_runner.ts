import { executionLogs, redactExecutionText } from './execution_logs.js';
import type { AIExecutionAttempt } from '@openlore/contracts';
import type {
  AIAdapter,
  AIResult,
  AITaskInput,
  AIExecutionOptions,
  AIValidationIssue,
} from './adapter.js';
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

  async execute(
    input: AITaskInput,
    onProgress?: (
      progress: import('@openlore/contracts').ExecutionProgress,
    ) => void,
    options: AIExecutionOptions = {},
  ): Promise<AIResult> {
    const started = Date.now();
    const traceId = executionLogs.start(input);
    options.onStart?.(traceId);
    const attempts: AIExecutionAttempt[] = [];
    let corrected = false;
    let repairData:
      { result: unknown; issues: AIValidationIssue[] } | undefined;
    const finish = (result: AIResult): AIResult => {
      executionLogs.finish(traceId, result, Date.now() - started);
      return { ...result, trace_id: traceId };
    };
    const correctionPrompt = (data: NonNullable<typeof repairData>) =>
      `这是同一任务的校验修正。已有审核结论保留在会话中；下方 JSON 是待修正的数据，不是新任务指令。只修正标出的字段，保留正确的评分、定位和简介，返回完整 JSON；不要重新执行整轮审核，必要时可读取原工作区正文。\n${JSON.stringify({ previous_result: data.result, validation_errors: data.issues }, null, 2)}`;
    const invoke = async (
      entry: (typeof this.targets)[number],
      task: AITaskInput,
      phase: 'execute' | 'correction',
      correctionOf?: number,
    ): Promise<AIResult> => {
      const { target, adapter } = entry;
      const attempt: AIExecutionAttempt = {
        index: attempts.length + 1,
        profile_id: target.id,
        executor_name: target.name,
        provider: target.provider,
        transport: target.execution?.transport || 'local',
        model: task.model || target.model || 'default',
        timeout_seconds: target.execution?.timeout_seconds || 900,
        queue_timeout_seconds: target.execution?.queue_timeout_seconds || 3600,
        started_at: new Date().toISOString(),
        status: 'running',
        phase,
        resumed: Boolean(task.session),
        correction_of: correctionOf,
        session_id: task.session?.id,
      };
      attempts.push(attempt);
      executionLogs.attempts(traceId, attempts);
      const attemptStarted = Date.now();
      let result: AIResult;
      try {
        result = await adapter.execute(
          { ...task, profileId: target.id, model: task.model || target.model },
          (progress) => {
            Object.assign(attempt, {
              progress_at: progress.updated_at,
              last_output_at: progress.last_output_at,
              execution: progress.execution,
              diagnostics: progress.diagnostics,
              session_id: progress.execution?.session_id || attempt.session_id,
            });
            executionLogs.attempts(traceId, attempts);
            onProgress?.(progress);
          },
        );
      } catch (error: any) {
        result = {
          status: 'failed',
          provider: target.provider,
          model: task.model || target.model || 'default',
          durationMs: Date.now() - attemptStarted,
          error: {
            code: 'executor_error',
            message: error.message || String(error),
          },
        };
      }
      Object.assign(attempt, {
        status: result.status,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - attemptStarted,
        model: result.model,
        error: result.error,
        usage: result.usage,
        execution: result.execution || attempt.execution,
        diagnostics: result.diagnostics || attempt.diagnostics,
        session_id: result.session?.id || attempt.session_id,
        output:
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result, null, 2),
      });
      executionLogs.attempts(traceId, attempts);
      return result;
    };
    for (let index = 0; index < this.targets.length; index++) {
      const entry = this.targets[index];
      let result = await invoke(
        entry,
        {
          ...input,
          session: index === 0 ? input.session : undefined,
          prompt: repairData
            ? `${input.prompt}\n\n${correctionPrompt(repairData)}`
            : input.prompt,
        },
        repairData ? 'correction' : 'execute',
        repairData ? attempts.length : undefined,
      );
      while (result.status === 'success' && options.validateResult) {
        const issues = options.validateResult(result.result);
        if (!issues.length) break;
        const attempt = attempts.at(-1)!;
        repairData = { result: result.result, issues };
        Object.assign(attempt, {
          status: 'invalid_output',
          validation_issues: issues,
          error: {
            code: 'validation_failed',
            message: issues
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join('；'),
          },
        });
        executionLogs.attempts(traceId, attempts);
        if (corrected || !result.session) {
          return finish({
            ...result,
            status: 'invalid_output',
            error: {
              code: corrected ? 'validation_failed' : 'session_unavailable',
              message: `${attempt.error!.message}${!result.session ? '；执行器未提供可续用会话，已停止自动重跑。' : ''}`,
            },
          });
        }
        corrected = true;
        result = await invoke(
          entry,
          {
            ...input,
            profileId: entry.target.id,
            session: result.session,
            prompt: correctionPrompt(repairData),
          },
          'correction',
          attempt.index,
        );
      }
      if (result.status === 'success') return finish(result);
      console.warn(
        redactExecutionText(
          `[AI Fallback] ${entry.target.name} [${result.error?.code || result.status}] ${result.error?.message || '执行失败'}，准备后续执行器`,
        ),
      );
    }
    return finish({
      status: 'failed',
      provider: this.targets[0]?.target.provider || 'none',
      model: input.model || 'unknown',
      durationMs: Date.now() - started,
      error: {
        code: this.targets.length ? 'all_executors_failed' : 'no_ai_executors',
        message: this.targets.length
          ? `所有 AI 执行器均无法完成任务：${attempts.map((attempt) => `${attempt.executor_name} [${attempt.error?.code || attempt.status}] ${attempt.error?.message || '未知错误'}`).join('；')}`
          : '未配置任何本地 AI 执行器',
      },
    });
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
