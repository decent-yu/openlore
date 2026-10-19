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
