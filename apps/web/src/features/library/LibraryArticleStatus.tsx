import React from "react";
import type { LibraryArticle } from "@openlore/contracts";
import { Badge } from "../../components/ui/badge.js";
export function LibraryArticleStatus({
  article,
}: {
  article: Pick<LibraryArticle, "is_deep_analyzed" | "assessments">;
}) {
  if (article.is_deep_analyzed)
    return (
      <Badge className="border-purple-300 bg-purple-50 text-[10px] font-normal text-purple-700">
        深度分析
      </Badge>
    );
  if (article.assessments.length)
    return (
      <Badge className="border-blue-200 bg-blue-50 text-[10px] font-normal text-blue-700">
        已评分
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="text-[10px] font-normal text-neutral-500"
    >
      未审核
    </Badge>
  );
}
