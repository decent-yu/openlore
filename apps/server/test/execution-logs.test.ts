import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { ExecutorConfigSchema, type ExecutionInput } from "@openlore/contracts";
import { initDatabase, getSqliteDatabase } from "../src/infrastructure/persistence/sqlite/db.js";
import { getAppPaths } from "../src/infrastructure/config/paths.js";
import { executionLogs } from "../src/infrastructure/ai/execution_logs.js";
import { FallbackAIAdapter } from "../src/infrastructure/ai/fallback_runner.js";
import { executeInWorkspace } from "../src/infrastructure/ai/workspace_runner.js";
import { secretsStore } from "../src/infrastructure/secrets/local_file/secrets_store.js";
import { createServer } from "../src/http/server.js";
import { groupsService } from '../src/modules/groups/service.js';

let app: Awaited<ReturnType<typeof createServer>>;
const input: ExecutionInput = {
  jobId: "test-call",
  runId: "test-run",
  groupId: "test-group",
  articleId: "article",
  articleTitle: "Example article",
  profileId: "primary",
  taskType: "research_report",
  prompt: "Complete instructions",
  material: "Complete article " + "full text ".repeat(1000),
};
beforeAll(async () => {
  initDatabase();
  app = await createServer();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => vi.restoreAllMocks());
const target = (id: string) => ({
  id,
  name: id,
  provider: "gemini_cli" as const,
  cliPath: "gemini",
  isPrimary: id === "primary",
  execution: ExecutorConfigSchema.parse({ timeout_seconds: 1800 }),
});

it("shows an in-flight call before the executor returns, then saves full input and output", async () => {
  let finish!: (value: any) => void;
  const adapter = new FallbackAIAdapter([
    {
      target: target("primary"),
      adapter: {
        execute: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        testConnection: async () => ({ ok: true, message: "test" }),
      },
    },
  ]);
  const pending = adapter.execute(input);
  const running = executionLogs.list({
    run_id: "test-run",
    page: 1,
    page_size: 20,
  });
  expect(running.items[0]).toMatchObject({
    status: "running",
    attempts: [{ status: "running", timeout_seconds: 1800 }],
  });
  const output = "Full generated article " + "paragraph ".repeat(1000);
  finish({
    status: "success",
    provider: "gemini_cli",
    model: "test-model",
    durationMs: 1234,
    result: output,
  });
  const result = await pending;
  const detail = (
    await app.inject(`/api/v1/execution-logs/${result.trace_id}`)
  ).json();
  expect(detail.input.material).toBe(input.material);
  expect(detail.output).toBe(output);
  expect(detail.attempts[0]).toMatchObject({
    model: "test-model",
    status: "success",
    timeout_seconds: 1800,
  });
  expect(detail.finished_at).toBeTruthy();
  const list = (
    await app.inject("/api/v1/execution-logs?run_id=test-run")
  ).json();
  expect(list.items[0].input).toBeUndefined();
  expect(list.items[0].attempts[0].output).toBeUndefined();
});

it("keeps a timed-out primary attempt, partial document and the successful fallback separately", async () => {
  const adapter = new FallbackAIAdapter([
    {
      target: target("primary"),
      adapter: {
        execute: async () => ({
          status: "timeout",
          provider: "gemini_cli",
          model: "primary-model",
          durationMs: 1800000,
          error: { code: "timeout", message: "Reached 1800 seconds" },
          diagnostics: {
            stdout: "",
            stderr: "process still running",
            exit_code: null,
            timed_out: true,
            timeout_seconds: 1800,
            output_truncated: false,
            partial_document: "Unconfirmed draft",
          },
        }),
        testConnection: async () => ({ ok: true, message: "test" }),
      },
    },
    {
      target: target("backup"),
      adapter: {
        execute: async () => ({
          status: "success",
          provider: "codex_cli",
          model: "backup-model",
          durationMs: 2,
          result: "Complete article",
        }),
        testConnection: async () => ({ ok: true, message: "test" }),
      },
    },
  ]);
  const result = await adapter.execute({ ...input, jobId: "fallback-call" });
  const log = executionLogs.get(result.trace_id!)!;
  expect(log.status).toBe("success");
  expect(log.output).toBe("Complete article");
  expect(log.attempts).toHaveLength(2);
  expect(log.attempts[0]).toMatchObject({
    status: "timeout",
    error: { code: "timeout" },
    diagnostics: { partial_document: "Unconfirmed draft" },
  });
  expect(log.attempts[1]).toMatchObject({
    status: "success",
    executor_name: "backup",
  });
});

it("records thrown errors and redacts credentials in inputs, diagnostics and outputs", async () => {
  secretsStore.setSecret("qa-secret", "private-test-token-123456");
  const adapter = new FallbackAIAdapter([
    {
      target: target("primary"),
      adapter: {
        execute: async () => {
          throw new Error("Bearer secret-value private-test-token-123456");
        },
        testConnection: async () => ({ ok: true, message: "test" }),
      },
    },
  ]);
  const result = await adapter.execute({
    ...input,
    jobId: "failed-call",
    prompt: "api_key=abcd private-test-token-123456",
  });
  const log = executionLogs.get(result.trace_id!)!;
  expect(log.status).toBe("failed");
  expect(log.attempts[0].finished_at).toBeTruthy();
  expect(JSON.stringify(log)).not.toContain("private-test-token-123456");
  expect(JSON.stringify(log)).not.toContain("secret-value");
  expect(log.input.prompt).toContain("[REDACTED]");
  const filtered = (
    await app.inject("/api/v1/execution-logs?status=problem&search=failed-call")
  ).json();
  expect(filtered.total).toBe(1);
  expect((await app.inject("/api/v1/execution-logs?page=1.5")).statusCode).toBe(
    400,
  );
  expect((await app.inject("/api/v1/execution-logs/missing")).statusCode).toBe(
    404,
  );
});

it("honors the configured CLI time limit and retains a partial document for diagnosis", async () => {
  const paths = getAppPaths(),
    cli = path.join(paths.dataDir, "slow-cli");
  fs.writeFileSync(
    cli,
    `#!${process.execPath}\nconst fs=require('fs');fs.writeFileSync('output/research.md','Partial result before timeout');process.stderr.write('waiting for model');setInterval(()=>{},1000);`,
    { mode: 0o700 },
  );
  const result = await executeInWorkspace({
    provider: "gemini_cli",
    cli_path: cli,
    config: ExecutorConfigSchema.parse({
      workspace_root: path.join(paths.dataDir, "work"),
      timeout_seconds: 10,
    }),
    input: { ...input, skillId: undefined },
  });
  expect(result.status).toBe("timeout");
  expect(result.durationMs).toBeGreaterThanOrEqual(10000);
  expect(result.error?.message).toContain("10 秒上限");
  expect(result.diagnostics).toMatchObject({
    timeout_seconds: 10,
    timed_out: true,
    stderr: "waiting for model",
    partial_document: "Partial result before timeout",
  });
  expect(result.execution?.workspace).toBeTruthy();
}, 20000);
it("records missing executor configuration and actual CLI token usage", async () => {
  const missing = await new FallbackAIAdapter([]).execute({
    ...input,
    jobId: "missing-executor",
  });
  expect(executionLogs.get(missing.trace_id!)?.error_message).toContain(
    "未配置",
  );
  const paths = getAppPaths(),
    cli = path.join(paths.dataDir, "usage-cli");
  fs.writeFileSync(
    cli,
    `#!${process.execPath}\nconsole.log(JSON.stringify({response:'Complete output',stats:{models:{'real-model':{tokens:{prompt:100,candidates:20,total:135,cached:50,thoughts:15}}}}}));`,
    { mode: 0o700 },
  );
  const result = await executeInWorkspace({
    provider: "gemini_cli",
    cli_path: cli,
    config: ExecutorConfigSchema.parse({
      workspace_root: path.join(paths.dataDir, "usage-work"),
    }),
    input: { ...input, taskType: "assess" },
  });
  expect(result.status).toBe("success");
  expect(result.model).toBe("real-model");
  expect(result.usage).toEqual({
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 135,
    cachedTokens: 50,
    reasoningTokens: 15,
  });
  expect(result.diagnostics?.timeout_seconds).toBe(900);
});

it('keeps every call within its exact run, including retries, without leaking independent or other-run calls',async()=>{
  await groupsService.saveGroup({id:'scope-group',name:'Scope pipeline',repository_connection_id:'repo',base_path:'docs/scope'});
  const created:string[]=[];
  for(const [runId,jobId] of [['scope-run','review'],['scope-run','review-retry'],['other-run','review'],[undefined,'standalone']] as const) {
    const id=executionLogs.start({...input,groupId:'scope-group',runId,jobId});
    executionLogs.finish(id,{status:'success',provider:'test',model:'test',durationMs:1,result:jobId},1);
    created.push(id);
  }
  const page=(await app.inject('/api/v1/execution-logs?run_id=scope-run&page_size=1')).json();
  expect(page.total).toBe(2);expect(page.items).toHaveLength(1);
  const next=(await app.inject('/api/v1/execution-logs?run_id=scope-run&page_size=1&page=2')).json();
  expect(new Set([page.items[0].id,next.items[0].id])).toEqual(new Set(created.slice(0,2)));
  expect(page.items[0].group_name).toBe('Scope pipeline');
  const detail=(await app.inject(`/api/v1/execution-logs/${created[0]}`)).json();
  expect(detail.run_id).toBe('scope-run');expect(detail.group_name).toBe('Scope pipeline');
});

it('separates report plans from pipeline ownership and selects the exact digest call for a push',async()=>{
  const now=new Date().toISOString();
  getSqliteDatabase().prepare('INSERT INTO report_plans(id,name,configuration_json,created_at,updated_at) VALUES (?,?,?,?,?)').run('scope-report','Scope report','{}',now,now);
  const first=executionLogs.start({...input,runId:undefined,groupId:undefined,reportPlanId:'scope-report',jobId:'digest-batch',taskType:'digest'});
  const second=executionLogs.start({...input,runId:undefined,groupId:undefined,reportPlanId:'scope-report',jobId:'digest-batch',taskType:'digest'});
  const batch=(await app.inject('/api/v1/execution-logs?job_id=digest-batch')).json();
  expect(batch.total).toBe(2);expect(batch.items[0].group_id).toBeUndefined();
  expect(batch.items[0].report_plan_id).toBe('scope-report');expect(batch.items[0].report_plan_name).toBe('Scope report');
  const exact=(await app.inject(`/api/v1/execution-logs?log_id=${second}`)).json();
  expect(exact.total).toBe(1);expect(exact.items[0].id).toBe(second);
  expect(exact.items[0].id).not.toBe(first);
});
