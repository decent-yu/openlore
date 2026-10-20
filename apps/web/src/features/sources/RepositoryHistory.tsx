import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Source } from "@openlore/contracts";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";

const labels = {
  pending: "待研读",
  running: "研读中",
  failed: "研读失败",
  awaiting_archive: "等待归档",
  completed: "已归档",
};
export function RepositoryHistory({
  source,
  compact = false,
  showGoal = true,
}: {
  source: Source;
  compact?: boolean;
  showGoal?: boolean;
}) {
  const history = source.repository_history || [];
  const goal =
    source.options.research_focus || "理解核心架构、设计方案与实现思想";
  const renderHistory = (isCompact: boolean, expandReports = false) =>
    (isCompact ? history.slice(0, 3) : history).map((item) => (
      <div key={item.article_id} className="rounded border bg-white p-2">
        <p>
          {item.title} · {labels[item.status]}
        </p>
        {item.error && (
          <p role="alert" className="mt-1 text-red-700">
            {item.error}
          </p>
        )}
        {!isCompact && item.commit && (
          <p className="mt-1 break-all font-mono text-[10px]">
            Commit：{item.commit}
          </p>
        )}
        {item.reports.map((report) => (
          <div key={report.id} className="mt-1">
            {report.wiki_url && (
              <a
                className="text-blue-700 underline"
                href={report.wiki_url}
                target="_blank"
                rel="noreferrer"
              >
                阅读 Wiki 研报
              </a>
            )}
            {!isCompact && (
              <details className="mt-1" open={expandReports || undefined}>
                <summary className="cursor-pointer">查看研报</summary>
                <div className="prose prose-sm max-w-none break-words p-2">
                  <ReactMarkdown>{report.report_markdown}</ReactMarkdown>
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    ));
  return (
    <div className="min-w-0 space-y-2 text-xs text-neutral-600">
      {showGoal && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                tabIndex={0}
                className="line-clamp-2 whitespace-pre-line break-words"
              >
                研读目标：{goal}
              </p>
            </TooltipTrigger>
            <TooltipContent>{goal}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <Dialog.Root>
        <div className="flex items-center justify-between gap-2">
          <p>
            历史研读：
            {history.filter((item) => item.status === "completed").length}{" "}
            篇已归档
            {history.some((item) => item.status !== "completed")
              ? " · 有未完成记录"
              : ""}
          </p>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="shrink-0 text-blue-700 underline underline-offset-2 hover:text-blue-900"
            >
              查看全部
            </button>
          </Dialog.Trigger>
        </div>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-xs" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw_-_2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-white shadow-xl"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b p-5">
              <div>
                <Dialog.Title className="font-semibold text-neutral-900">
                  {source.name} · 历史研读
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-neutral-500">
                  全部 {history.length}{" "}
                  条研读记录，包含完整研报、归档链接和失败原因。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="关闭历史研读"
                  className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <div className="min-h-0 space-y-3 overflow-y-auto p-5 text-xs text-neutral-600">
              {history.length ? (
                renderHistory(false, true)
              ) : (
                <p className="py-8 text-center text-neutral-500">
                  暂无历史研读记录。
                </p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {renderHistory(compact)}
    </div>
  );
}
