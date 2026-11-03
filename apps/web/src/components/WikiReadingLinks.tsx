import React from "react";
import { ExternalLink } from "lucide-react";

export function WikiReadingLinks({
  originalUrl,
  researchUrl,
  originalLabel = "原文链接",
}: {
  originalUrl?: string | null;
  originalLabel?: string;
  researchUrl?: string;
}) {
  if (!originalUrl && !researchUrl) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {[
        [originalLabel, originalUrl],
        ["Wiki 研报", researchUrl],
      ].map(
        ([label, url]) =>
          url && (
            <a
              key={label}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-normal leading-5 text-blue-600 underline-offset-2 transition-colors hover:text-blue-800 hover:underline"
            >
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              {label}
            </a>
          ),
      )}
    </div>
  );
}
