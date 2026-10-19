import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Heart, ExternalLink } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { WikiReadingLinks } from "../../components/WikiReadingLinks.js";
import { useDialog } from "../../lib/useDialog.js";

export function DailyFeedPage() {
  const client = useQueryClient();
  const [groupId, setGroupId] = useState("");
  const [date, setDate] = useState("");
  const [report, setReport] = useState<{
    title: string;
    markdown: string;
    wikiUrl?: string;
    articleUrl?: string;
  } | null>(null);
  useDialog(Boolean(report), () => setReport(null));
  const {
    data: feed,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["daily-feed", groupId, date],
    queryFn: () => api.getDailyFeed(groupId || undefined, date || undefined),
    refetchInterval: 10000,
  });
  const run = useMutation({
    mutationFn: api.triggerGroupRun,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["daily-feed"] });
      client.invalidateQueries({ queryKey: ["runs"] });
    },
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
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">每日研报</h2>
          <p className="mt-1 text-sm text-neutral-500">
            只展示调研完成并成功归档的文章，按归档日期阅读。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="流水线任务"
            value={groupId || feed?.group?.id || ""}
            onChange={(e) => {
              setGroupId(e.target.value);
              setDate("");
            }}
            className="h-9 rounded-md border bg-white px-3 text-sm"
          >
            <option value="" disabled>
              选择任务
            </option>
            {feed?.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            aria-label="研报归档日期"
            value={date || feed?.date || ""}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border bg-white px-3 text-sm"
          >
            {feed?.available_dates.map((day) => (
              <option key={day}>{day}</option>
            ))}
          </select>
          <Button
            disabled={!feed?.group || running || run.isPending}
            onClick={() => run.mutate(feed!.group!.id)}
          >
            {running ? "任务运行中" : "立即运行"}
          </Button>
        </div>
      </header>
      {(error || run.error || interest.error) && (
        <p
          role="alert"
          className="rounded border bg-red-50 p-3 text-sm text-red-700"
        >
          {error?.message || run.error?.message || interest.error?.message}
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
        <div className="grid grid-cols-3 gap-3">
          {[
            ["内容池", feed.stats.pool_count],
            ["未完成调研", feed.stats.pending_count],
            ["当日已归档研报", feed.stats.deep_analyzed_count],
          ].map(([label, count]) => (
            <div key={label} className="rounded-lg border bg-white p-4">
              <p className="text-xs text-neutral-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{count}</p>
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
            候选文章不受发现日期限制，由 AI 根据共享评分与简介选文。未完成归档的文章请在内容池或运行记录查看。
          </p>
          <Link
            to="/pool"
            className="mt-4 inline-block text-sm text-blue-700 underline"
          >
            查看内容池与评分
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {feed.deep_articles.map((article) => (
            <article
              key={article.id}
              className="flex flex-col gap-3 rounded-xl border bg-white p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold leading-relaxed">
                  {article.research?.wiki_url ? (
                    <a
                      href={article.research.wiki_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-blue-700 hover:underline"
                    >
                      {article.title}
                    </a>
                  ) : (
                    article.title
                  )}
                </h3>
                <button
                  type="button"
                  aria-label={
                    article.user_interested ? "取消感兴趣" : "标为感兴趣"
                  }
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
              <p className="text-xs text-neutral-500">
                {article.group_name} · 深度分析已归档
              </p>
              {article.summary && (
                <p className="text-sm leading-relaxed text-neutral-600">
                  {article.summary}
                </p>
              )}
              <WikiReadingLinks
                articleUrl={article.wiki_url}
                researchUrl={article.research?.wiki_url}
              />
              <div className="mt-auto flex flex-wrap items-center gap-3 border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setReport({
                      title: article.title,
                      markdown: article.research!.report_markdown,
                      wikiUrl: article.research?.wiki_url,
                      articleUrl: article.wiki_url,
                    })
                  }
                >
                  <BookOpen className="mr-1 h-3 w-3" />
                  阅读研报
                </Button>
                {article.original_url && (
                  <a
                    href={article.original_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-neutral-500"
                  >
                    原文
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {article.delivery?.commit_url && (
                  <a
                    href={article.delivery.commit_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-neutral-500 hover:underline"
                  >
                    GitHub 归档
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {report && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={report.title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-neutral-50 p-4">
              <h3 className="font-semibold">{report.title}</h3>
              <div className="flex gap-3">
                <WikiReadingLinks
                  researchUrl={report.wikiUrl}
                  articleUrl={report.articleUrl}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setReport(null)}
                >
                  关闭
                </Button>
              </div>
            </header>
            <div className="prose prose-sm max-w-none overflow-y-auto p-6">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {report.markdown}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
