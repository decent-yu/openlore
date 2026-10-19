import React from "react";
import type { Run } from "@openlore/contracts";
import { api } from "../../lib/api.js";
export function RunHistoryDetails({
  run,
  onReport,
  onError,
}: {
  run: Run;
  onReport: (report: { title: string; markdown: string }) => void;
  onError: (error: string) => void;
}) {
  return (
    <details className="mt-3 border-t pt-3">
      <summary className="cursor-pointer text-sm">
        选文结果与调研摘要（{run.ai_logs.length}）
      </summary>
      <p className="mt-2 text-xs text-neutral-500">
        此处为任务汇总摘要。旧记录没有保存完整材料、时限和失败尝试，无法补全；新调用请展开本次运行的
        AI 调用。
      </p>
      <div className="mt-2 space-y-2">
        {run.ai_logs.map((log, index) => (
          <details key={index} className="rounded border bg-neutral-50 p-3">
            <summary className="cursor-pointer text-sm">
              {log.article_title || log.task_type} · {log.status}
            </summary>
            <p className="mt-2 text-xs text-neutral-500">{log.model}</p>
            {log.execution && (
              <p className="mt-1 break-all text-[10px] text-neutral-400">
                {log.execution.mode === "native"
                  ? "工作区 Skill"
                  : "工作区路径加载"}{" "}
                · 版本 {log.execution.skill_revision?.slice(0, 12)} ·{" "}
                {log.execution.workspace}
              </p>
            )}
            <p className="mt-3 text-[11px] font-semibold text-neutral-600">
              实际任务 Prompt · {log.skill_id}
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
              {log.prompt_preview}
            </pre>
            <p className="mt-3 text-[11px] font-semibold text-neutral-600">
              AI 返回摘要（可能截断）
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
              {log.response_preview}
            </pre>
            {log.task_type === "research" && log.article_id && (
              <button
                type="button"
                className="mt-3 text-xs text-blue-700 underline"
                onClick={async () => {
                  try {
                    onError("");
                    const reports = await api.listResearch(run.group_id);
                    const report = reports
                      .filter(
                        (task) =>
                          task.article_id === log.article_id &&
                          task.status === "succeeded" &&
                          task.created_at >= run.started_at &&
                          task.created_at <= log.timestamp,
                      )
                      .sort((a, b) =>
                        b.created_at.localeCompare(a.created_at),
                      )[0];
                    if (!report)
                      throw new Error("没有找到本次运行生成的完整文章");
                    onReport({
                      title: log.article_title || "深度调研文章",
                      markdown: report.report_markdown,
                    });
                  } catch (error: any) {
                    onError(error.message);
                  }
                }}
              >
                查看本次生成的完整文章
              </button>
            )}
          </details>
        ))}
      </div>
    </details>
  );
}
