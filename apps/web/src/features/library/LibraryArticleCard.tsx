import React from "react";
import { repositoryStudy, parseGitHubRepository } from "@openlore/contracts";
import type { LibraryArticle } from "@openlore/contracts";
import { Clock, Heart, Loader2, Rss, Github } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../../components/ui/card.js";
import { Badge } from "../../components/ui/badge.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { WikiReadingLinks } from "../../components/WikiReadingLinks.js";
import { LibraryAssessments } from "./LibraryAssessments.js";
import { LibraryArticleStatus } from "./LibraryArticleStatus.js";
import { LibraryArticleActions } from "./LibraryArticleActions.js";

function formatPoolTime(iso: string, timezone: string) {
  if (!iso) return "未知时间";
  try {
    const d = new Date(iso);
    const now = new Date();
    const dateOptions: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    const isToday =
      d.toLocaleDateString("zh-CN", dateOptions) ===
      now.toLocaleDateString("zh-CN", dateOptions);
    const timeStr = d.toLocaleTimeString("zh-CN", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    if (isToday) return `今天 ${timeStr}`;
    return `${d.toLocaleDateString("zh-CN", dateOptions)} ${timeStr}`;
  } catch {
    return iso;
  }
}

export function LibraryArticleCard({
  article: art,
  timezone,
  sourcesMap,
  summary,
  reviewPending,
  onToggleInterest,
  onReview,
  onResearch,
  onViewReport,
}: {
  article: LibraryArticle;
  timezone: string;
  sourcesMap: Map<string, string>;
  summary?: string;
  reviewPending: boolean;
  onToggleInterest: () => void;
  onReview: () => void;
  onResearch: () => void;
  onViewReport: () => void;
}) {
  const isRepository = art.task_type === 'repository_research';
  const study = isRepository ? repositoryStudy(art.date_evidence) : undefined;
  const repo = study && parseGitHubRepository(study.repository_url);
  const title = isRepository && !art.research?.report_markdown ? `${repo?.repo || art.title} · 仓库研读` : art.title;
  return (
    <Card
      data-article-id={art.id}
      className="flex min-w-0 flex-col hover:shadow-xs transition-shadow"
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 flex-1 min-w-0">
            <CardTitle className="text-base font-semibold leading-snug">
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {art.research?.wiki_url || art.wiki_url ? (
                      <a
                        href={art.research?.wiki_url || art.wiki_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate hover:text-blue-700 hover:underline"
                      >
                        {title}
                      </a>
                    ) : (
                      <span tabIndex={0} className="block truncate cursor-help">
                        {title}
                      </span>
                    )}
                  </TooltipTrigger>
                  <TooltipContent>{title}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
            {isRepository ? <CardDescription className="flex items-center gap-1.5 text-xs text-neutral-500"><Github className="h-3.5 w-3.5" />{repo ? `${repo.owner}/${repo.repo}` : 'GitHub 仓库'}</CardDescription> :             <CardDescription className="flex min-w-0 items-center gap-2 text-xs text-neutral-500">
              <span
                className="min-w-0 truncate"
                title={art.author || "未知作者"}
              >
                {art.author || "未知作者"}
              </span>
              <span className="shrink-0">·</span>
              <span className="shrink-0 whitespace-nowrap">
                首发：
                {art.published_at
                  ? new Date(art.published_at).toLocaleDateString("zh-CN", {
                      timeZone: timezone,
                    })
                  : "无发布日期"}
              </span>
            </CardDescription>}
          </div>

          {/* Top Right Action & Favorite */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onToggleInterest}
              className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors"
              title={
                art.user_interested ? "已标为感兴趣（点击取消）" : "标为感兴趣"
              }
            >
              <Heart
                className={`h-4 w-4 transition-colors ${
                  art.user_interested
                    ? "fill-rose-500 text-rose-500"
                    : "text-neutral-300 hover:text-neutral-500"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Badges Bar */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2">
          <Badge variant="outline" className="text-[10px] font-normal">{isRepository ? "仓库研读" : "文章调研"}</Badge>
          {/* 入池时间 */}
          <Badge
            variant="outline"
            className="text-[10px] text-neutral-500 bg-neutral-50 border-neutral-200 font-normal"
          >
            <Clock className="w-2.5 h-2.5 mr-1 text-neutral-400 inline" />
            {isRepository ? '创建' : '发现'}: {formatPoolTime(art.created_at, timezone)}
          </Badge>

          {/* 采集来源标签 */}
          {art.sources?.map((srcId) => (
            <Badge
              key={srcId}
              variant="outline"
              className="text-[10px] text-emerald-700 bg-emerald-50/50 border-emerald-200 font-normal"
              title={`采集来源: ${sourcesMap.get(srcId) || srcId}`}
            >
              {isRepository ? <Github className="w-2.5 h-2.5 mr-0.5 inline" /> : <Rss className="w-2.5 h-2.5 mr-0.5 text-emerald-600 inline" />}
              {sourcesMap.get(srcId) || srcId}
            </Badge>
          ))}

          {/* 流水线任务标签 */}
          {art.groups?.map((g) => (
            <Badge
              key={g.id}
              variant="outline"
              className="text-[10px] text-blue-700 bg-blue-50/50 border-blue-200 font-normal"
              title={`归属流水线任务: ${g.name}`}
            >
              {g.name}
            </Badge>
          ))}

          <LibraryArticleStatus article={art} />
          {!isRepository && art.research?.status === "succeeded" &&
            !art.research.archived_at && (
              <Badge className="border-amber-200 bg-amber-50 text-[10px] font-normal text-amber-700">
                研报待归档
              </Badge>
            )}
          {!isRepository && (art.research?.status === "running" ||
            art.research?.status === "queued") && (
            <Badge className="border-indigo-200 bg-indigo-50 text-[10px] font-normal text-indigo-700">
              <Loader2 className="mr-1 inline h-2.5 w-2.5 animate-spin" />
              调研进行中
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 pt-1">
        {summary && !art.review?.result && (
          <p className="line-clamp-2 text-sm leading-relaxed text-neutral-600">
            {summary}
          </p>
        )}
        {!isRepository && <LibraryAssessments
          review={art.review}
          timezone={timezone}
          articleTitle={title}
        />}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3">
          {art.canonical_url || art.research?.wiki_url ? (
            <WikiReadingLinks
              originalUrl={study?.repository_url || art.canonical_url}
              originalLabel={isRepository ? "仓库地址" : "原文链接"}
              researchUrl={art.research?.wiki_url}
            />
          ) : (
            <span className="text-xs text-neutral-400">无外部链接</span>
          )}
          <LibraryArticleActions
            article={art}
            reviewPending={reviewPending}
            onReview={onReview}
            onResearch={onResearch}
            onViewReport={onViewReport}
          />
        </div>
      </CardContent>
    </Card>
  );
}
