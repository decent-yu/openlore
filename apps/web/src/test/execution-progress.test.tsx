import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { ExecutionLogDetail } from "../features/runs/ExecutionLogDetail.js";

it("opens running calls on live diagnostics and exposes the last output time before a result exists", () => {
  const client = new QueryClient();
  client.setQueryData(["executionLog", "live"], {
    id: "live",
    job_id: "review",
    task_type: "assess",
    status: "running",
    started_at: "2026-10-19T08:40:19Z",
    input: { prompt: "Read the file", material: "Article" },
    output: "",
    attempts: [
      {
        index: 1,
        executor_name: "Local Gemini",
        provider: "gemini_cli",
        model: "default",
        transport: "local",
        timeout_seconds: 900,
        queue_timeout_seconds: 3600,
        started_at: "2026-10-19T08:40:19Z",
        status: "running",
        last_output_at: "2026-10-19T08:41:19Z",
        diagnostics: {
          stdout: "read_file input/article.md",
          stderr: "Policy enforcement failed: 429 RESOURCE_EXHAUSTED",
          exit_code: null,
          timed_out: false,
          timeout_seconds: 900,
        },
      },
    ],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ExecutionLogDetail id="live" onClose={() => {}} />
    </QueryClientProvider>,
  );
  expect(html).toContain("执行与实时日志");
  expect(html).toContain("最近进程输出");
  expect(html).toContain("read_file input/article.md");
  expect(html).toContain("Policy enforcement failed: 429 RESOURCE_EXHAUSTED");
  expect(html).toContain("运行中自动刷新");
  expect(html).toContain("900 秒");
  client.clear();
});

it("groups evidence correction under the same task and distinguishes it from executor failover", () => {
  const client = new QueryClient();
  client.setQueryData(["executionLog", "repair"], {
    id: "repair",
    job_id: "review",
    task_type: "assess",
    status: "success",
    started_at: "2026-10-19T08:00:00Z",
    finished_at: "2026-10-19T08:00:02Z",
    duration_ms: 2000,
    input: { prompt: "Review", material: "Article" },
    output: "{}",
    usage_summary: {
      recorded_attempts: 2,
      total_attempts: 2,
      usage: { totalTokens: 50 },
    },
    attempts: [
      {
        index: 1,
        profile_id: "same",
        executor_name: "Local Codex",
        provider: "codex_cli",
        transport: "local",
        model: "gpt-6.1-sol",
        reasoning_effort: "high",
        timeout_seconds: 900,
        queue_timeout_seconds: 3600,
        started_at: "2026-10-19T08:00:00Z",
        status: "invalid_output",
        phase: "execute",
        validation_issues: [
          {
            path: "evidence_refs[0]",
            code: "invalid",
            message: "引用来自标题",
          },
        ],
      },
      {
        index: 2,
        profile_id: "same",
        executor_name: "Local Codex",
        provider: "codex_cli",
        transport: "local",
        model: "gpt-6.1-sol",
        reasoning_effort: "high",
        timeout_seconds: 900,
        queue_timeout_seconds: 3600,
        started_at: "2026-10-19T08:00:01Z",
        status: "success",
        phase: "correction",
        resumed: true,
        session_id: "precise-session-id",
      },
    ],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ExecutionLogDetail id="repair" onClose={() => {}} />
    </QueryClientProvider>,
  );
  expect(html).toContain("原会话校验修正");
  expect(html).toContain("codex_cli / GPT-6.1-Sol · high");
  expect(html).toContain("evidence_refs[0]");
  expect(html).toContain("引用来自标题");
  expect(html).toContain("累计 Token 50");
  expect(html).toContain("precise-session-id");
  expect(html).not.toContain("（备用接管）");
  client.clear();
});
