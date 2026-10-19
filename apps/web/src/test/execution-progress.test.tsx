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
