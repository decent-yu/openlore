import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BookOpen, CalendarDays } from "lucide-react";
import { LibraryArticleSchema } from "@openlore/contracts";
import { api } from "../../lib/api.js";
import { LibraryArticleCard } from "../library/LibraryArticleCard.js";
import { useArticleActions } from "../library/useArticleActions.js";

export function DailyFeedPage() {
  const client = useQueryClient();
  const actions = useArticleActions();
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  });
  const timezone = settings?.timezone || "Asia/Shanghai";
  const [date, setDate] = useState("");
  const {
    data: feed,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["daily-feed", "", date],
    queryFn: () => api.getDailyFeed(undefined, date || undefined),
    refetchInterval: 10000,
  });
  const sourcesMap = React.useMemo(
    () =>
      new Map(
        (feed?.deep_articles || []).flatMap((article) =>
          article.sources.map((source) => [source.id, source.name] as const),
        ),
      ),
    [feed],
  );
  const interest = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      api.toggleArticleInterest(id, { interested: value }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["daily-feed"] });
      client.invalidateQueries({ queryKey: ["library"] });
    },
  });
  const running = feed?.current_run?.status === "running";
  const sections = (feed?.groups || [])
    .map((group) => ({
      ...group,
      articles: feed!.deep_articles.filter(
        (article) => article.group_id === group.id,
      ),
    }))
    .filter((group) => group.articles.length > 0);
  return (
    <div className="space-y-6">
      {actions.message && (
        <p role="status" className="rounded-lg border bg-blue-50 p-3 text-sm">
          {actions.message}
        </p>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">每日研报</h2>
          <p className="mt-1 text-sm text-neutral-500">
            汇集所有任务的已归档研报，按任务分类阅读。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-neutral-500">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
            <select
              aria-label="研报归档日期"
              value={date || feed?.date || ""}
              onChange={(e) => setDate(e.target.value)}
              className="min-w-0 bg-transparent text-sm text-neutral-700 outline-none"
            >
              {!feed?.available_dates.length && (
                <option value="">归档日期</option>
              )}
              {feed?.available_dates.map((day) => (
                <option key={day}>{day}</option>
              ))}
            </select>
          </label>
          <Link
            to="/pipelines"
            className="inline-flex h-9 items-center rounded-md border bg-white px-3 text-sm font-medium hover:bg-neutral-100"
          >
            管理任务
          </Link>
        </div>
      </header>
      {(error || interest.error || actions.reviewMutation.error) && (
        <p
          role="alert"
          className="rounded border bg-red-50 p-3 text-sm text-red-700"
        >
          {error?.message ||
            interest.error?.message ||
            actions.reviewMutation.error?.message}
        </p>
      )}
      {running && (
        <p
          role="status"
          className="rounded border bg-blue-50 p-3 text-sm text-blue-800"
        >
          正在选文、调研或归档，完成后自动更新。
          <Link to="/runs" className="ml-2 underline">
            查看运行记录
          </Link>
        </p>
      )}
      {feed && (
        <div className="grid grid-cols-3 divide-x rounded-xl border bg-white py-3">
          {[
            ["内容池", feed.stats.pool_count],
            ["未完成调研", feed.stats.pending_count],
            ["当日已归档研报", feed.stats.deep_analyzed_count],
          ].map(([label, count]) => (
            <div key={label} className="min-w-0 px-3 sm:px-5">
              <p className="text-xs text-neutral-500">{label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{count}</p>
            </div>
          ))}
        </div>
      )}
      {isLoading ? (
        <p className="py-12 text-center text-neutral-400">加载中…</p>
      ) : !feed?.deep_articles.length ? (
        <div className="rounded-xl border border-dashed bg-white p-10 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-neutral-300" />
          <p className="mt-3 font-medium">当天暂无已归档研报</p>
          <p className="mt-2 text-sm text-neutral-500">
            可切换归档日期，未归档的文章请在内容池查看。
          </p>
          <Link
            to="/pool"
            className="mt-4 inline-block text-sm text-blue-700 underline"
          >
            查看内容池与评分
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {sections.map((group) => (
            <section
              key={group.id}
              aria-labelledby={`feed-group-${group.id}`}
              className="@container space-y-4"
            >
              <header className="flex items-center gap-3">
                <h3
                  id={`feed-group-${group.id}`}
                  className="min-w-0 break-words text-base font-semibold"
                >
                  {group.name}
                </h3>
                <span className="shrink-0 text-xs text-neutral-400">
                  {group.articles.length} 篇研报
                </span>
                <div
                  aria-hidden="true"
                  className="h-px flex-1 bg-neutral-200"
                />
              </header>
              <div className="grid grid-cols-1 gap-4 @min-[35rem]:grid-cols-2 @min-[53rem]:grid-cols-3">
                {group.articles.map((article) => {
                  const cardArticle = LibraryArticleSchema.parse({
                    ...article,
                    canonical_url: article.original_url,
                    sources: article.sources.map((source) => source.id),
                    groups: [
                      { id: article.group_id, name: article.group_name },
                    ],
                  });
                  return (
                    <LibraryArticleCard
                      key={`${article.group_id}:${article.id}`}
                      article={cardArticle}
                      timezone={timezone}
                      sourcesMap={sourcesMap}
                      summary={article.summary}
                      reviewPending={actions.reviewMutation.isPending}
                      onToggleInterest={() =>
                        interest.mutate({
                          id: article.id,
                          value: !article.user_interested,
                        })
                      }
                      onReview={() => actions.reviewArticle(cardArticle)}
                      onResearch={() => actions.openResearch(cardArticle)}
                      onViewReport={() => actions.openReport(cardArticle)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {actions.dialogs}
    </div>
  );
}
