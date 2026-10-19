import React from "react";
import { MemoryRouter } from "react-router-dom";
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
it("shows insufficient material separately from AI failure and does not invent a quality score", () => {
  const html = renderToStaticMarkup(
    <LibraryAssessments
      timezone="Asia/Shanghai"
      review={{
        status: "insufficient",
        result: null,
        error_message: null,
        assessed_at: null,
        log_id: null,
        material_issue: "正文只有日期与导航",
      }}
    />,
  );
  expect(html).toContain("材料不足 · 未调用 AI");
  expect(html).toContain("正文只有日期与导航");
  expect(html).not.toContain("/ 100");
  expect(html).not.toContain("初审失败");
});
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
    "未审核",
    "已评分",
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
    <LibraryArticleStatus article={{ review: null, is_deep_analyzed: true }} />,
  );
  expect(deep).toContain("深度分析");
  expect(deep).not.toContain("已评分");
  expect(deep).not.toContain("未审核");
  expect(
    renderToStaticMarkup(
      <LibraryArticleStatus
        article={{
          review: {
            status: "succeeded",
            result: null,
            error_message: null,
            assessed_at: null,
            log_id: null,
          },
          is_deep_analyzed: false,
        }}
      />,
    ),
  ).toContain("已评分");
  expect(
    renderToStaticMarkup(
      <LibraryArticleStatus
        article={{ review: null, is_deep_analyzed: false }}
      />,
    ),
  ).toContain("未审核");
});

it("sends both date ranges, article state and independent interest to the API", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  await api.listLibrary({
    time_range: "custom",
    discovered_from: "2026-10-18",
    discovered_to: "2026-10-19",
    published_range: "today",
    status_filter: "scored",
    interested_only: true,
    page: 2,
  });
  const url = new URL(fetch.mock.calls[0][0], "http://localhost");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    time_range: "custom",
    discovered_from: "2026-10-18",
    discovered_to: "2026-10-19",
    published_range: "today",
    status_filter: "scored",
    interested_only: "true",
    page: "2",
  });
});

it("shows independent unreviewed, scored and archived states with counts", () => {
  const html = renderToStaticMarkup(
    <LibraryFilters
      value={DEFAULT_LIBRARY_FILTERS}
      timezone="UTC"
      onChange={() => {}}
      meta={{
        total_count: 8,
        today_count: 3,
        three_days_count: 6,
        published_today_count: 3,
        published_three_days_count: 4,
        unreviewed_count: 4,
        scored_count: 2,
        deep_count: 2,
        interested_count: 2,
      }}
    />,
  );
  expect(html).toContain("未审核");
  expect(html).toContain("已评分");
  expect(html).not.toContain("暂未入选");
  expect(html).not.toContain("精选入围");
});

it("shows a compact review preview while reserving detailed evidence and logs for the dialog", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <LibraryAssessments
        timezone="UTC"
        review={{
          status: "succeeded",
          error_message: null,
          log_id: "review-log",
          assessed_at: "2026-10-19T03:00:00Z",
          result: {
            quality: 0,
            positioning: "数据库性能",
            summary: "问题、方法和局限",
            tags: ["数据库"],
            reason: "证据不足",
            evidence_refs: ["A complete original sentence from the article."],
          },
        }}
      />
    </MemoryRouter>,
  );
  for (const text of ["内容质量", "数据库性能", "查看审核详情"])
    expect(html).toContain(text);
  for (const text of [
    "问题、方法和局限",
    "证据不足",
    "查看初审记录",
    "review-log",
  ])
    expect(html).not.toContain(text);
  expect(html).not.toContain("相关度");
  const none = renderToStaticMarkup(
    <LibraryAssessments timezone="UTC" review={null} />,
  );
  expect(none).toContain("待初审");
  expect(none).not.toContain("内容质量");
});
