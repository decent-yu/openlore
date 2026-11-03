import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Workflow, Send, Bot } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { useDialog } from "../../lib/useDialog.js";
import { ExecutionLogs } from "./ExecutionLogs.js";
import { ExecutionLogDetail } from "./ExecutionLogDetail.js";
import { PipelineRunCard } from "./PipelineRunCard.js";

type LogTab = "pipelines" | "pushes" | "ai";
export function RunsPage() {
  const client = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const requested = search.get("tab");
  const tab: LogTab =
    requested === "pushes" || requested === "ai" ? requested : "pipelines";
  const runId = search.get("run") || "";
  const groupId = search.get("group") || "";
  const planId = search.get("plan") || "";
  const callId = search.get("call") || "";
  const [fullReport, setFullReport] = useState<{
    title: string;
    markdown: string;
  } | null>(null);
  const [detailError, setDetailError] = useState("");
  const {
    data: runs = [],
    error: runsError,
    isLoading: runsLoading,
  } = useQuery({
    queryKey: ["runs", groupId],
    queryFn: () => api.listRuns(groupId || undefined),
    refetchInterval: 10000,
    enabled: tab === "pipelines",
  });
  const {
    data: pushes = [],
    error: pushError,
    isLoading: pushLoading,
  } = useQuery({
    queryKey: ["pushDeliveries"],
    queryFn: api.listPushDeliveries,
    refetchInterval: 15000,
    enabled: tab === "pushes",
  });
  useEffect(() => {
    const events = new EventSource("/api/v1/events");
    events.onmessage = () => {
      client.invalidateQueries({ queryKey: ["runs"] });
      client.invalidateQueries({ queryKey: ["pushDeliveries"] });
      client.invalidateQueries({ queryKey: ["executionLogs"] });
    };
    return () => events.close();
  }, [client]);
  useDialog(Boolean(fullReport), () => setFullReport(null));
  const navigate = (
    next: LogTab,
    scope?: { run?: string; plan?: string; group?: string },
  ) => {
    const params = new URLSearchParams();
    if (next !== "pipelines") params.set("tab", next);
    if (scope?.run) params.set("run", scope.run);
    if (scope?.plan) params.set("plan", scope.plan);
    if (scope?.group) params.set("group", scope.group);
    setDetailError("");
    setSearch(params);
  };
  const openLog = (id: string) => {
    const params = new URLSearchParams(search);
    params.set("call", id);
    setSearch(params);
  };
  const closeLog = () => {
    const params = new URLSearchParams(search);
    params.delete("call");
    setSearch(params, { replace: true });
  };
  const { data: groups = [] } = useQuery({
    queryKey: ["groups"],
    queryFn: api.listGroups,
    enabled: tab !== "ai",
  });
  const shownRuns = runId ? runs.filter((run) => run.id === runId) : runs;
  const shownPushes = planId
    ? pushes.filter((push) => (push.report_plan_id || push.group_id) === planId)
    : pushes;
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold">运行记录</h2>
        <p className="mt-1 text-sm text-neutral-500">
          沿着任务执行、归档和汇报推送查看结果，展开每次运行即可追踪 AI
          输入、输出与主备尝试。
        </p>
      </header>
      <Tabs.Root
        value={tab}
        onValueChange={(value) => navigate(value as LogTab)}
      >
        <Tabs.List
          aria-label="运行记录分类"
          className="mb-6 flex gap-1 overflow-x-auto border-b border-neutral-200"
        >
          {(
            [
              ["pipelines", "流水线任务", Workflow],
              ["pushes", "推送日志", Send],
              ["ai", "AI 调用日志", Bot],
            ] as const
          ).map(([value, label, Icon]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-neutral-500 outline-offset-[-3px] data-[state=active]:border-blue-600 data-[state=active]:text-blue-700"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="pipelines" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">流水线运行</h3>
              <p className="mt-1 text-xs text-neutral-500">
                每张卡片是一次完整运行：选文 → 调研 → GitHub
                归档。点击“本次运行的全部 AI 调用”直接查看。
              </p>
            </div>
            <Link to="/pipelines" className="text-sm text-blue-700">
              管理任务 →
            </Link>
          </div>
          {!runId && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
              流水线任务
              <select
                aria-label="筛选流水线任务"
                className="rounded-md border bg-white px-3 py-2 text-sm"
                value={groupId}
                onChange={(event) =>
                  navigate("pipelines", { group: event.target.value })
                }
              >
                <option value="">全部任务</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {runId && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
              <span className="break-all">当前运行：{runId}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("pipelines")}
              >
                查看全部运行
              </Button>
            </div>
          )}
          {runsError && (
            <p role="alert" className="text-sm text-red-700">
              {runsError.message}
            </p>
          )}
          {runsLoading && (
            <p
              role="status"
              className="p-10 text-center text-sm text-neutral-500"
            >
              正在加载流水线运行…
            </p>
          )}
          {!runsLoading && !runsError && shownRuns.length === 0 && (
            <p className="rounded-xl border border-dashed p-10 text-center text-sm text-neutral-500">
              {runId
                ? "没有找到这次运行，可能已清理。"
                : "暂无流水线运行记录。"}
            </p>
          )}
          {shownRuns.map((run) => (
            <PipelineRunCard
              key={`${run.id}:${runId}`}
              run={run}
              initiallyOpen={runId === run.id}
              onOpenLog={openLog}
              onReport={setFullReport}
              onError={setDetailError}
            />
          ))}
        </Tabs.Content>
        <Tabs.Content value="pushes" className="space-y-4">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <h3 className="font-semibold">汇报推送记录</h3>
              <p className="mt-1 text-xs text-neutral-500">
                查看发送结果、汇报正文与平台回执；使用 AI
                生成简报时，可在记录内打开对应调用。
              </p>
            </div>
            <Link to="/reports" className="text-sm text-blue-700">
              配置汇报 →
            </Link>
          </div>
          {planId && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
              <span className="break-all">当前汇报方案：{planId}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("pushes")}
              >
                查看全部推送
              </Button>
            </div>
          )}
          {pushError && (
            <p role="alert" className="text-sm text-red-700">
              {pushError.message}
            </p>
          )}
          {pushLoading && (
            <p
              role="status"
              className="p-10 text-center text-sm text-neutral-500"
            >
              正在加载推送记录…
            </p>
          )}
          {!pushLoading && !pushError && shownPushes.length === 0 && (
            <p className="rounded-xl border border-dashed p-10 text-center text-sm text-neutral-500">
              {planId ? "此方案暂无推送记录。" : "暂无推送记录。"}
            </p>
          )}
          {shownPushes.map((push) => (
            <details
              key={push.id}
              open={planId ? true : undefined}
              className="rounded-xl border bg-white p-4"
            >
              <summary className="cursor-pointer break-words text-sm leading-relaxed">
                {new Date(push.created_at).toLocaleString()} · {push.headline} ·{" "}
                {push.webhook_name} ·{" "}
                {(
                  {
                    sent: "已发送",
                    failed: "发送失败",
                    pending: "等待发送",
                  } as Record<string, string>
                )[push.status] || push.status}{" "}
                · {push.total_count} 篇
                {push.trigger && ` · ${push.trigger === "manual" ? "手动推送" : "定时推送"}`}
                {push.partial && " · 包含未完成任务"}
              </summary>
              {push.error_message && (
                <p role="alert" className="mt-3 text-sm text-red-700">
                  {push.error_message}
                </p>
              )}
              <p className="mt-3 break-all text-[11px] text-neutral-400">
                推送 ID：{push.id} · 批次：{push.batch_id}
              </p>
              {push.pipeline_ids?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {push.pipeline_ids.map((id) => (
                    <button
                      type="button"
                      key={id}
                      onClick={() => navigate("pipelines", { group: id })}
                      className="rounded border px-2 py-1 text-xs text-blue-700"
                    >
                      关联任务：
                      {groups.find((group) => group.id === id)?.name || id} →
                    </button>
                  ))}
                </div>
              )}
              <details open className="mt-4">
                <summary className="text-sm font-medium">汇报正文</summary>
                <div className="prose prose-sm mt-3 max-w-none rounded-lg bg-neutral-50 p-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {push.summary}
                  </ReactMarkdown>
                </div>
              </details>
              {push.platform_response && (
                <details className="mt-4 rounded border p-3">
                  <summary className="cursor-pointer text-xs text-neutral-600">
                    查看通知平台回执
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                    {push.platform_response}
                  </pre>
                </details>
              )}
              <PushCalls
                logId={push.ai_log_id}
                jobId={push.batch_id}
                onOpen={openLog}
              />
            </details>
          ))}
        </Tabs.Content>
        <Tabs.Content value="ai">
          <ExecutionLogs
            onOpen={openLog}
            onViewRun={(id) => navigate("pipelines", { run: id })}
            onViewPush={(id) => navigate("pushes", { plan: id })}
          />
        </Tabs.Content>
      </Tabs.Root>
      {detailError && (
        <p role="alert" className="text-sm text-red-700">
          {detailError}
        </p>
      )}
      {callId && (
        <ExecutionLogDetail
          key={callId}
          id={callId}
          onClose={closeLog}
          onViewRun={(id) => navigate("pipelines", { run: id })}
          onViewPush={(id) => navigate("pushes", { plan: id })}
        />
      )}
      {fullReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="full-report-title"
        >
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b p-5">
              <h3 id="full-report-title" className="text-sm font-semibold">
                {fullReport.title}
              </h3>
              <button
                type="button"
                className="shrink-0 text-sm text-neutral-500"
                onClick={() => setFullReport(null)}
              >
                关闭文章
              </button>
            </div>
            <div className="prose prose-sm max-w-none overflow-y-auto p-6">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {fullReport.markdown}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function PushCalls({
  logId,
  jobId,
  onOpen,
}: {
  logId?: string;
  jobId: string;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mt-4 rounded-lg border border-blue-100 bg-blue-50/20 p-3"
    >
      <summary className="cursor-pointer text-sm font-medium text-blue-800">
        简报生成的 AI 调用
      </summary>
      {open && (
        <div className="mt-3">
          <p className="mb-3 text-xs text-neutral-500">
            结构化汇总不调用 AI。历史记录若未保存调用详情，此处不会补造。
          </p>
          <ExecutionLogs
            embedded
            logId={logId}
            jobId={logId ? undefined : jobId}
            onOpen={onOpen}
          />
        </div>
      )}
    </details>
  );
}
