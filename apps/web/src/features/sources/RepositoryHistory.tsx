import React from "react";
import ReactMarkdown from "react-markdown";
import type { Source } from "@openlore/contracts";

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
  return (
    <div className="space-y-2 text-xs text-neutral-600">
      {showGoal && (
        <p>
          研读目标：
          {source.options.research_focus || "理解核心架构、设计方案与实现思想"}
        </p>
      )}
      <p>
        历史研读：{history.filter((item) => item.status === "completed").length}{" "}
        篇已归档
        {history.some((item) => item.status !== "completed")
          ? " · 有未完成记录"
          : ""}
      </p>
      {!history.length && (
        <p className="text-neutral-400">
          首次运行将结合目标研读源码，后续自动关联研报，避免重复概述。
        </p>
      )}
      {(compact ? history.slice(0, 3) : history).map((item) => (
        <div key={item.article_id} className="rounded border bg-white p-2">
          <p>
            {item.title} · {labels[item.status]}
          </p>
          {item.error && (
            <p role="alert" className="mt-1 text-red-700">
              {item.error}
            </p>
          )}
          {!compact && item.commit && (
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
              {!compact && (
                <details className="mt-1">
                  <summary className="cursor-pointer">查看研报</summary>
                  <div className="prose prose-sm max-w-none break-words p-2">
                    <ReactMarkdown>{report.report_markdown}</ReactMarkdown>
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
