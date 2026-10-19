import React from "react";
import {
  DEFAULT_REPORT_TEMPLATE,
  DEFAULT_REPORT_CARD_TITLE,
  ReportCardTitleTemplateSchema,
  renderReportCardTitle,
  REPORT_TEMPLATE_VARIABLES,
  ReportTemplateSchema,
  renderReportTemplate,
} from "@openlore/contracts";
import { FeishuCardPreview } from "./FeishuCardPreview.js";
import { Button } from "../../components/ui/button.js";

export function ReportTemplateEditor({
  value,
  titleTemplate,
  onTitleChange,
  reportName,
  taskNames,
  onChange,
}: {
  value: string;
  titleTemplate: string;
  onTitleChange: (value: string) => void;
  reportName: string;
  taskNames: string[];
  onChange: (value: string) => void;
}) {
  const parsed = ReportTemplateSchema.safeParse(value);
  const titleParsed = ReportCardTitleTemplateSchema.safeParse(titleTemplate);
  const sampleValues = {
    report_name: reportName || "技术日报",
    date: new Date().toLocaleDateString("en-CA"),
    task_count: taskNames.length || 1,
    article_count: 2,
    deep_count: 1,
    content: `### ${taskNames[0] || "Agent 工程"}\n\n- [Agent 工具调用的可恢复执行](https://wiki.example.com/agent/research) · 含深度调研\n  通过任务标识、持久状态和结果核对，处理执行中断与恢复。\n\n- [上下文证据的结构化整理](https://wiki.example.com/context/article)\n  将原文证据按片段组织，让结论和出处可以回查。`,
  };
  return (
    <>
      <h4 className="text-sm font-semibold">2 · 汇报模板</h4>
      <p className="text-xs text-neutral-500">
        程序直接填入已归档结果，不调用 AI。标题与统计可编辑，文章清单保留 Wiki
        阅读链接。
      </p>
      <label className="block text-xs font-medium text-neutral-600">
        卡片标题
        <input
          required
          aria-label="卡片标题"
          className="mt-1.5 h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm"
          value={titleTemplate}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>
      <p className="text-[11px] text-neutral-500">
        默认 {"{{report_name}}"}{" "}
        显示方案名称。标题为单行纯文本，可直接填固定标题，也可使用名称、日期和统计变量。
      </p>
      {!titleParsed.success && (
        <p role="alert" className="text-xs text-red-700">
          {titleParsed.error.issues[0].message}
        </p>
      )}
      <label className="block text-xs font-medium text-neutral-600">
        卡片正文（Markdown 模板）
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
        onClick={() => {
          onChange(DEFAULT_REPORT_TEMPLATE);
          onTitleChange(DEFAULT_REPORT_CARD_TITLE);
        }}
      >
        恢复默认模板
      </Button>
      {!parsed.success && (
        <p role="alert" className="text-xs text-red-700">
          {parsed.error?.issues[0]?.message}
        </p>
      )}
      <div className="space-y-2 rounded-lg border bg-neutral-50 p-3">
        <p className="text-xs font-medium text-neutral-700">
          飞书卡片模拟（示例数据）
        </p>
        <p className="text-[11px] text-neutral-500">
          顶部蓝色区域是卡片标题，下方白色区域是正文；实际排版以飞书客户端为准。保存后可用真实文章预览。
        </p>
        {parsed.success && titleParsed.success ? (
          <FeishuCardPreview
            title={renderReportCardTitle(titleTemplate, sampleValues)}
            markdown={renderReportTemplate(value, sampleValues)}
          />
        ) : (
          <p className="text-xs text-neutral-500">修正模板后显示示例预览。</p>
        )}
      </div>
    </>
  );
}
