import { z } from "zod";

export const REPORT_TEMPLATE_VARIABLES = {
  report_name: "汇报名称",
  date: "汇报日期",
  task_count: "流水线任务数",
  article_count: "已归档研报数",
  deep_count: "深度调研篇数",
  content: "按任务分组的文章清单（含 Wiki 链接）",
} as const;
export type ReportTemplateVariable = keyof typeof REPORT_TEMPLATE_VARIABLES;
export const DEFAULT_REPORT_CARD_TITLE = "{{report_name}}";
const hasSupportedVariables = (value: string, allowContent: boolean) =>
  !/[{}]{2}/.test(value.replace(/{{(.*?)}}/gs, "")) &&
  [...value.matchAll(/{{(.*?)}}/gs)].every(
    (match) =>
      Object.hasOwn(REPORT_TEMPLATE_VARIABLES, match[1].trim()) &&
      (allowContent || match[1].trim() !== "content"),
  );

export const ReportCardTitleTemplateSchema = z
  .string()
  .trim()
  .min(1, "请输入卡片标题")
  .max(200, "卡片标题模板最多 200 个字符")
  .refine((value) => !/[\r\n]/.test(value), "卡片标题请使用单行纯文本")
  .refine(
    (value) => hasSupportedVariables(value, false),
    "标题支持名称、日期和统计变量，不支持 {{content}}",
  );
export const DEFAULT_REPORT_TEMPLATE = `日期：{{date}}

汇总 {{task_count}} 个流水线任务，共 {{article_count}} 篇已归档研报。

{{content}}`;

export const ReportTemplateSchema = z
  .string()
  .trim()
  .min(1, "请输入汇报模板")
  .max(10000)
  .refine(
    (value) => /{{\s*content\s*}}/.test(value),
    "模板必须包含 {{content}}，用于显示文章和阅读链接",
  )
  .refine(
    (value) => hasSupportedVariables(value, true),
    "模板包含不支持的变量，请使用下方列出的变量",
  );

export function renderReportTemplate(
  template: string,
  values: Record<ReportTemplateVariable, string | number>,
): string {
  return ReportTemplateSchema.parse(template).replace(
    /{{(.*?)}}/gs,
    (_, key: string) => String(values[key.trim() as ReportTemplateVariable]),
  );
}

export function renderReportCardTitle(
  template: string,
  values: Record<ReportTemplateVariable, string | number>,
): string {
  return ReportCardTitleTemplateSchema.parse(template)
    .replace(/{{(.*?)}}/gs, (_, key: string) =>
      String(values[key.trim() as ReportTemplateVariable]),
    )
    .replace(/[\r\n]+/g, " ");
}

/** Shared by the outbound Feishu/Lark payload and the browser simulation. */
export function buildFeishuCard(title: string, markdown: string) {
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: title }, template: "blue" },
    elements: [{ tag: "div", text: { tag: "lark_md", content: markdown } }],
  } as const;
}
