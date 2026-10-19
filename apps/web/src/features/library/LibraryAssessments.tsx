import React from "react";
import { Link } from "react-router-dom";
import type { ArticleReview } from "@openlore/contracts";

export function LibraryAssessments({
  review,
  timezone,
}: {
  review: ArticleReview | null;
  timezone: string;
}) {
  if (!review) return <p className="text-xs text-neutral-400">待初审</p>;
  const result = review.result;
  return (
    <section
      aria-label="内容初审"
      className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-blue-900">
          内容初审 ·{" "}
          {
            {
              queued: "排队中",
              running: "审核中",
              succeeded: "已完成",
              failed: "失败",
            }[review.status]
          }
        </span>
        {review.log_id && (
          <Link
            className="text-blue-700 hover:underline"
            to={`/runs?tab=ai&call=${encodeURIComponent(review.log_id)}`}
          >
            查看初审记录
          </Link>
        )}
      </div>
      {review.error_message && (
        <p className="text-red-700">{review.error_message}</p>
      )}
      {review.status === "succeeded" && result && (
        <>
          <p>
            内容质量{" "}
            <strong className="text-base text-blue-800">
              {result.quality}
            </strong>
            <span className="text-neutral-400"> / 100</span>
          </p>
          <p className="font-medium text-neutral-700">{result.positioning}</p>
          <div className="flex flex-wrap gap-1">
            {result.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-white px-1.5 py-0.5 text-neutral-600"
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="leading-relaxed text-neutral-600">{result.summary}</p>
          <details>
            <summary className="cursor-pointer text-neutral-500">
              评分依据与原文证据
            </summary>
            <p className="mt-2">{result.reason}</p>
            {result.evidence_refs.map((quote, i) => (
              <blockquote
                key={i}
                className="mt-2 border-l-2 pl-2 text-neutral-500"
              >
                {quote}
              </blockquote>
            ))}
          </details>
        </>
      )}
      {review.assessed_at && (
        <p className="text-[10px] text-neutral-400">
          {new Date(review.assessed_at).toLocaleString("zh-CN", {
            timeZone: timezone,
            hour12: false,
          })}
        </p>
      )}
    </section>
  );
}
