import React from "react";
import ReactMarkdown from "react-markdown";
import {
  DEFAULT_REPORT_TEMPLATE,
  REPORT_TEMPLATE_VARIABLES,
  ReportTemplateSchema,
  renderReportTemplate,
} from "@openlore/contracts";
import { Button } from "../../components/ui/button.js";

export function ReportTemplateEditor({
  value,
  reportName,
  taskNames,
  onChange,
}: {
  value: string;
  reportName: string;
  taskNames: string[];
  onChange: (value: string) => void;
}) {
  const parsed = ReportTemplateSchema.safeParse(value);
  return (
    <>
      <h4 className="text-sm font-semibold">2 · 汇报模板</h4>
      <p className="text-xs text-neutral-500">
        程序直接填入已归档结果，不调用 AI。标题与统计可编辑，文章清单保留 Wiki
        阅读链接。
      </p>
      <label className="block text-xs font-medium text-neutral-600">
        Markdown 模板
        <textarea
          required
          aria-label="Markdown 模板"
          className="mt-1.5 min-h-40 w-full rounded-md border border-neutral-200 bg-white p-3 font-mono text-xs"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="space-y-1 text-[11px] text-neutral-500">
        {Object.entries(REPORT_TEMPLATE_VARIABLES).map(([key, label]) => (
          <p key={key}>
            <code>{`{{${key}}}`}</code>：{label}
          </p>
        ))}
      </div>
      <p className="text-[11px] text-neutral-500">
        文章清单固定为「按任务分组 → 文章标题链接 → 已有导读」，有研报时优先链接
        Wiki 研报，否则使用 Wiki 正文。未配置 Wiki 时使用归档或原文链接。
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange(DEFAULT_REPORT_TEMPLATE)}
      >
        恢复默认模板
      </Button>
      {!parsed.success && (
        <p role="alert" className="text-xs text-red-700">
          {parsed.error?.issues[0]?.message}
        </p>
      )}
      <details className="rounded border bg-white p-3" open>
        <summary className="cursor-pointer text-xs text-blue-700">
          模板示例预览（非真实发送数据）
        </summary>
        <div className="prose prose-sm mt-3 max-w-none">
          <ReactMarkdown>
            {parsed.success
              ? renderReportTemplate(value, {
                  report_name: reportName || "技术日报",
                  date: new Date().toLocaleDateString("en-CA"),
                  task_count: taskNames.length || 1,
                  article_count: 1,
                  deep_count: 1,
                  content: `### ${taskNames[0] || "示例流水线"}\n\n- [示例文章](https://wiki.example.com/topic/research) · 含深度调研\n  这里填入文章已有的导读摘要。`,
                })
              : "修正模板后显示示例预览。"}
          </ReactMarkdown>
        </div>
      </details>
    </>
  );
}
