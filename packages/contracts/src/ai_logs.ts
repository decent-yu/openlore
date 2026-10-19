import type { ExecutionInput, ExecutionResult } from "./execution.js";

export interface AIExecutionAttempt {
  index: number;
  profile_id: string;
  executor_name: string;
  provider: string;
  transport: string;
  model: string;
  timeout_seconds: number;
  queue_timeout_seconds: number;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  status: string;
  phase?: "execute" | "correction";
  correction_of?: number;
  validation_issues?: Array<{ path: string; code: string; message: string }>;
  session_id?: string;
  resumed?: boolean;
  progress_state?: "queued" | "running";
  queue_duration_ms?: number;
  progress_at?: string;
  last_output_at?: string;
  error?: ExecutionResult["error"];
  usage?: ExecutionResult["usage"];
  execution?: ExecutionResult["execution"];
  diagnostics?: ExecutionResult["diagnostics"];
  output?: string;
}
export interface AIExecutionLog {
  id: string;
  job_id: string;
  run_id?: string;
  group_id?: string;
  group_name?: string;
  report_plan_id?: string;
  report_plan_name?: string;
  article_id?: string;
  article_title?: string;
  task_type: string;
  skill_id?: string;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  status: string;
  error_message?: string;
  attempts: AIExecutionAttempt[];
  usage_summary?: {
    recorded_attempts: number;
    total_attempts: number;
    usage: NonNullable<ExecutionResult["usage"]>;
  };
}
export function summarizeExecutionUsage(
  attempts: AIExecutionAttempt[],
): NonNullable<AIExecutionLog["usage_summary"]> {
  const recorded = attempts.filter((attempt) => attempt.usage);
  const usage: NonNullable<ExecutionResult["usage"]> = {};
  for (const key of [
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "cachedTokens",
    "reasoningTokens",
  ] as const) {
    const values = recorded.flatMap((attempt) =>
      typeof attempt.usage?.[key] === "number" ? [attempt.usage[key]!] : [],
    );
    if (values.length)
      usage[key] = values.reduce((sum, value) => sum + value, 0);
  }
  return {
    recorded_attempts: recorded.length,
    total_attempts: attempts.length,
    usage,
  };
}
export interface AIExecutionLogDetail extends AIExecutionLog {
  input: Pick<
    ExecutionInput,
    "prompt" | "material" | "outputSchema" | "skillRevision"
  >;
  output: string;
}
export interface AIExecutionLogPage {
  items: AIExecutionLog[];
  total: number;
  page: number;
  page_size: number;
}
