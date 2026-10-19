import { LibraryAssessments } from "./LibraryAssessments.js";
import { LibraryArticleStatus } from "./LibraryArticleStatus.js";
import {
  LibraryFilters,
  DEFAULT_LIBRARY_FILTERS,
  libraryFilterParams,
  libraryFiltersError,
  type LibraryFiltersState,
} from "./LibraryFilters.js";
import { WikiReadingLinks } from "../../components/WikiReadingLinks.js";
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Filter,
  Heart,
  Loader2,
  RotateCw,
  Rss,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LibraryArticle } from "@openlore/contracts";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { api } from "../../lib/api.js";
import { useDialog } from "../../lib/useDialog.js";

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

export function LibraryPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  });
  const timezone = settings?.timezone || "Asia/Shanghai";

  // Filters state
  const [filters, setFilters] = useState<LibraryFiltersState>(
    DEFAULT_LIBRARY_FILTERS,
  );
  const filterError = libraryFiltersError(filters);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const pageSize = 12;

  // Research modal states
  const [selectedArticleForResearch, setSelectedArticleForResearch] =
    useState<LibraryArticle | null>(null);
  const [researchGroupId, setResearchGroupId] = useState<string>("");
  const [viewingResearchArticle, setViewingResearchArticle] =
    useState<LibraryArticle | null>(null);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const [message, setMessage] = useState("");
  useDialog(
    Boolean(selectedArticleForResearch || viewingResearchArticle),
    () => {
      setSelectedArticleForResearch(null);
      setViewingResearchArticle(null);
    },
  );

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: api.listGroups,
  });

  const { data: sources } = useQuery({
    queryKey: ["sources"],
    queryFn: api.listSources,
  });

  const sourcesMap = React.useMemo(() => {
    const map = new Map<string, string>();
    sources?.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [sources]);

  const {
    data: libraryData,
    isLoading,
    error: libraryError,
  } = useQuery({
    refetchInterval: 5000,
    queryKey: [
      "library",
      { ...filters, selectedSourceId, searchTerm, page, pageSize },
    ],
    enabled: !filterError,
    queryFn: () =>
      api.listLibrary({
        ...libraryFilterParams(filters),
        source_id: selectedSourceId || undefined,
        search: searchTerm || undefined,
        page,
        page_size: pageSize,
      }),
  });

  const toggleInterestMutation = useMutation({
    mutationFn: ({
      articleId,
      interested,
    }: {
      articleId: string;
      interested: boolean;
    }) => api.toggleArticleInterest(articleId, { interested }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["daily-feed"] });
    },
  });

  const researchMutation = useMutation({
    mutationFn: async ({
      articleId,
      groupId,
    }: {
      articleId: string;
      groupId: string;
    }) => {
      const task = await api.startResearchOnArticle(articleId, {
        group_id: groupId,
      });
      if (task.status === "failed")
        throw new Error(task.error_message || "调研失败，请重试");
      return task;
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ["research"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      setMessage(
        task.status === "succeeded"
          ? "深度调研已完成，可在文章卡片查看完整研报。"
          : "调研已启动，完成后将自动更新。",
      );
      setSelectedArticleForResearch(null);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ ids, force = false }: { ids: string[]; force?: boolean }) =>
      api.reviewArticles(ids, force),
    onSuccess: ({ queued }) => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      setMessage(
        queued
          ? `已提交 ${queued} 篇内容初审，可在运行记录按“内容初审”筛选查看。`
          : "文章已审核或正在排队，无需重复提交。",
      );
    },
  });

  const filterMeta = libraryData?.filter_meta;
  const pagination = libraryData?.pagination;
  const articles = libraryData?.items || [];

  const handleFiltersChange = (value: LibraryFiltersState) => {
    setFilters(value);
    setPage(1);
  };

  const handleSourceChange = (val: string) => {
    setSelectedSourceId(val);
    setPage(1);
  };

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {message && (
        <p role="status" className="rounded-lg border bg-blue-50 p-3 text-sm">
          {message}
        </p>
      )}
      {(libraryError ||
        toggleInterestMutation.error ||
        reviewMutation.error) && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {libraryError?.message ||
            toggleInterestMutation.error?.message ||
            reviewMutation.error?.message}
        </p>
      )}
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">内容池</h2>
          <p className="text-neutral-500 text-sm">
            新文章入池后自动初审；历史文章可手动审核，评分与简介由所有流水线共享。
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            disabled={
              reviewMutation.isPending ||
              !articles.some(
                (article) =>
                  !article.review || article.review.status === "failed",
              )
            }
            onClick={() =>
              reviewMutation.mutate({
                ids: articles
                  .filter(
                    (article) =>
                      !article.review || article.review.status === "failed",
                  )
                  .map((article) => article.id),
              })
            }
          >
            审核本页未审核文章
          </Button>
          <div className="w-full sm:w-64">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
              <Input
                aria-label="搜索标题或作者"
                placeholder="搜索标题或作者..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card className="bg-neutral-50/50 border-neutral-200">
        <CardContent className="p-4 space-y-3.5">
          <LibraryFilters
            value={filters}
            meta={filterMeta}
            timezone={timezone}
            onChange={handleFiltersChange}
          />

          {/* Row 3: 采集来源标签筛选 */}
          <div className="flex flex-wrap items-center gap-2 text-xs pt-1 border-t border-neutral-200/60">
            <span className="text-neutral-500 font-medium flex items-center gap-1.5 w-20 shrink-0">
              <Rss className="w-3.5 h-3.5 text-neutral-400" />
              采集来源:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleSourceChange("")}
                className={`px-3 py-1 rounded-md border text-xs font-medium transition-all ${
                  selectedSourceId === ""
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
                }`}
              >
                全部
              </button>
              {sources?.map((s) => {
                const isActive = selectedSourceId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSourceChange(isActive ? "" : s.id)}
                    className={`px-3 py-1 rounded-md border text-xs font-medium transition-all flex items-center gap-1 ${
                      isActive
                        ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                        : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
                    }`}
                  >
                    <Rss
                      className={`w-3 h-3 ${isActive ? "text-white" : "text-emerald-600"}`}
                    />
                    {s.name}
                  </button>
                );
              })}
              {(selectedSourceId ||
                filters.status_filter !== "all" ||
                filters.interested_only ||
                filters.time_range !== "all" ||
                filters.published_range !== "all" ||
                searchTerm) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters(DEFAULT_LIBRARY_FILTERS);
                    setSelectedSourceId("");
                    setSearchTerm("");
                    setPage(1);
                  }}
                  className="h-7 px-2 text-xs text-neutral-500 hover:text-neutral-800 ml-1"
                >
                  重置筛选
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Article Cards Grid */}
      {filterError ? (
        <p className="rounded-lg border bg-neutral-50 p-6 text-sm text-neutral-500">
          请完成日期范围后查看文章。
        </p>
      ) : isLoading ? (
        <div className="py-16 text-center text-neutral-400 text-sm">
          加载中...
        </div>
      ) : articles.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Filter className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-neutral-600">
              未检索到匹配文章
            </p>
            <p className="text-xs text-neutral-400 mt-1">
              可以尝试切换时间范围、状态标签或清空搜索条件。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {articles.map((art) => (
            <Card
              key={art.id}
              className="flex flex-col hover:shadow-xs transition-shadow"
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
                                {art.title}
                              </a>
                            ) : (
                              <span
                                tabIndex={0}
                                className="block truncate cursor-help"
                              >
                                {art.title}
                              </span>
                            )}
                          </TooltipTrigger>
                          <TooltipContent>{art.title}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </CardTitle>
                    <CardDescription className="text-xs flex items-center gap-2 text-neutral-500">
                      <span>{art.author || "未知作者"}</span>
                      <span>·</span>
                      <span>
                        首发：
                        {art.published_at
                          ? new Date(art.published_at).toLocaleDateString(
                              "zh-CN",
                              { timeZone: timezone },
                            )
                          : "无发布日期"}
                      </span>
                    </CardDescription>
                  </div>

                  {/* Top Right Action & Favorite */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        toggleInterestMutation.mutate({
                          articleId: art.id,
                          interested: !art.user_interested,
                        })
                      }
                      className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors"
                      title={
                        art.user_interested
                          ? "已标为感兴趣（点击取消）"
                          : "标为感兴趣"
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
                  {/* 入池时间 */}
                  <Badge
                    variant="outline"
                    className="text-[10px] text-neutral-500 bg-neutral-50 border-neutral-200 font-normal"
                  >
                    <Clock className="w-2.5 h-2.5 mr-1 text-neutral-400 inline" />
                    发现: {formatPoolTime(art.created_at, timezone)}
                  </Badge>

                  {art.content_kind !== "article" &&
                    art.content_kind !== "unknown" && (
                      <Badge variant="outline" className="text-[10px]">
                        {(
                          {
                            digest: "汇总动态",
                            announcement: "公告",
                            note: "短文/实验",
                          } as Record<string, string>
                        )[art.content_kind] || art.content_kind}
                      </Badge>
                    )}
                  {/* 采集来源标签 */}
                  {art.sources?.map((srcId) => (
                    <Badge
                      key={srcId}
                      variant="outline"
                      className="text-[10px] text-emerald-700 bg-emerald-50/50 border-emerald-200 font-normal"
                      title={`采集来源: ${sourcesMap.get(srcId) || srcId}`}
                    >
                      <Rss className="w-2.5 h-2.5 mr-0.5 text-emerald-600 inline" />
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
                  {art.research?.status === "succeeded" &&
                    !art.research.archived_at && (
                      <Badge className="border-amber-200 bg-amber-50 text-[10px] font-normal text-amber-700">
                        研报待归档
                      </Badge>
                    )}
                  {(art.research?.status === "running" ||
                    art.research?.status === "queued") && (
                    <Badge className="border-indigo-200 bg-indigo-50 text-[10px] font-normal text-indigo-700">
                      <Loader2 className="mr-1 inline h-2.5 w-2.5 animate-spin" />
                      调研进行中
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-3 pt-1">
                <LibraryAssessments
                  review={art.review}
                  timezone={timezone}
                  articleTitle={art.title}
                />
                {/* Research Highlights */}
                {art.research?.status === "succeeded" &&
                  art.research.questions &&
                  art.research.questions.length > 0 && (
                    <div className="bg-purple-50/60 border border-purple-100 rounded-md p-2.5 text-xs space-y-1.5">
                      <div className="flex items-center justify-between text-purple-900 font-medium text-[11px]">
                        <span className="flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-purple-600" />
                          调研重点：
                        </span>
                        {art.research.finished_at && (
                          <span className="text-[10px] text-purple-400 font-normal">
                            完成于{" "}
                            {new Date(
                              art.research.finished_at,
                            ).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <ul className="list-disc list-inside text-neutral-600 space-y-0.5 text-[11px]">
                        {art.research.questions.slice(0, 2).map((q, idx) => (
                          <li key={idx} className="line-clamp-1">
                            {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                <WikiReadingLinks
                  articleUrl={art.wiki_url}
                  researchUrl={art.research?.wiki_url}
                />

                {/* Bottom Actions */}
                <div className="mt-auto flex items-center justify-between pt-2 border-t border-neutral-100">
                  {art.canonical_url ? (
                    <a
                      href={art.canonical_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center"
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      原文链接
                    </a>
                  ) : (
                    <span className="text-xs text-neutral-400">无外部链接</span>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      disabled={
                        reviewMutation.isPending ||
                        art.review?.status === "queued" ||
                        art.review?.status === "running"
                      }
                      onClick={() =>
                        reviewMutation.mutate({
                          ids: [art.id],
                          force: art.review?.status === "succeeded",
                        })
                      }
                    >
                      {art.review?.status === "succeeded"
                        ? "重新初审"
                        : art.review?.status === "failed"
                          ? "重试初审"
                          : art.review?.status === "queued"
                            ? "排队中"
                            : art.review?.status === "running"
                              ? "审核中"
                              : "初审"}
                    </Button>
                    {art.research?.status === "succeeded" ? (
                      <>
                        <Button
                          size="sm"
                          className="h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white gap-1"
                          onClick={() => {
                            setCopiedReport(false);
                            setViewingResearchArticle(art);
                          }}
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                          查看深度研报
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-neutral-400 hover:text-neutral-700"
                          title={
                            art.research?.archived_at
                              ? "重新发起深度调研"
                              : "重试归档"
                          }
                          onClick={() => {
                            researchMutation.reset();
                            setSelectedArticleForResearch(art);
                            if (art.groups && art.groups.length > 0) {
                              setResearchGroupId(art.groups[0].id);
                            } else if (groups && groups.length > 0) {
                              setResearchGroupId(groups[0].id);
                            }
                          }}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : art.research?.status === "running" ||
                      art.research?.status === "queued" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled
                        className="h-8 text-xs gap-1 text-purple-700 border-purple-200 bg-purple-50/40"
                      >
                        <Loader2 className="h-3 w-3 animate-spin text-purple-600" />
                        调研中...
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1"
                        onClick={() => {
                          setSelectedArticleForResearch(art);
                          if (art.groups && art.groups.length > 0) {
                            setResearchGroupId(art.groups[0].id);
                          } else if (groups && groups.length > 0) {
                            setResearchGroupId(groups[0].id);
                          }
                        }}
                      >
                        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        发起深度调研
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination Bar */}
      {pagination && pagination.total_count > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-neutral-500">
          <div>
            共{" "}
            <span className="font-semibold text-neutral-700">
              {pagination.total_count}
            </span>{" "}
            篇 · 当前第{" "}
            <span className="font-semibold text-neutral-700">
              {pagination.page}
            </span>{" "}
            /{" "}
            <span className="font-semibold text-neutral-700">
              {pagination.total_pages}
            </span>{" "}
            页
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 px-2.5 text-xs gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              上一页
            </Button>
            <div className="px-2 py-1 text-xs font-medium text-neutral-700 bg-neutral-100 rounded-md">
              {pagination.page} / {pagination.total_pages}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.total_pages}
              onClick={() =>
                setPage((p) => Math.min(pagination.total_pages, p + 1))
              }
              className="h-8 px-2.5 text-xs gap-1"
            >
              下一页
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Start Research Modal */}
      {selectedArticleForResearch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="单篇深度调研"
          className="fixed inset-0 bg-neutral-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50"
        >
          <Card className="max-w-md w-full shadow-xl">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Sparkles className="mr-2 h-4 w-4 text-amber-500" />
                单篇深度调研
              </CardTitle>
              <CardDescription>
                将对 《{selectedArticleForResearch.title}》
                展开机制分析、取舍分析与证据核验。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-neutral-600 block mb-1">
                  选择流水线任务（使用该任务的 AI 与调研配置）
                </label>
                <select
                  aria-label="归属流水线任务"
                  className="w-full h-9 px-3 rounded-md border border-neutral-200 text-sm bg-white"
                  value={researchGroupId}
                  onChange={(e) => setResearchGroupId(e.target.value)}
                >
                  <option value="">-- 选择流水线任务 --</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              {researchMutation.error && (
                <p role="alert" className="text-xs text-red-700">
                  {researchMutation.error.message}
                </p>
              )}
              {researchMutation.isPending && (
                <p role="status" className="text-xs text-blue-700">
                  正在生成完整研报，请稍候。关闭窗口后仍会继续处理。
                </p>
              )}
              <div className="flex justify-end space-x-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedArticleForResearch(null)}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  disabled={!researchGroupId || researchMutation.isPending}
                  onClick={() =>
                    researchMutation.mutate({
                      articleId: selectedArticleForResearch.id,
                      groupId: researchGroupId,
                    })
                  }
                >
                  {researchMutation.isPending ? "正在生成…" : "启动调研"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* View Full Research Report Modal */}
      {viewingResearchArticle && viewingResearchArticle.research && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="深度技术调研报告"
          className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 z-50 overflow-hidden"
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-neutral-200">
            {/* Modal Header */}
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center justify-between px-6 py-4 border-b border-neutral-100 bg-neutral-50/80 rounded-t-xl shrink-0">
              <div className="min-w-0 flex-1 space-y-1 pr-4">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded bg-purple-100 text-purple-700">
                    <BookOpen className="h-4 w-4" />
                  </span>
                  <h3 className="text-base font-bold text-neutral-900 line-clamp-1">
                    《{viewingResearchArticle.title}》深度技术调研报告
                  </h3>
                </div>
                <p className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                  <span>
                    {viewingResearchArticle.research.finished_at
                      ? `完成于 ${new Date(viewingResearchArticle.research.finished_at).toLocaleString()}`
                      : "调研完成"}
                  </span>
                  {viewingResearchArticle.research.evidence &&
                    viewingResearchArticle.research.evidence.length > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-neutral-600">
                          {viewingResearchArticle.research.evidence.length}{" "}
                          条交叉验证证据
                        </span>
                      </>
                    )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <WikiReadingLinks
                  articleUrl={viewingResearchArticle.wiki_url}
                  researchUrl={viewingResearchArticle.research.wiki_url}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        viewingResearchArticle.research?.report_markdown || "",
                      );
                      setCopiedReport(true);
                      setTimeout(() => setCopiedReport(false), 2000);
                    } catch {
                      setMessage("无法访问剪贴板，请选中研报内容后复制。");
                    }
                  }}
                >
                  {copiedReport ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedReport ? "已复制" : "复制研报"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-neutral-400 hover:text-neutral-700"
                  aria-label="关闭研报"
                  onClick={() => setViewingResearchArticle(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Core Questions */}
              {viewingResearchArticle.research.questions &&
                viewingResearchArticle.research.questions.length > 0 && (
                  <div className="bg-purple-50/70 border border-purple-100 rounded-lg p-4 space-y-2">
                    <h4 className="text-xs font-semibold text-purple-900 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      核心研究问题
                    </h4>
                    <ul className="list-disc list-inside text-xs text-neutral-700 space-y-1">
                      {viewingResearchArticle.research.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}

              {/* Markdown Report Content */}
              <div className="prose prose-neutral max-w-none text-sm leading-relaxed">
                {viewingResearchArticle.research.report_markdown ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {viewingResearchArticle.research.report_markdown}
                  </ReactMarkdown>
                ) : (
                  <p className="text-neutral-400 text-sm">暂无研报正文</p>
                )}
              </div>

              {/* Cross-Verification Evidence */}
              {viewingResearchArticle.research.evidence &&
                viewingResearchArticle.research.evidence.length > 0 && (
                  <div className="border-t border-neutral-100 pt-4 space-y-3">
                    <h4 className="text-xs font-semibold text-neutral-800">
                      交叉引证与事实来源
                    </h4>
                    <div className="grid grid-cols-1 gap-2">
                      {viewingResearchArticle.research.evidence.map(
                        (ev: any, idx: number) => (
                          <div
                            key={idx}
                            className="p-3 bg-neutral-50 rounded-md border border-neutral-100 text-xs space-y-1"
                          >
                            <div className="font-medium text-neutral-800 flex items-center justify-between">
                              <span>{ev.title || `证据 #${idx + 1}`}</span>
                              {ev.url && (
                                <a
                                  href={ev.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 hover:underline flex items-center gap-1"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  来源链接
                                </a>
                              )}
                            </div>
                            {ev.quote && (
                              <p className="text-neutral-600 italic">
                                “{ev.quote}”
                              </p>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-neutral-100 bg-neutral-50/50 flex items-center justify-between rounded-b-xl shrink-0">
              <span className="text-xs text-neutral-400">
                OpenLore 深度调研白盒报告
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label="关闭研报"
                onClick={() => setViewingResearchArticle(null)}
              >
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
