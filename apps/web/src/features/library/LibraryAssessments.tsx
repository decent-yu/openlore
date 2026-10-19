import React from "react";
import type { LibraryArticle } from "@openlore/contracts";

export function LibraryAssessments({
  assessments,
  timezone,
}: {
  assessments: LibraryArticle["assessments"];
  timezone: string;
}) {
  if (!assessments.length)
    return <p className="text-[11px] text-neutral-400">暂无 AI 评分</p>;
  return (
    <section
      aria-label="AI 评分"
      className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3 text-xs"
    >
      <p className="font-medium text-blue-900">
        AI 已评分{" "}
        <span className="font-normal text-neutral-500">（满分 100）</span>
      </p>
      {assessments.map((item) => (
        <div key={item.group_id} className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="font-medium text-neutral-700">
              {item.group_name}
            </span>
            <time
              dateTime={item.assessed_at}
              className="text-[10px] text-neutral-400"
            >
              {new Intl.DateTimeFormat("zh-CN", {
                timeZone: timezone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(new Date(item.assessed_at))}
            </time>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-neutral-600">
            <span>
              综合分{" "}
              <strong className="text-blue-800">
                {item.overall.toFixed(1)}
              </strong>
            </span>
            <span>
              相关度 <strong>{item.relevance}</strong>
            </span>
            <span>
              工程质量 <strong>{item.quality}</strong>
            </span>
          </div>
          {item.reason && (
            <p className="text-[11px] leading-relaxed text-neutral-500">
              {item.reason}
            </p>
          )}
        </div>
      ))}
      <p className="text-[10px] text-neutral-400">
        各流水线最近一次有效评分；综合分 = 相关度 × 70% + 工程质量 ×
        30%。评分历史不代表当前一定入选。
      </p>
    </section>
  );
}
