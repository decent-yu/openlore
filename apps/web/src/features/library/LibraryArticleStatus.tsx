import React from "react";
import type { LibraryArticle } from "@openlore/contracts";
import { Badge } from "../../components/ui/badge.js";
export function LibraryArticleStatus({
  article,
}: {
  article: Pick<LibraryArticle, "is_deep_analyzed" | "review"> & Partial<Pick<LibraryArticle, "task_type" | "research">>;
}) {
  if (article.task_type === 'repository_research') {
    const status = article.research?.status;
    const label = article.is_deep_analyzed ? '已归档' : status === 'succeeded' ? '研报待归档' : status === 'running' || status === 'queued' ? '研读中' : status === 'failed' ? '研读失败' : status === 'cancelled' ? '已取消' : '待研读';
    return <Badge variant="outline" className="text-[10px] font-normal">{label}</Badge>;
  }
  if (article.is_deep_analyzed)
    return (
      <Badge className="border-purple-300 bg-purple-50 text-[10px] font-normal text-purple-700">
        深度分析
      </Badge>
    );
  if (article.review?.status === "succeeded")
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
