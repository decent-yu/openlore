import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Heart,
  ExternalLink,
  CalendarDays,
  CheckCircle2,
  MoreHorizontal,
  Rss,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";

export function DailyFeedPage() {
  const client = useQueryClient();
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
      {(error || interest.error) && (
        <p
          role="alert"
          className="rounded border bg-red-50 p-3 text-sm text-red-700"
        >
          {error?.message || interest.error?.message}
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
        <TooltipProvider delayDuration={300}>
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
                  {group.articles.map((article) => (
                    <article
                      key={`${article.group_id}:${article.id}`}
                      className="flex min-w-0 flex-col rounded-xl border bg-white p-4 transition-shadow hover:shadow-sm sm:p-5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <h4
                              tabIndex={
                                article.research?.wiki_url ? undefined : 0
                              }
                              className="min-w-0 flex-1 truncate text-base font-semibold leading-8"
                            >
                              {article.research?.wiki_url ? (
                                <a
                                  href={article.research.wiki_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block truncate hover:text-blue-700 hover:underline"
                                >
                                  {article.title}
                                </a>
                              ) : (
                                article.title
                              )}
                            </h4>
                          </TooltipTrigger>
                          <TooltipContent>{article.title}</TooltipContent>
                        </Tooltip>
                        <button
                          type="button"
                          aria-label={
                            article.user_interested
                              ? "取消感兴趣"
                              : "标为感兴趣"
                          }
                          aria-pressed={article.user_interested}
                          className="-mr-1 shrink-0 rounded-md p-2 transition-colors hover:bg-neutral-100"
                          onClick={() =>
                            interest.mutate({
                              id: article.id,
                              value: !article.user_interested,
                            })
                          }
                        >
                          <Heart
                            className={`h-4 w-4 ${article.user_interested ? "fill-rose-500 text-rose-500" : "text-neutral-400"}`}
                          />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-neutral-500"
                          title="发布时间"
                        >
                          <CalendarDays
                            className="h-2.5 w-2.5 shrink-0"
                            aria-hidden="true"
                          />
                          {article.published_at ? (
                            <time
                              dateTime={article.published_at}
                              aria-label="发布时间"
                            >
                              发布：
                              {new Date(
                                article.published_at,
                              ).toLocaleDateString("zh-CN", {
                                timeZone: timezone,
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              })}
                            </time>
                          ) : (
                            "无发布日期"
                          )}
                        </span>
                        {article.sources.map((source) => (
                          <span
                            key={source.id}
                            title={`采集来源：${source.name}`}
                            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50/50 px-2 py-0.5 text-emerald-700"
                          >
                            <Rss
                              className="h-2.5 w-2.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="truncate">{source.name}</span>
                          </span>
                        ))}
                      </div>
                      {article.summary && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p
                              tabIndex={0}
                              className="mt-3 line-clamp-2 cursor-help break-words text-sm leading-relaxed text-neutral-500"
                            >
                              {article.summary}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent>{article.summary}</TooltipContent>
                        </Tooltip>
                      )}
                      <div className="mt-auto pt-4">
                        <div className="flex items-center justify-between gap-2 border-t border-neutral-100 pt-3">
                          <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400">
                            <CheckCircle2
                              className="h-3 w-3 text-emerald-600"
                              aria-hidden="true"
                            />
                            已归档
                          </span>
                          <div className="flex items-center gap-1">
                            {article.research?.wiki_url ? (
                              <a
                                href={article.research.wiki_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white px-3 text-xs font-medium shadow-sm transition-colors hover:bg-neutral-100"
                              >
                                <BookOpen className="mr-1 h-3 w-3" />
                                阅读研报
                              </a>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled
                                title="暂无 Wiki 阅读链接"
                              >
                                <BookOpen className="mr-1 h-3 w-3" />
                                阅读研报
                              </Button>
                            )}
                            {(article.original_url ||
                              article.wiki_url ||
                              article.research?.wiki_url ||
                              article.delivery?.commit_url) && (
                              <DropdownMenu.Root>
                                <DropdownMenu.Trigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-neutral-500"
                                    aria-label={`更多链接：${article.title}`}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Portal>
                                  <DropdownMenu.Content
                                    align="end"
                                    sideOffset={6}
                                    collisionPadding={12}
                                    className="z-50 min-w-36 rounded-lg border bg-white p-1 shadow-lg"
                                  >
                                    {[
                                      ["Wiki 研报", article.research?.wiki_url],
                                      ["Wiki 正文", article.wiki_url],
                                      ["原文", article.original_url],
                                      [
                                        "GitHub 归档",
                                        article.delivery?.commit_url,
                                      ],
                                    ].map(
                                      ([label, url]) =>
                                        url && (
                                          <DropdownMenu.Item
                                            key={label}
                                            asChild
                                          >
                                            <a
                                              href={url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="flex items-center justify-between gap-4 rounded-md px-3 py-2 text-xs text-neutral-600 outline-none data-[highlighted]:bg-neutral-100"
                                            >
                                              {label}
                                              <ExternalLink className="h-3 w-3" />
                                            </a>
                                          </DropdownMenu.Item>
                                        ),
                                    )}
                                  </DropdownMenu.Content>
                                </DropdownMenu.Portal>
                              </DropdownMenu.Root>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
