import React from "react";
import { ExternalLink } from "lucide-react";

export function WikiReadingLinks({
  articleUrl,
  researchUrl,
}: {
  articleUrl?: string;
  researchUrl?: string;
}) {
  if (!articleUrl && !researchUrl) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {researchUrl && (
        <a
          href={researchUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
        >
          Wiki 研报
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {articleUrl && (
        <a
          href={articleUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-blue-700 hover:underline"
        >
          Wiki 正文
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
