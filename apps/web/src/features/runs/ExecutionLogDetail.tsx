import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Clock, Download, FileInput, FileOutput, X } from "lucide-react";
import type { AIExecutionLogDetail } from "@openlore/contracts";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { useDialog } from "../../lib/useDialog.js";

const taskNames: Record<string, string> = {
  assess: "内容初审",
  select: "流水线选文",
  research_report: "深度调研",
};
const statusNames: Record<string, string> = {
  running: "执行中",
  success: "成功",
  timeout: "超时",
  failed: "失败",
  interrupted: "服务中断",
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
      : "text-red-700 bg-red-50";

export function ExecutionLogDetail({
  id,
  onClose,
  onViewRun,
  onViewPush,
}: {
  id: string;
  onClose: () => void;
  onViewRun?: (runId: string) => void;
  onViewPush?: (planId: string) => void;
}) {
  const [tab, setTab] = useState<"input" | "output" | "attempts">("attempts");
  const [notice, setNotice] = useState("");
  const { data: detail, error: detailError } = useQuery({
    queryKey: ["executionLog", id],
    queryFn: () => api.getExecutionLog(id),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 2000 : false,
  });
  useDialog(Boolean(id), () => onClose());
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("已复制完整内容");
    } catch {
      setNotice("复制失败，请选中内容手动复制");
    }
  };
  const download = (log: AIExecutionLogDetail) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(log, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${log.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      {id && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="AI 调用详情"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-6"
        >
          <div className="flex h-[94vh] max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-5">
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-base font-semibold">
                  {detail?.article_title || "AI 调用详情"}
                </h3>
                <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">
                  {detail?.job_id || id}
                </p>
              </div>
              <div className="flex gap-2">
                {detail && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => download(detail)}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    导出完整日志
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="关闭调用详情"
                  onClick={() => onClose()}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </header>
            <div className="shrink-0 border-b bg-neutral-50 px-4 py-3 text-xs sm:px-5">
              {detail && (
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <span className={`rounded px-2 py-1 ${color(detail.status)}`}>
                    {statusNames[detail.status] || detail.status}
                  </span>
                  <span>{taskNames[detail.task_type] || detail.task_type}</span>
                  <span>开始 {time(detail.started_at)}</span>
                  <span>结束 {time(detail.finished_at)}</span>
                  <span>
                    总耗时{" "}
                    {detail.status === "running"
                      ? duration(Date.now() - Date.parse(detail.started_at))
                      : duration(detail.duration_ms)}
                  </span>
                  <span>{detail.attempts.length} 次尝试</span>
                  {detail.usage_summary &&
                    detail.usage_summary.recorded_attempts > 0 && (
                      <span>
                        累计 Token{" "}
                        {detail.usage_summary.usage.totalTokens ?? "—"}（已记录{" "}
                        {detail.usage_summary.recorded_attempts}/
                        {detail.usage_summary.total_attempts} 次，含缓存）
                      </span>
                    )}
                </div>
              )}
            </div>
            {detail && (
              <div className="flex shrink-0 flex-wrap gap-3 border-b px-4 py-2 text-xs sm:px-5">
                {detail.run_id && onViewRun && (
                  <button
                    type="button"
                    className="text-blue-700 hover:underline"
                    onClick={() => onViewRun(detail.run_id!)}
                  >
                    所属流水线运行：
                    {detail.group_name || detail.group_id || detail.run_id} →
                  </button>
                )}
                {detail.report_plan_id && onViewPush && (
                  <button
                    type="button"
                    className="text-blue-700 hover:underline"
                    onClick={() => onViewPush(detail.report_plan_id!)}
                  >
                    所属汇报推送：
                    {detail.report_plan_name || detail.report_plan_id} →
                  </button>
                )}
                {!detail.run_id && !detail.report_plan_id && (
                  <span className="text-neutral-500">
                    独立调用{detail.group_name ? ` · ${detail.group_name}` : ""}
                    ，未关联某次流水线运行
                  </span>
                )}
              </div>
            )}
            <div
              role="tablist"
              aria-label="调用详情内容"
              className="flex shrink-0 gap-1 border-b px-4 pt-2"
            >
              {(
                [
                  ["input", "完整输入", FileInput],
                  ["output", "完整输出", FileOutput],
                  ["attempts", "执行与实时日志", Clock],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${tab === key ? "border-blue-600 text-blue-700" : "border-transparent text-neutral-500"}`}
                  onClick={() => setTab(key)}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {detailError && (
                <p role="alert" className="text-red-700">
                  {detailError.message}
                </p>
              )}
              {!detail && !detailError && <p>正在加载完整日志…</p>}
              {notice && (
                <p
                  role="status"
                  className="mb-3 rounded bg-blue-50 p-2 text-xs text-blue-800"
                >
                  {notice}
                </p>
              )}
              {detail && tab === "input" && (
                <div className="space-y-5">
                  <TextBlock
                    title="任务指令 · Prompt"
                    value={detail.input.prompt}
                    onCopy={copy}
                  />
                  <TextBlock
                    title={`输入材料 · ${detail.input.material.length.toLocaleString()} 字符`}
                    value={detail.input.material}
                    onCopy={copy}
                  />
                  <details className="rounded-lg border p-3">
                    <summary className="text-sm font-medium">
                      Skill 与输出格式要求
                    </summary>
                    <p className="my-2 break-all text-xs text-neutral-500">
                      Skill：{detail.skill_id || "未指定"} · 版本：
                      {detail.input.skillRevision ||
                        detail.attempts.at(-1)?.execution?.skill_revision ||
                        "未记录"}
                    </p>
                    <TextBlock
                      title="实际加载的 SKILL.md"
                      value={
                        detail.attempts.find(
                          (attempt) => attempt.execution?.skill_instructions,
                        )?.execution?.skill_instructions ||
                        "本次尚未加载或未保存 Skill 内容"
                      }
                      onCopy={copy}
                    />
                    {detail.input.outputSchema && (
                      <TextBlock
                        title="要求返回的 JSON Schema"
                        value={JSON.stringify(
                          detail.input.outputSchema,
                          null,
                          2,
                        )}
                        onCopy={copy}
                      />
                    )}
                  </details>
                </div>
              )}
              {detail && tab === "output" && (
                <div className="space-y-4">
                  <p className="text-xs text-neutral-500">
                    这里显示最终成功尝试的完整返回内容。失败尝试及超时留下的文件请在“执行与实时日志”查看。
                  </p>
                  {detail.output ? (
                    <>
                      <details open className="rounded-lg border p-4">
                        <summary className="mb-3 text-sm font-medium">
                          阅读视图
                        </summary>
                        {detail.output.trim().startsWith("{") ? (
                          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
                            {detail.output}
                          </pre>
                        ) : (
                          <div className="prose prose-sm max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {detail.output}
                            </ReactMarkdown>
                          </div>
                        )}
                      </details>
                      <TextBlock
                        title="原始返回内容"
                        value={detail.output}
                        onCopy={copy}
                      />
                    </>
                  ) : (
                    <p className="rounded-lg bg-neutral-50 p-6 text-sm text-neutral-500">
                      {detail.status === "running"
                        ? "AI 正在执行，最终输出尚未返回。"
                        : "本次没有成功的最终输出。"}
                    </p>
                  )}
                </div>
              )}
              {detail && tab === "attempts" && (
                <div className="space-y-4">
                  <details className="rounded-lg border p-3">
                    <summary className="text-xs font-medium">
                      关联 ID 与 Skill
                    </summary>
                    <dl className="mt-3 space-y-2 text-xs">
                      {Object.entries({
                        "日志 ID": detail.id,
                        "调用 ID": detail.job_id,
                        "流水线运行 ID": detail.run_id || "独立调用",
                        "任务 ID": detail.group_id || "未关联",
                        "汇报方案 ID": detail.report_plan_id || "未关联",
                        "文章 ID": detail.article_id || "未关联",
                        Skill: detail.skill_id || "未指定",
                      }).map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-neutral-500">{label}</dt>
                          <dd className="break-all font-mono">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  {detail.error_message && (
                    <p
                      role="alert"
                      className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
                    >
                      {detail.error_message}
                    </p>
                  )}
                  {detail.attempts.map((attempt) => (
                    <section
                      key={attempt.index}
                      className="space-y-3 rounded-xl border p-4"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <h4 className="text-sm font-semibold">
                          第 {attempt.index} 次 · {attempt.executor_name}
                          {attempt.phase === "correction"
                            ? attempt.resumed
                              ? "（原会话校验修正）"
                              : "（接管修正）"
                            : attempt.index > 1
                              ? "（备用接管）"
                              : ""}
                        </h4>
                        <span
                          className={`rounded px-2 py-1 text-xs ${color(attempt.status)}`}
                        >
                          {statusNames[attempt.status] || attempt.status}
                        </span>
                      </div>
                      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                        {Object.entries({
                          "执行器 / 模型": `${attempt.provider} / ${attempt.model}`,
                          连接方式:
                            (
                              {
                                local: "服务端本机",
                                worker: "Worker",
                                ssh: "SSH",
                              } as Record<string, string>
                            )[attempt.transport] || attempt.transport,
                          本次执行时限: `${attempt.timeout_seconds} 秒（${attempt.timeout_seconds / 60} 分钟）`,
                          排队等待上限: `${attempt.queue_timeout_seconds} 秒`,
                          开始: time(attempt.started_at),
                          结束: time(attempt.finished_at),
                          耗时:
                            attempt.status === "running"
                              ? duration(
                                  Date.now() - Date.parse(attempt.started_at),
                                )
                              : duration(attempt.duration_ms),
                          退出码: attempt.diagnostics?.exit_code ?? "未返回",
                          最近进程输出: attempt.last_output_at
                            ? time(attempt.last_output_at)
                            : "尚无输出",
                          会话: attempt.session_id || "执行器尚未提供",
                          "Token 用量": attempt.usage
                            ? `输入 ${attempt.usage.promptTokens ?? "—"} / 输出 ${attempt.usage.completionTokens ?? "—"} / 总量 ${attempt.usage.totalTokens ?? "—"}${attempt.usage.cachedTokens ? ` / 缓存 ${attempt.usage.cachedTokens}` : ""}${attempt.usage.reasoningTokens ? ` / 推理 ${attempt.usage.reasoningTokens}` : ""}`
                            : "执行器未提供",
                        }).map(([label, value]) => (
                          <div
                            key={label}
                            className="min-w-0 rounded bg-neutral-50 p-2"
                          >
                            <dt className="text-neutral-500">{label}</dt>
                            <dd className="mt-1 break-words font-medium">
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {attempt.error && (
                        <p
                          role="alert"
                          className="break-words rounded bg-red-50 p-3 text-xs text-red-700"
                        >
                          {attempt.error.code}：{attempt.error.message}
                        </p>
                      )}
                      {attempt.validation_issues?.length ? (
                        <ul className="space-y-1 rounded bg-amber-50 p-3 text-xs text-amber-900">
                          {attempt.validation_issues.map((issue, index) => (
                            <li key={index}>
                              {issue.path}：{issue.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {attempt.index < detail.attempts.length && (
                        <p className="text-xs text-amber-800">
                          本次未通过；下一步为{" "}
                          {detail.attempts[attempt.index].phase === "correction"
                            ? "校验修正"
                            : "备用接管"}{" "}
                          · {detail.attempts[attempt.index].executor_name}。
                        </p>
                      )}
                      {attempt.execution && (
                        <details className="rounded border p-3">
                          <summary className="text-xs">
                            工作区与 Skill 文件
                          </summary>
                          <p className="mt-2 break-all text-xs">
                            {attempt.execution.workspace}
                          </p>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                            {attempt.execution.skill_files?.join("\n") ||
                              "未记录文件列表"}
                          </pre>
                        </details>
                      )}
                      {attempt.output && (
                        <TextBlock
                          title="本次尝试完整输出"
                          value={attempt.output}
                          onCopy={copy}
                        />
                      )}
                      {attempt.diagnostics?.partial_document && (
                        <TextBlock
                          title="超时前写入的文章 · 未确认完成，仅供核查"
                          value={attempt.diagnostics.partial_document}
                          onCopy={copy}
                        />
                      )}
                      <details className="rounded border p-3">
                        <summary className="text-xs font-medium">
                          CLI 实时日志 · 标准输出与错误输出
                        </summary>
                        <p className="my-2 text-xs text-neutral-500">
                          已对已知凭据脱敏。 工具事件未携带结果文本时，空 output
                          不表示原文件为空。
                          {attempt.status === "running"
                            ? "运行中自动刷新；没有新日志不代表模型正在推理。"
                            : ""}
                          {attempt.diagnostics?.output_truncated
                            ? "原始输出超出 512KB，保留末尾并标记截断。"
                            : ""}
                        </p>
                        <TextBlock
                          title="stdout"
                          value={
                            attempt.diagnostics?.stdout || "CLI 尚无标准输出"
                          }
                          onCopy={copy}
                        />
                        <TextBlock
                          title="stderr"
                          value={attempt.diagnostics?.stderr || "无错误输出"}
                          onCopy={copy}
                        />
                      </details>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function TextBlock({
  title,
  value,
  onCopy,
}: {
  title: string;
  value: string;
  onCopy: (value: string) => void;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <Button size="sm" variant="outline" onClick={() => onCopy(value)}>
          复制完整内容
        </Button>
      </div>
      <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-neutral-50 p-4 font-mono text-xs leading-6 text-neutral-800">
        {value}
      </pre>
    </section>
  );
}
