import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  LibraryFilters,
  DEFAULT_LIBRARY_FILTERS,
  libraryFilterParams,
  libraryFiltersError,
} from "../features/library/LibraryFilters.js";
import { LibraryArticleStatus } from "../features/library/LibraryArticleStatus.js";
import { api } from "../lib/api.js";
import { LibraryAssessments } from "../features/library/LibraryAssessments.js";

afterEach(() => vi.unstubAllGlobals());
it("separates discovery and publication rows and shows custom date controls for each", () => {
  const html = renderToStaticMarkup(
    <LibraryFilters
      value={{
        ...DEFAULT_LIBRARY_FILTERS,
        time_range: "custom",
        discovered_from: "2026-10-18",
        discovered_to: "2026-10-19",
        published_range: "custom",
        published_from: "2026-10-16",
        published_to: "2026-10-17",
      }}
      timezone="Asia/Shanghai"
      onChange={() => {}}
    />,
  );
  for (const label of [
    "发现时间",
    "发布时间",
    "发现开始日期",
    "发现结束日期",
    "发布开始日期",
    "发布结束日期",
    "暂未入选",
    "精选入围",
    "深度分析",
    "感兴趣",
  ])
    expect(html).toContain(label);
  expect(html.match(/type="date"/g)).toHaveLength(4);
  expect(html).not.toContain("近七天发布");
  expect(html).toContain('value="2026-10-18"');
  expect(html).toContain("起止日期均包含在内");
});

it("keeps status and interest active simultaneously and validates dates before a request", () => {
  const state = {
    ...DEFAULT_LIBRARY_FILTERS,
    status_filter: "deep" as const,
    interested_only: true,
  };
  expect(libraryFilterParams(state)).toMatchObject({
    status_filter: "deep",
    interested_only: true,
  });
  expect(libraryFiltersError({ ...state, time_range: "custom" })).toContain(
    "开始日期",
  );
  expect(
    libraryFiltersError({
      ...state,
      time_range: "custom",
      discovered_from: "2026-10-20",
      discovered_to: "2026-10-19",
    }),
  ).toContain("不能晚于");
  expect(
    libraryFiltersError({
      ...state,
      time_range: "custom",
      discovered_from: "2026-10-19",
      discovered_to: "2026-10-19",
    }),
  ).toBeUndefined();
  expect(
    libraryFilterParams({ ...state, discovered_from: "2026-10-19" }),
  ).not.toHaveProperty("discovered_from");
});

it("displays exactly one article state with deep analysis taking precedence over selection", () => {
  const deep = renderToStaticMarkup(
    <LibraryArticleStatus
      article={{ is_selected: true, is_deep_analyzed: true }}
    />,
  );
  expect(deep).toContain("深度分析");
  expect(deep).not.toContain("精选入围");
  expect(deep).not.toContain("暂未入选");
  expect(
    renderToStaticMarkup(
      <LibraryArticleStatus
        article={{ is_selected: true, is_deep_analyzed: false }}
      />,
    ),
  ).toContain("精选入围");
  expect(
    renderToStaticMarkup(
      <LibraryArticleStatus
        article={{ is_selected: false, is_deep_analyzed: false }}
      />,
    ),
  ).toContain("暂未入选");
});

it("sends both date ranges, article state and independent interest to the API", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  await api.listLibrary({
    time_range: "custom",
    discovered_from: "2026-10-18",
    discovered_to: "2026-10-19",
    published_range: "today",
    status_filter: "selected",
    interested_only: true,
    page: 2,
  });
  const url = new URL(fetch.mock.calls[0][0], "http://localhost");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    time_range: "custom",
    discovered_from: "2026-10-18",
    discovered_to: "2026-10-19",
    published_range: "today",
    status_filter: "selected",
    interested_only: "true",
    page: "2",
  });
});

it("shows unselected review buckets with totals and sends the active review filter", async () => {
  const value = {
    ...DEFAULT_LIBRARY_FILTERS,
    status_filter: "unselected" as const,
    review_filter: "scored" as const,
  };
  const html = renderToStaticMarkup(
    <LibraryFilters
      value={value}
      timezone="Asia/Shanghai"
      onChange={() => {}}
      meta={{
        total_count: 8,
        today_count: 3,
        three_days_count: 6,
        published_today_count: 3,
        published_three_days_count: 4,
        unselected_count: 5,
        unreviewed_count: 2,
        scored_count: 3,
        selected_count: 1,
        deep_count: 2,
        interested_count: 2,
      }}
    />,
  );
  expect(html).toContain("暂未入选的审核状态");
  expect(html).toContain("未审核 (2)");
  expect(html).toContain("已评分 (3)");
  expect(html).toContain("调用失败不计为已评分");
  expect(libraryFilterParams(value).review_filter).toBe("scored");
  expect(
    libraryFilterParams({ ...value, status_filter: "selected" }),
  ).not.toHaveProperty("review_filter");
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  await api.listLibrary(libraryFilterParams(value));
  expect(
    new URL(fetch.mock.calls[0][0], "http://localhost").searchParams.get(
      "review_filter",
    ),
  ).toBe("scored");
});

it("displays real scores, task names, reasons and zero values rather than fabricating a score for unreviewed articles", () => {
  const html = renderToStaticMarkup(
    <LibraryAssessments
      timezone="Asia/Shanghai"
      assessments={[
        {
          group_id: "agent",
          group_name: "Agent 工程",
          relevance: 80,
          quality: 90,
          overall: 83,
          reason: "有完整工程实现与证据",
          assessed_at: "2026-10-19T03:00:00Z",
        },
        {
          group_id: "frontend",
          group_name: "前端工程",
          relevance: 0,
          quality: 0,
          overall: 0,
          reason: "主题不相关",
          assessed_at: "2026-10-18T03:00:00Z",
        },
      ]}
    />,
  );
  for (const text of [
    "AI 已评分",
    "Agent 工程",
    "前端工程",
    "相关度",
    "工程质量",
    "83.0",
    "0.0",
    "有完整工程实现与证据",
    "主题不相关",
  ])
    expect(html).toContain(text);
  const none = renderToStaticMarkup(
    <LibraryAssessments timezone="UTC" assessments={[]} />,
  );
  expect(none).toContain("暂无 AI 评分");
  expect(none).not.toContain("0.0");
});
