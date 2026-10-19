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
