import React, { useState } from "react";
import type { Run } from "@openlore/contracts";
import { ExecutionLogs } from "./ExecutionLogs.js";
import { RunHistoryDetails } from "./RunHistoryDetails.js";
const stages: Record<string, string> = {
  processing: "AI 审核",
  research: "深度调研",
  delivery: "GitHub 归档",
  completed: "已完成",
};
const statuses: Record<string, string> = {
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
  partial: "部分失败",
  queued: "排队中",
  cancelled: "已取消",
  blocked: "受阻",
};
export function PipelineRunCard({
  run,
  initiallyOpen,
  onOpenLog,
  onReport,
  onError,
}: {
  run: Run;
  initiallyOpen: boolean;
  onOpenLog: (id: string) => void;
  onReport: (report: { title: string; markdown: string }) => void;
  onError: (error: string) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <article className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <strong>{run.group_name}</strong>
        <span
          className={
            run.status === "failed"
              ? "text-red-600"
              : run.status === "succeeded"
                ? "text-emerald-700"
                : "text-blue-700"
          }
        >
          {statuses[run.status] || run.status} ·{" "}
          {stages[run.stage] || run.stage}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        开始：{new Date(run.started_at).toLocaleString()}{" "}
        {run.finished_at
          ? `· 结束：${new Date(run.finished_at).toLocaleString()}`
          : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <span>扫描文章 {run.counts.observed}</span>
        <span>参与评估 {run.counts.candidate}</span>
        <span>本次调研 {run.counts.planned}</span>
        <span>
          调研{" "}
          {run.output?.entries.filter((entry) => entry.is_deep_analyzed)
            .length || 0}
        </span>
        <span>审核排除 {run.counts.excluded}</span>
        {!!run.counts.deferred && <span>合格待选 {run.counts.deferred}</span>}
        <span>已归档/执行中跳过 {run.counts.already_processed}</span>
      </div>
      {run.status === "running" &&
        run.stage === "processing" &&
        run.counts.candidate > 0 && (
          <div
            role="status"
            className="mt-3 space-y-1.5 rounded-lg bg-blue-50 p-3 text-xs text-blue-800"
          >
            <p>
              已完成审核{" "}
              {run.ai_logs.filter((log) => log.task_type === "assess").length} /{" "}
              {run.counts.candidate} 篇 · 按有效评分排序调研
            </p>
            <progress
              aria-label="文章审核进度"
              className="h-1.5 w-full accent-blue-600"
              max={run.counts.candidate}
              value={
                run.ai_logs.filter((log) => log.task_type === "assess").length
              }
            />
          </div>
        )}
      <p className="mt-2 text-xs text-neutral-500">
        来源范围内，全池未完成调研的文章按有效评分竞争本次调研名额，已归档和执行中的文章不重复领取。
      </p>
      {run.error_message && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {run.error_message}
        </p>
      )}
      {run.output?.commit_url && (
        <a
          className="mt-2 inline-block text-sm text-blue-700"
          href={run.output.commit_url}
          target="_blank"
          rel="noreferrer"
        >
          查看 GitHub 归档
        </a>
      )}

      <p className="mt-2 break-all text-[11px] text-neutral-400">
        运行 ID：{run.id}
      </p>
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="mt-4 rounded-lg border border-blue-100 bg-blue-50/20 p-3 sm:p-4"
      >
        <summary className="cursor-pointer text-sm font-medium text-blue-800">
          本次运行的全部 AI 调用
        </summary>
        {open && (
          <div className="mt-4">
            <p className="mb-3 text-xs leading-relaxed text-neutral-500">
              只展示本次运行的审核、调研和重试调用；主备尝试保存在每次调用详情中。命中缓存的审核结果可在下方汇总查看。
            </p>
            <ExecutionLogs
              key={run.id}
              runId={run.id}
              embedded
              onOpen={onOpenLog}
            />
          </div>
        )}
      </details>
      <RunHistoryDetails run={run} onReport={onReport} onError={onError} />
    </article>
  );
}
