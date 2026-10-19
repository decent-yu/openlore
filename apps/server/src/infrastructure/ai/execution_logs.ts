import crypto from "node:crypto";
import fs from "node:fs";
import type {
  AIExecutionLogDetail,
  AIExecutionLog,
  AIExecutionAttempt,
  AIExecutionLogPage,
  ExecutionInput,
  ExecutionResult,
} from "@openlore/contracts";
import { getSqliteDatabase } from "../persistence/sqlite/db.js";
import { getAppPaths } from "../config/paths.js";

export function redactExecutionText(text: string): string {
  let result = text
    .replace(/\b(Bearer\s+)[\w.~-]+/gi, "$1[REDACTED]")
    .replace(
      /\b(?:gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|sk-[a-zA-Z0-9_-]{20,})\b/g,
      "[REDACTED]",
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|authorization)["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi,
      "$1[REDACTED]",
    );
  try {
    const secrets = JSON.parse(
      fs.readFileSync(getAppPaths().secretsPath, "utf8"),
    ) as Record<string, string>;
    for (const value of Object.values(secrets)) {
      if (typeof value === "string" && value.length >= 8)
        result = result.split(value).join("[REDACTED]");
    }
  } catch {
    /* A new workspace may have no credentials. */
  }
  return result;
}
function serialize(value: unknown): string {
  return redactExecutionText(
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? ""),
  );
}
type Row = {
  id: string;
  job_id: string;
  run_id: string | null;
  group_id: string | null;
  group_name: string | null;
  report_plan_id: string | null;
  report_plan_name: string | null;
  article_id: string | null;
  article_title: string | null;
  task_type: string;
  skill_id: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string;
  error_message: string | null;
  input_json: string;
  output: string;
  attempts_json: string;
};
function map(row: Row): AIExecutionLogDetail {
  const { input_json, attempts_json, ...fields } = row;
  return {
    ...fields,
    run_id: row.run_id || undefined,
    group_id: row.group_id || undefined,
    group_name: row.group_name || undefined,
    report_plan_id: row.report_plan_id || undefined,
    report_plan_name: row.report_plan_name || undefined,
    article_id: row.article_id || undefined,
    article_title: row.article_title || undefined,
    skill_id: row.skill_id || undefined,
    finished_at: row.finished_at || undefined,
    duration_ms: row.duration_ms ?? undefined,
    error_message: row.error_message || undefined,
    input: JSON.parse(row.input_json),
    attempts: JSON.parse(row.attempts_json),
  };
}
export const executionLogs = {
  start(input: ExecutionInput): string {
    const id = `ai_log_${crypto.randomUUID()}`;
    getSqliteDatabase()
      .prepare(
        `INSERT INTO ai_execution_logs
      (id,job_id,run_id,group_id,report_plan_id,article_id,article_title,task_type,skill_id,started_at,status,input_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,'running',?)`,
      )
      .run(
        id,
        input.jobId,
        input.runId || null,
        input.groupId || null,
        input.reportPlanId || null,
        input.articleId || null,
        input.articleTitle ? redactExecutionText(input.articleTitle) : null,
        input.taskType,
        input.skillId || null,
        new Date().toISOString(),
        serialize({
          prompt: input.prompt,
          material: input.material,
          outputSchema: input.outputSchema,
          skillRevision: input.skillRevision,
        }),
      );
    return id;
  },
  attempts(id: string, attempts: AIExecutionAttempt[]) {
    getSqliteDatabase()
      .prepare("UPDATE ai_execution_logs SET attempts_json=? WHERE id=?")
      .run(serialize(attempts), id);
  },
  finish(id: string, result: ExecutionResult, duration: number) {
    getSqliteDatabase()
      .prepare(
        "UPDATE ai_execution_logs SET status=?,finished_at=?,duration_ms=?,output=?,error_message=? WHERE id=?",
      )
      .run(
        result.status,
        new Date().toISOString(),
        duration,
        serialize(result.result),
        result.error ? redactExecutionText(result.error.message) : null,
        id,
      );
  },
  invalidate(id: string | undefined, reason: string) {
    if (id)
      getSqliteDatabase()
        .prepare(
          "UPDATE ai_execution_logs SET status='invalid_output',error_message=? WHERE id=?",
        )
        .run(redactExecutionText(reason), id);
  },
  get(id: string): AIExecutionLogDetail | null {
    const row = getSqliteDatabase()
      .prepare(
        `SELECT l.*,g.name group_name,p.name report_plan_name FROM ai_execution_logs l
        LEFT JOIN groups g ON g.id=l.group_id LEFT JOIN report_plans p ON p.id=l.report_plan_id WHERE l.id=?`,
      )
      .get(id) as Row | undefined;
    return row ? map(row) : null;
  },
  list(filters: {
    run_id?: string;
    job_id?: string;
    log_id?: string;
    status?: string;
    task_type?: string;
    search?: string;
    page: number;
    page_size: number;
  }): AIExecutionLogPage {
    const clauses: string[] = [],
      params: unknown[] = [];
    for (const key of ["run_id", "task_type", "job_id"] as const)
      if (filters[key]) {
        clauses.push(`l.${key}=?`);
        params.push(filters[key]);
      }
    if (filters.log_id) {
      clauses.push("l.id=?");
      params.push(filters.log_id);
    }
    if (filters.status === "problem")
      clauses.push("status NOT IN ('success','running')");
    else if (filters.status) {
      clauses.push("status=?");
      params.push(filters.status);
    }
    if (filters.search) {
      clauses.push(
        "(article_title LIKE ? OR job_id LIKE ? OR skill_id LIKE ?)",
      );
      params.push(...Array(3).fill(`%${filters.search}%`));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const db = getSqliteDatabase();
    const total = (
      db
        .prepare(`SELECT count(*) n FROM ai_execution_logs l ${where}`)
        .get(...params) as { n: number }
    ).n;
    const rows = db
      .prepare(
        `SELECT l.*,g.name group_name,p.name report_plan_name FROM ai_execution_logs l
          LEFT JOIN groups g ON g.id=l.group_id LEFT JOIN report_plans p ON p.id=l.report_plan_id
          ${where} ORDER BY l.started_at DESC,l.id DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...params,
        filters.page_size,
        (filters.page - 1) * filters.page_size,
      ) as Row[];
    const items: AIExecutionLog[] = rows.map((row) => {
      const { input, output, ...summary } = map(row);
      return {
        ...summary,
        attempts: summary.attempts.map(
          ({ diagnostics, execution, output, ...attempt }) => ({
            ...attempt,
            execution: execution
              ? {
                  ...execution,
                  prompt: "",
                  skill_instructions: undefined,
                  skill_files: undefined,
                }
              : undefined,
          }),
        ),
      };
    });
    return { items, total, page: filters.page, page_size: filters.page_size };
  },
};
