import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Filter, Rss, Search } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { api } from "../../lib/api.js";
import { LibraryArticleCard } from "./LibraryArticleCard.js";
import { useArticleActions } from "./useArticleActions.js";
import {
  LibraryFilters,
  DEFAULT_LIBRARY_FILTERS,
  libraryFilterParams,
  libraryFiltersError,
  type LibraryFiltersState,
} from "./LibraryFilters.js";

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

  const {
    reviewMutation,
    message,
    reviewArticle,
    openResearch,
    openReport,
    dialogs,
  } = useArticleActions();

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
            <LibraryArticleCard
              key={art.id}
              article={art}
              timezone={timezone}
              sourcesMap={sourcesMap}
              reviewPending={reviewMutation.isPending}
              onToggleInterest={() =>
                toggleInterestMutation.mutate({
                  articleId: art.id,
                  interested: !art.user_interested,
                })
              }
              onReview={() => reviewArticle(art)}
              onResearch={() => openResearch(art)}
              onViewReport={() => openReport(art)}
            />
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

      {dialogs}
    </div>
  );
}
