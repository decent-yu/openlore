import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  Clock3,
  FileClock,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { ArticleReview } from "@openlore/contracts";
import { Button } from "../../components/ui/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { ReviewTags } from "./ReviewTags.js";

export function LibraryAssessments({
  review,
  timezone,
  articleTitle,
}: {
  review: ArticleReview | null;
  timezone: string;
  articleTitle?: string;
}) {
  if (!review || review.status === "queued" || review.status === "running") {
    const running = review?.status === "running";
    const queued = review?.status === "queued";
    const Icon = running ? Loader2 : queued ? Clock3 : FileClock;
    return (
      <div
        role="status"
        aria-label="内容初审"
        className={`inline-flex w-fit items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${running ? "bg-blue-50 text-blue-700" : "bg-neutral-100 text-neutral-500"}`}
      >
        <Icon
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 ${running ? "animate-spin" : ""}`}
        />
        <span>{running ? "正在初审" : queued ? "初审排队中" : "待初审"}</span>
      </div>
    );
  }
  const result = review.status === "succeeded" ? review.result : null;
  const failed = review.status === "failed";
  const time = review.assessed_at
    ? new Date(review.assessed_at).toLocaleString("zh-CN", {
        timeZone: timezone,
        hour12: false,
      })
    : null;
  return (
    <Dialog.Root>
      <section
        aria-label="内容初审"
        className={`space-y-2 rounded-lg border p-3 text-xs ${failed ? "border-red-100 bg-red-50/40" : "border-blue-100 bg-blue-50/40"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap font-medium ${failed ? "text-red-700" : "text-blue-900"}`}
          >
            {failed ? (
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            内容初审 · {failed ? "失败" : "已完成"}
          </span>
          {result && (
            <p className="shrink-0 whitespace-nowrap text-neutral-500">
              内容质量{" "}
              <strong className="text-base text-blue-800">
                {result.quality}
              </strong>
              <span className="text-neutral-400"> / 100</span>
            </p>
          )}
        </div>
        {failed && (
          <p className="line-clamp-2 break-words leading-relaxed text-red-700">
            {review.error_message || "初审未完成，请重试。"}
          </p>
        )}
        {result && (
          <>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p
                    tabIndex={0}
                    className="line-clamp-2 cursor-help break-words font-medium text-neutral-700"
                  >
                    {result.positioning}
                  </p>
                </TooltipTrigger>
                <TooltipContent>{result.positioning}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ReviewTags tags={result.tags} />
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200/60 pt-2">
          <Dialog.Trigger className="text-blue-700 hover:underline">
            {failed ? "查看失败详情" : "查看审核详情"}
          </Dialog.Trigger>
          {time && (
            <time
              dateTime={review.assessed_at!}
              className="text-[10px] text-neutral-400"
            >
              {time}
            </time>
          )}
        </div>
      </section>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-white shadow-2xl">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b p-5">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">
                {failed ? "初审失败详情" : "文章审核详情"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 break-words text-sm text-neutral-500">
                {articleTitle || "内容初审结果与原文证据"}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label="关闭审核详情"
              >
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 space-y-5 overflow-y-auto p-5 text-sm">
            {review.error_message && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 leading-relaxed text-red-700"
              >
                {review.error_message}
              </p>
            )}
            {result && (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-blue-50 p-3">
                  <span className="font-medium text-blue-900">
                    内容初审 · 已完成
                  </span>
                  <span className="text-neutral-600">
                    内容质量{" "}
                    <strong className="text-lg text-blue-800">
                      {result.quality}
                    </strong>{" "}
                    / 100
                  </span>
                </div>
                <section className="space-y-2">
                  <h4 className="font-medium">主题定位</h4>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-neutral-600">
                    {result.positioning}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </section>
                <section className="space-y-2">
                  <h4 className="font-medium">审核简介</h4>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-neutral-600">
                    {result.summary}
                  </p>
                </section>
                <section className="space-y-2">
                  <h4 className="font-medium">评分依据</h4>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-neutral-600">
                    {result.reason}
                  </p>
                </section>
                <section className="space-y-2">
                  <h4 className="font-medium">原文证据</h4>
                  {result.evidence_refs.map((quote, index) => (
                    <blockquote
                      key={index}
                      className="whitespace-pre-wrap break-words rounded-r-md border-l-2 border-blue-200 bg-neutral-50 px-3 py-2 leading-relaxed text-neutral-600"
                    >
                      {quote}
                    </blockquote>
                  ))}
                </section>
              </>
            )}
            {time && (
              <p className="text-xs text-neutral-400">初审时间：{time}</p>
            )}
          </div>
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t bg-neutral-50 px-5 py-3">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm">
                关闭
              </Button>
            </Dialog.Close>
            {review.log_id && (
              <Link
                to={`/runs?tab=ai&call=${encodeURIComponent(review.log_id)}`}
                className="inline-flex h-8 items-center rounded-md bg-neutral-900 px-3 text-xs font-medium text-white hover:bg-neutral-800"
              >
                查看初审记录 →
              </Link>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
