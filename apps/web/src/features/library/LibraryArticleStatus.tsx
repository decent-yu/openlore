import React from "react";
import type { LibraryArticle } from "@openlore/contracts";
import { Badge } from "../../components/ui/badge.js";

export function LibraryArticleStatus({
  article,
}: {
  article: Pick<LibraryArticle, "is_selected" | "is_deep_analyzed">;
}) {
  if (article.is_deep_analyzed)
    return (
      <Badge className="border-purple-300 bg-purple-50 text-[10px] font-normal text-purple-700">
        深度分析
      </Badge>
    );
  if (article.is_selected)
    return (
      <Badge className="border-amber-300 bg-amber-50 text-[10px] font-normal text-amber-700">
        精选入围
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="text-[10px] font-normal text-neutral-500"
    >
      暂未入选
    </Badge>
  );
}
