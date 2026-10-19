import React from "react";
import { Heart, type LucideIcon, Clock, CalendarDays } from "lucide-react";
import {
  LibraryQuerySchema,
  type LibraryFilterParams,
  type LibraryResponse,
  type LibraryTimeRange,
  type LibraryStatusFilter,
  type LibraryReviewFilter,
} from "@openlore/contracts";

export interface LibraryFiltersState {
  time_range: LibraryTimeRange;
  discovered_from: string;
  discovered_to: string;
  published_range: LibraryTimeRange;
  published_from: string;
  published_to: string;
  status_filter: LibraryStatusFilter;
  review_filter: LibraryReviewFilter;
  interested_only: boolean;
}
export const DEFAULT_LIBRARY_FILTERS: LibraryFiltersState = {
  time_range: "all",
  discovered_from: "",
  discovered_to: "",
  published_range: "all",
  published_from: "",
  published_to: "",
  status_filter: "all",
  review_filter: "all",
  interested_only: false,
};

export function libraryFilterParams(
  value: LibraryFiltersState,
): LibraryFilterParams {
  return {
    time_range: value.time_range,
    published_range: value.published_range,
    status_filter: value.status_filter,
    ...(value.status_filter === "unselected"
      ? { review_filter: value.review_filter }
      : {}),
    interested_only: value.interested_only,
    ...(value.time_range === "custom"
      ? {
          discovered_from: value.discovered_from || undefined,
          discovered_to: value.discovered_to || undefined,
        }
      : {}),
    ...(value.published_range === "custom"
      ? {
          published_from: value.published_from || undefined,
          published_to: value.published_to || undefined,
        }
      : {}),
  };
}
export function libraryFiltersError(
  value: LibraryFiltersState,
): string | undefined {
  const result = LibraryQuerySchema.safeParse({
    ...libraryFilterParams(value),
    interested_only: String(value.interested_only),
  });
  return result.success ? undefined : result.error.issues[0].message;
}

function TimeRow({
  label,
  noun,
  icon: Icon,
  range,
  from,
  to,
  todayCount,
  recentCount,
  totalCount,
  onChange,
}: {
  label: string;
  noun: string;
  icon: LucideIcon;
  range: LibraryTimeRange;
  from: string;
  to: string;
  todayCount?: number;
  recentCount?: number;
  totalCount?: number;
  onChange: (range: LibraryTimeRange, from: string, to: string) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs"
      role="group"
      aria-label={label}
    >
      <span className="flex w-20 shrink-0 items-center gap-1.5 font-medium text-neutral-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-neutral-100 p-0.5">
        {(
          [
            ["all", `全部${totalCount == null ? "" : ` (${totalCount})`}`],
            [
              "today",
              `今天${noun}${todayCount == null ? "" : ` (${todayCount})`}`,
            ],
            [
              "3days",
              `近三天${noun}${recentCount == null ? "" : ` (${recentCount})`}`,
            ],
            ["custom", "具体时间"],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            type="button"
            aria-pressed={range === key}
            onClick={() => onChange(key, from, to)}
            className={`rounded-md px-3 py-1 font-medium ${range === key ? "bg-white text-neutral-900 shadow-xs" : "text-neutral-600 hover:text-neutral-900"}`}
          >
            {text}
          </button>
        ))}
      </div>
      {range === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label={`${noun}开始日期`}
            value={from}
            max={to || undefined}
            onChange={(event) => onChange("custom", event.target.value, to)}
            className="h-8 rounded-md border border-neutral-200 bg-white px-2"
          />
          <span className="text-neutral-400">至</span>
          <input
            type="date"
            aria-label={`${noun}结束日期`}
            value={to}
            min={from || undefined}
            onChange={(event) => onChange("custom", from, event.target.value)}
            className="h-8 rounded-md border border-neutral-200 bg-white px-2"
          />
        </div>
      )}
    </div>
  );
}

export function LibraryFilters({
  value,
  meta,
  timezone,
  onChange,
}: {
  value: LibraryFiltersState;
  meta?: LibraryResponse["filter_meta"];
  timezone: string;
  onChange: (value: LibraryFiltersState) => void;
}) {
  const error = libraryFiltersError(value);
  return (
    <div className="space-y-3.5">
      <TimeRow
        label="发现时间"
        noun="发现"
        icon={Clock}
        range={value.time_range}
        from={value.discovered_from}
        to={value.discovered_to}
        todayCount={meta?.today_count}
        recentCount={meta?.three_days_count}
        totalCount={meta?.total_count}
        onChange={(range, from, to) =>
          onChange({
            ...value,
            time_range: range,
            discovered_from: from,
            discovered_to: to,
          })
        }
      />
      <TimeRow
        label="发布时间"
        noun="发布"
        icon={CalendarDays}
        range={value.published_range}
        from={value.published_from}
        to={value.published_to}
        todayCount={meta?.published_today_count}
        recentCount={meta?.published_three_days_count}
        totalCount={meta?.total_count}
        onChange={(range, from, to) =>
          onChange({
            ...value,
            published_range: range,
            published_from: from,
            published_to: to,
          })
        }
      />
      <p className="pl-0 text-[11px] text-neutral-500 sm:pl-[88px]">
        日期按 {timezone}{" "}
        计算；起止日期均包含在内，选择相同日期可查看当天。近三天为最近 72
        小时，两行条件同时生效。
      </p>
      {error && (
        <p role="alert" className="text-xs text-amber-700">
          {error}
        </p>
      )}
      <div
        role="group"
        aria-label="属性标签"
        className="flex flex-wrap items-center gap-2 text-xs"
      >
        <span className="w-20 shrink-0 font-medium text-neutral-500">
          属性标签
        </span>
        {(
          [
            [
              "all",
              "全部",
              meta
                ? meta.unselected_count + meta.selected_count + meta.deep_count
                : undefined,
            ],
            ["unselected", "暂未入选", meta?.unselected_count],
            ["selected", "精选入围", meta?.selected_count],
            ["deep", "深度分析", meta?.deep_count],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value.status_filter === key}
            onClick={() =>
              onChange({ ...value, status_filter: key, review_filter: "all" })
            }
            className={`rounded-md border px-3 py-1 font-medium ${value.status_filter === key ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"}`}
          >
            {label}
            {count == null ? "" : ` (${count})`}
          </button>
        ))}
        <span
          aria-hidden="true"
          className="mx-1 h-5 border-l border-neutral-300"
        />
        <button
          type="button"
          aria-pressed={value.interested_only}
          onClick={() =>
            onChange({ ...value, interested_only: !value.interested_only })
          }
          className={`inline-flex items-center gap-1 rounded-md border px-3 py-1 font-medium ${value.interested_only ? "border-rose-600 bg-rose-600 text-white" : "border-rose-200 bg-white text-rose-700"}`}
        >
          <Heart className="h-3 w-3" />
          感兴趣{meta ? ` (${meta.interested_count})` : ""}
        </button>
      </div>
      {value.status_filter === "unselected" && (
        <div
          role="group"
          aria-label="暂未入选的审核状态"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs sm:ml-[88px]"
        >
          <span className="mr-1 font-medium text-neutral-500">AI 审核</span>
          {(
            [
              ["all", "全部", meta?.unselected_count],
              ["unreviewed", "未审核", meta?.unreviewed_count],
              ["scored", "已评分", meta?.scored_count],
            ] as const
          ).map(([key, label, count]) => (
            <button
              type="button"
              key={key}
              aria-pressed={value.review_filter === key}
              onClick={() => onChange({ ...value, review_filter: key })}
              className={`rounded-md border px-3 py-1 ${value.review_filter === key ? "border-blue-600 bg-blue-50 text-blue-800" : "border-neutral-200 text-neutral-600"}`}
            >
              {label}
              {count == null ? "" : ` (${count})`}
            </button>
          ))}
          <p className="w-full text-[11px] text-neutral-500">
            未审核表示暂无有效评分；调用失败不计为已评分。已评分可能未达门槛，也可能因精选名额限制而暂未入选。
          </p>
        </div>
      )}
    </div>
  );
}
