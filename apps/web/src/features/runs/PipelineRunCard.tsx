import React, { useState } from "react";
import type { Run } from "@openlore/contracts";
import { ExecutionLogs } from "./ExecutionLogs.js";
import { RunHistoryDetails } from "./RunHistoryDetails.js";
const stages: Record<string, string> = {
  processing: "AI 批量选文",
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
        <span>备选文章 {run.counts.candidate}</span>
        <span>本次调研 {run.counts.planned}</span>
        <span>
          调研{" "}
          {run.output?.entries.filter((entry) => entry.is_deep_analyzed)
            .length || 0}
        </span>
        <span>未初审跳过 {run.counts.unreviewed}</span>
        {!!run.counts.deferred && <span>留待后续 {run.counts.deferred}</span>}
        <span>已归档/执行中跳过 {run.counts.already_processed}</span>
      </div>
      {run.status === 'running' && run.stage === 'processing' && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">正在比较 {run.counts.candidate} 篇候选的评分与简介，批量选择调研文章…</p>}
      <p className="mt-2 text-xs text-neutral-500">
        只使用共享初审结果批量选文；已归档、执行中和未完成初审的文章跳过。
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
              展示本次选文、调研及重试调用。内容初审独立记录，可在“AI 调用日志”按类型查看。
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
