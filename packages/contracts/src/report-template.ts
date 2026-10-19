import { z } from "zod";

export const REPORT_TEMPLATE_VARIABLES = {
  report_name: "汇报名称",
  date: "汇报日期",
  task_count: "流水线任务数",
  article_count: "精选文章数",
  deep_count: "深度调研篇数",
  content: "按任务分组的文章清单（含 Wiki 链接）",
} as const;
export type ReportTemplateVariable = keyof typeof REPORT_TEMPLATE_VARIABLES;
export const DEFAULT_REPORT_TEMPLATE = `# {{report_name}} · {{date}}

汇总 {{task_count}} 个流水线任务，共 {{article_count}} 篇精选（{{deep_count}} 篇深度调研）。

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
    (value) =>
      !/[{}]{2}/.test(value.replace(/{{(.*?)}}/gs, "")) &&
      [...value.matchAll(/{{(.*?)}}/gs)].every((match) =>
        Object.hasOwn(REPORT_TEMPLATE_VARIABLES, match[1].trim()),
      ),
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
