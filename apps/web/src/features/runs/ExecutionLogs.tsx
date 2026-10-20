import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";

const taskNames: Record<string, string> = {
  assess: "内容初审",
  select: "流水线选文",
  research_report: "深度调研",
  translate: "中文翻译",
  digest: "汇报简报",
  organize: "文章整理",
  repair: "修复",
  research_plan: "调研规划",
};
const statusNames: Record<string, string> = {
  running: "执行中",
  success: "成功",
  timeout: "超时",
  failed: "失败",
  interrupted: "服务中断",
  cancelled: "已取消",
  invalid_output: "输出无效",
  auth_required: "需要登录",
  quota_exceeded: "额度不足",
};
function duration(ms?: number) {
  if (ms === undefined) return "未记录";
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
const time = (value?: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "尚未结束";
const color = (status: string) =>
  status === "success"
    ? "text-emerald-700 bg-emerald-50"
    : status === "running"
      ? "text-blue-700 bg-blue-50"
      : status === "cancelled" ? "text-neutral-600 bg-neutral-100" : "text-red-700 bg-red-50";

export function ExecutionLogs({
  runId = "",
  jobId = "",
  logId = "",
  embedded = false,
  onOpen,
  onViewRun,
  onViewPush,
}: {
  runId?: string;
  jobId?: string;
  logId?: string;
  embedded?: boolean;
  onOpen: (id: string) => void;
  onViewRun?: (id: string) => void;
  onViewPush?: (id: string) => void;
}) {
  const [status, setStatus] = useState("");
  const [task, setTask] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isLoading } = useQuery({
    queryKey: [
      "executionLogs",
      runId,
      jobId,
      logId,
      status,
      task,
      search,
      page,
    ],
    queryFn: () =>
      api.listExecutionLogs({
        run_id: runId || undefined,
        job_id: jobId || undefined,
        log_id: logId || undefined,
        status,
        task_type: task,
        search,
        page,
      }),
    refetchInterval: 3000,
  });
  const filter = (action: () => void) => {
    action();
    setPage(1);
  };
  return (
    <section
      aria-label={embedded ? "关联 AI 调用" : "全部 AI 调用"}
      className={
        embedded
          ? "space-y-4"
          : "space-y-4 rounded-xl border bg-white p-4 sm:p-5"
      }
    >
      {!embedded && (
        <div>
          <h3 className="text-lg font-semibold">全部 AI 调用</h3>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            按类型查看内容初审、流水线选文和深度调研调用，点击来源可返回对应运行或推送。相同调用在各入口展示同一份详情。
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
          <Input
            aria-label="搜索 AI 调用"
            className="pl-9"
            placeholder="搜索文章、调用 ID 或 Skill"
            value={search}
            onChange={(event) => filter(() => setSearch(event.target.value))}
          />
        </div>
        <select
          aria-label="调用状态"
          className="rounded-md border bg-white px-3 text-sm"
          value={status}
          onChange={(event) => filter(() => setStatus(event.target.value))}
        >
          <option value="">全部状态</option>
          <option value="running">执行中</option>
          <option value="success">成功</option>
          <option value="problem">失败 / 超时 / 中断</option>
        </select>
        <select
          aria-label="调用类型"
          className="rounded-md border bg-white px-3 text-sm"
          value={task}
          onChange={(event) => filter(() => setTask(event.target.value))}
        >
          <option value="">全部类型</option>
          <option value="assess">内容初审</option>
          <option value="select">流水线选文</option>
          <option value="research_report">深度调研</option>
          <option value="translate">中文翻译</option>
          <option value="digest">汇报简报</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error.message}
        </p>
      )}
      {isLoading && (
        <p role="status" className="p-8 text-center text-sm text-neutral-500">
          正在加载调用日志…
        </p>
      )}
      {!isLoading && !data?.items.length && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-neutral-500">
          暂无匹配的调用记录。新版日志从启用后开始记录；历史输入、时限和失败尝试未保存时无法追溯；命中缓存不产生新的
          AI 调用。
        </p>
      )}
      <div className="space-y-2">
        {data?.items.map((log) => (
          <article
            key={log.id}
            className="w-full rounded-lg border p-4 text-left transition-colors hover:border-neutral-300"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">
                  {log.article_title || log.job_id}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {taskNames[log.task_type] || log.task_type} ·{" "}
                  {log.skill_id || "无 Skill"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded px-2 py-1 text-xs ${color(log.status)}`}
              >
                {statusNames[log.status] || log.status}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
              <span>{time(log.started_at)}</span>
              <span>
                总耗时{" "}
                {log.status === "running"
                  ? duration(Date.now() - Date.parse(log.started_at))
                  : duration(log.duration_ms)}
              </span>
              <span>
                {log.attempts.filter(attempt => attempt.phase !== "recovery").length} 次执行
                {log.attempts.some(attempt => attempt.phase === "recovery") ? " · 已复用产物" : ""}
                {new Set(log.attempts.map((attempt) => attempt.profile_id))
                  .size > 1
                  ? " · 含主备切换"
                  : ""}
                {log.attempts.some((attempt) => attempt.phase === "correction")
                  ? " · 含校验修正"
                  : ""}
              </span>
              <span>
                {log.attempts.at(-1)?.phase === 'recovery' ? '复用已有研报，未调用 AI' : <>{log.attempts.at(-1)?.executor_name || "正在准备"} · 时限 {log.attempts.at(-1)?.timeout_seconds ?? "—"} 秒</>}
                {log.status === "running" &&
                log.attempts.at(-1)?.progress_state === "queued"
                  ? " · 等待执行槽位"
                  : ""}
              </span>
            </div>
            {log.error_message && (
              <p className="mt-2 break-words text-xs text-red-700">
                {log.error_message}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="text-xs font-medium text-blue-700 hover:underline"
                onClick={() => onOpen(log.id)}
              >
                查看完整输入、输出与执行明细 →
              </button>
              {!embedded && log.run_id && onViewRun && (
                <button
                  type="button"
                  className="text-xs text-neutral-600 hover:underline"
                  onClick={() => onViewRun(log.run_id!)}
                >
                  流水线：{log.group_name || log.group_id || log.run_id} →
                </button>
              )}
              {!embedded && log.report_plan_id && onViewPush && (
                <button
                  type="button"
                  className="text-xs text-neutral-600 hover:underline"
                  onClick={() => onViewPush(log.report_plan_id!)}
                >
                  推送：{log.report_plan_name || log.report_plan_id} →
                </button>
              )}
              {!log.run_id && !log.report_plan_id && (
                <span className="text-xs text-neutral-500">
                  独立调用{log.group_name ? ` · ${log.group_name}` : ""}
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
          <span>
            共 {data.total} 次调用 · 第 {page} /{" "}
            {Math.max(1, Math.ceil(data.total / data.page_size))} 页
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page * data.page_size >= data.total}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
