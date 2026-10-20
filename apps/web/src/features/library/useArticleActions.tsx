import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LibraryArticle } from "@openlore/contracts";
import { BookOpen, Check, Copy, ExternalLink, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { WikiReadingLinks } from "../../components/WikiReadingLinks.js";
import { api } from "../../lib/api.js";
import { useDialog } from "../../lib/useDialog.js";

export function useArticleActions() {
  const queryClient = useQueryClient();
  // Research modal states
  const [selectedArticleForResearch, setSelectedArticleForResearch] =
    useState<LibraryArticle | null>(null);
  const [researchGroupId, setResearchGroupId] = useState<string>("");
  const compatibleGroups = (article: LibraryArticle) =>
    (groups || []).filter(
      (group) => group.task_type === (article.task_type || "article_research"),
    );
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
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["execution-logs"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["daily-feed"] });
      setMessage(
        task.status === "succeeded"
          ? "研报已就绪，可在卡片查看完整内容。"
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
      queryClient.invalidateQueries({ queryKey: ["daily-feed"] });
      setMessage(
        queued
          ? `已提交 ${queued} 篇内容初审，可在运行记录按“内容初审”筛选查看。`
          : "文章已审核或正在排队，无需重复提交。",
      );
    },
  });

  const reviewArticle = (article: LibraryArticle) =>
    reviewMutation.mutate({
      ids: [article.id],
      force:
        article.review?.status === "succeeded" ||
        article.review?.status === "insufficient",
    });
  const openResearch = (article: LibraryArticle) => {
    researchMutation.reset();
    setSelectedArticleForResearch(article);
    const availableGroups = compatibleGroups(article);
    setResearchGroupId(
      availableGroups.find((group) =>
        article.groups.some((item) => item.id === group.id),
      )?.id ||
        availableGroups[0]?.id ||
        "",
    );
  };
  const openReport = (article: LibraryArticle) => {
    setCopiedReport(false);
    setViewingResearchArticle(article);
  };
  const dialogs = (
    <>
      {/* Start Research Modal */}
      {selectedArticleForResearch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={selectedArticleForResearch.task_type === "repository_research" ? "仓库研读" : "单篇深度调研"}
          className="fixed inset-0 bg-neutral-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50"
        >
          <Card className="max-w-md w-full shadow-xl">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Sparkles className="mr-2 h-4 w-4 text-amber-500" />
                {selectedArticleForResearch.task_type === "repository_research" ? "仓库研读" : "单篇深度调研"}
              </CardTitle>
              <CardDescription>
                将对 《{selectedArticleForResearch.title}》
                {selectedArticleForResearch.task_type === "repository_research" ? "结合已有研报分析架构、执行链路和设计取舍。" : "展开机制分析、取舍分析与证据核验。"}
              </CardDescription>
              {selectedArticleForResearch.task_type === 'repository_research' && <p className="text-xs leading-relaxed text-neutral-500">已有可用研报时优先复用或重试归档；新研读会更新源码并结合历史继续深入。</p>}
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
                  {compatibleGroups(selectedArticleForResearch).map((g) => (
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
                  originalUrl={viewingResearchArticle.canonical_url}
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
    </>
  );
  return {
    reviewMutation,
    researchMutation,
    message,
    reviewArticle,
    openResearch,
    openReport,
    dialogs,
  };
}
