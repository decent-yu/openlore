import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  DEFAULT_REPORT_TEMPLATE,
  ReportTemplateSchema,
  renderReportTemplate,
} from "@openlore/contracts";
import { ReportTemplateEditor } from "../features/reports/ReportTemplateEditor.js";

it("shows the editable template, supported variables and generated preview without AI controls", () => {
  const html = renderToStaticMarkup(
    <ReportTemplateEditor
      value={DEFAULT_REPORT_TEMPLATE}
      reportName="团队周报"
      taskNames={["Agent 工程"]}
      onChange={() => {}}
    />,
  );
  expect(html).toContain("<textarea");
  expect(html).toContain("{{content}}");
  expect(html).toContain("团队周报");
  expect(html).toContain("Agent 工程");
  expect(html).toContain("恢复默认模板");
  expect(html).toContain("不调用 AI");
  expect(html).not.toContain("<select");
});

it("renders only supported variables once, keeping article links and literal placeholders in data intact", () => {
  const wiki = "[Wiki 研报](https://wiki.example/topic/research)";
  const result = renderReportTemplate(DEFAULT_REPORT_TEMPLATE, {
    report_name: "日报 $&",
    date: "2026-10-19",
    task_count: 2,
    article_count: 1,
    deep_count: 1,
    content: `${wiki}\n文章中的 {{date}} 只是材料`,
  });
  expect(result).toContain("# 日报 $& · 2026-10-19");
  expect(result).toContain(wiki);
  expect(result).toContain("文章中的 {{date}} 只是材料");
  expect(
    ReportTemplateSchema.safeParse("{{constructor}} {{content}}").success,
  ).toBe(false);
  expect(ReportTemplateSchema.safeParse("没有清单").success).toBe(false);
  expect(ReportTemplateSchema.safeParse("{{content}} {{date").success).toBe(
    false,
  );
});

it("shows an invalid-template error instead of rendering unsupported variables", () => {
  const html = renderToStaticMarkup(
    <ReportTemplateEditor
      value={"{{unknown}}\n{{content}}"}
      reportName="日报"
      taskNames={[]}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("修正模板后显示示例预览");
});
