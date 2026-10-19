import { WikiReadingLinks } from '../../components/WikiReadingLinks.js';
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Filter,
  Heart,
  Layers,
  Loader2,
  RotateCw,
  Rss,
  Search,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { LibraryArticle } from '@openlore/contracts';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { api } from '../../lib/api.js';

function formatPoolTime(iso: string, timezone: string) {
  if (!iso) return '未知时间';
  try {
    const d = new Date(iso);
    const now = new Date();
    const dateOptions: Intl.DateTimeFormatOptions = { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' };
    const isToday = d.toLocaleDateString('zh-CN', dateOptions) === now.toLocaleDateString('zh-CN', dateOptions);
    const timeStr = d.toLocaleTimeString('zh-CN', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
    if (isToday) return `今天 ${timeStr}`;
    return `${d.toLocaleDateString('zh-CN', dateOptions)} ${timeStr}`;
  } catch {
    return iso;
  }
}

export function LibraryPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const timezone = settings?.timezone || 'Asia/Shanghai';

  // Filters state
  const [timeRange, setTimeRange] = useState<'all' | 'today' | '3days' | 'published7'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'selected' | 'deep' | 'interested'>('all');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const pageSize = 12;

  // Research modal states
  const [selectedArticleForResearch, setSelectedArticleForResearch] = useState<LibraryArticle | null>(null);
  const [researchGroupId, setResearchGroupId] = useState<string>('');
  const [viewingResearchArticle, setViewingResearchArticle] = useState<LibraryArticle | null>(null);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: api.listGroups,
  });

  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: api.listSources,
  });

  const sourcesMap = React.useMemo(() => {
    const map = new Map<string, string>();
    sources?.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [sources]);

  const { data: libraryData, isLoading } = useQuery({
    queryKey: ['library', { timeRange, statusFilter, selectedSourceId, searchTerm, page, pageSize }],
    queryFn: () =>
      api.listLibrary({
        time_range: timeRange,
        status_filter: statusFilter,
        source_id: selectedSourceId || undefined,
        search: searchTerm || undefined,
        page,
        page_size: pageSize,
      }),
  });

  const toggleInterestMutation = useMutation({
    mutationFn: ({ articleId, interested }: { articleId: string; interested: boolean }) =>
      api.toggleArticleInterest(articleId, { interested }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['daily-feed'] });
    },
  });

  const researchMutation = useMutation({
    mutationFn: ({ articleId, groupId }: { articleId: string; groupId: string }) =>
      api.startResearchOnArticle(articleId, { group_id: groupId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research'] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
      alert('已启动对该文章的独立深度调研任务，完成后研报将直接显示在当前卡片上。');
      setSelectedArticleForResearch(null);
    },
  });

  const filterMeta = libraryData?.filter_meta;
  const pagination = libraryData?.pagination;
  const articles = libraryData?.items || [];

  const handleTimeChange = (val: 'all' | 'today' | '3days' | 'published7') => {
    setTimeRange(val);
    setPage(1);
  };

  const handleStatusChange = (val: 'all' | 'selected' | 'deep' | 'interested') => {
    setStatusFilter(val);
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
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">内容池</h2>
          <p className="text-neutral-500 text-sm">
            入池前完成采集准入；池内尚未精选或深度调研的文章全部参与 AI 审核。
          </p>
        </div>
        <div className="w-full sm:w-80">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
            <Input
              placeholder="搜索标题或作者..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card className="bg-neutral-50/50 border-neutral-200">
        <CardContent className="p-4 space-y-3.5">
          {/* Row 1: 入池时间筛选 (3个快捷选项) */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-neutral-500 font-medium flex items-center gap-1.5 w-20 shrink-0">
              <Clock className="w-3.5 h-3.5 text-neutral-400" />
              时间范围:
            </span>
            <div className="flex items-center gap-1.5 bg-neutral-100 p-0.5 rounded-lg border border-neutral-200">
              <button
                type="button"
                onClick={() => handleTimeChange('all')}
                className={`px-3 py-1 rounded-md transition-all font-medium flex items-center gap-1.5 ${
                  timeRange === 'all'
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                全部
                <span className="text-[10px] text-neutral-400">({filterMeta?.total_count ?? 0})</span>
              </button>
              <button
                type="button"
                onClick={() => handleTimeChange('today')}
                className={`px-3 py-1 rounded-md transition-all font-medium flex items-center gap-1.5 ${
                  timeRange === 'today'
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                今日发现
                <span className="text-[10px] text-neutral-400">({filterMeta?.today_count ?? 0})</span>
              </button>
              <button type="button" onClick={() => handleTimeChange('published7')} className={`px-3 py-1 rounded-md font-medium ${timeRange==='published7' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600'}`}>近七天发布</button>
              <button
                type="button"
                onClick={() => handleTimeChange('3days')}
                className={`px-3 py-1 rounded-md transition-all font-medium flex items-center gap-1.5 ${
                  timeRange === '3days'
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                近三天发现
                <span className="text-[10px] text-neutral-400">({filterMeta?.three_days_count ?? 0})</span>
              </button>
            </div>
          </div>

          {/* Row 2: 标签筛选 (精选、深度分析、感兴趣) */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-neutral-500 font-medium flex items-center gap-1.5 w-20 shrink-0">
              <Tag className="w-3.5 h-3.5 text-neutral-400" />
              属性标签:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleStatusChange('all')}
                className={`px-3 py-1 rounded-md border text-xs font-medium transition-all ${
                  statusFilter === 'all'
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                全部
              </button>
              <button
                type="button"
                onClick={() => handleStatusChange('selected')}
                className={`px-3 py-1 rounded-md border text-xs font-medium transition-all flex items-center gap-1 ${
                  statusFilter === 'selected'
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50/50'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                精选入围 ({filterMeta?.selected_count ?? 0})
              </button>
              <button
                type="button"
                onClick={() => handleStatusChange('deep')}
                className={`px-3 py-1 rounded-md border text-xs font-medium transition-all flex items-center gap-1 ${
                  statusFilter === 'deep'
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50/50'
                }`}
              >
                <FileText className="w-3 h-3" />
                深度分析 ({filterMeta?.deep_count ?? 0})
              </button>
              <button
                type="button"
                onClick={() => handleStatusChange('interested')}
                className={`px-3 py-1 rounded-md border text-xs font-medium transition-all flex items-center gap-1 ${
                  statusFilter === 'interested'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50/50'
                }`}
              >
                <Heart className="w-3 h-3 fill-rose-500 text-rose-500" />
                感兴趣 ({filterMeta?.interested_count ?? 0})
              </button>
            </div>
          </div>

          {/* Row 3: 采集来源标签筛选 */}
          <div className="flex flex-wrap items-center gap-2 text-xs pt-1 border-t border-neutral-200/60">
            <span className="text-neutral-500 font-medium flex items-center gap-1.5 w-20 shrink-0">
              <Rss className="w-3.5 h-3.5 text-neutral-400" />
              采集来源:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleSourceChange('')}
                className={`px-3 py-1 rounded-md border text-xs font-medium transition-all ${
                  selectedSourceId === ''
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
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
                    onClick={() => handleSourceChange(isActive ? '' : s.id)}
                    className={`px-3 py-1 rounded-md border text-xs font-medium transition-all flex items-center gap-1 ${
                      isActive
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    <Rss className={`w-3 h-3 ${isActive ? 'text-white' : 'text-emerald-600'}`} />
                    {s.name}
                  </button>
                );
              })}
              {(selectedSourceId || statusFilter !== 'all' || timeRange !== 'all' || searchTerm) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTimeRange('all');
                    setStatusFilter('all');
                    setSelectedSourceId('');
                    setSearchTerm('');
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
      {isLoading ? (
        <div className="py-16 text-center text-neutral-400 text-sm">加载中...</div>
      ) : articles.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Filter className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-neutral-600">未检索到匹配文章</p>
            <p className="text-xs text-neutral-400 mt-1">
              可以尝试切换时间范围、状态标签或清空搜索条件。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {articles.map((art) => (
            <Card key={art.id} className="flex flex-col justify-between hover:shadow-xs transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <CardTitle className="text-base font-semibold leading-snug line-clamp-2">
                      {art.research?.wiki_url || art.wiki_url ? <a href={art.research?.wiki_url || art.wiki_url} target="_blank" rel="noreferrer" className="hover:text-blue-700 hover:underline">{art.title}</a> : art.title}
                    </CardTitle>
                    <CardDescription className="text-xs flex items-center gap-2 text-neutral-500">
                      <span>{art.author || '未知作者'}</span>
                      <span>·</span>
                      <span>首发：{art.published_at ? new Date(art.published_at).toLocaleDateString() : '无发布日期'}</span>
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
                      title={art.user_interested ? '已标为感兴趣（点击取消）' : '标为感兴趣'}
                    >
                      <Heart
                        className={`h-4 w-4 transition-colors ${
                          art.user_interested
                            ? 'fill-rose-500 text-rose-500'
                            : 'text-neutral-300 hover:text-neutral-500'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Badges Bar */}
                <div className="flex flex-wrap items-center gap-1.5 pt-2">
                  {/* 入池时间 */}
                  <Badge variant="outline" className="text-[10px] text-neutral-500 bg-neutral-50 border-neutral-200 font-normal">
                    <Clock className="w-2.5 h-2.5 mr-1 text-neutral-400 inline" />
                    发现: {formatPoolTime(art.created_at, timezone)}
                  </Badge>

                  {art.content_kind !== 'article' && art.content_kind !== 'unknown' && <Badge variant="outline" className="text-[10px]">{({digest:'汇总动态',announcement:'公告',note:'短文/实验'} as Record<string,string>)[art.content_kind] || art.content_kind}</Badge>}
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

                  {/* 精选入围 */}
                  {art.is_selected && (
                    <Badge className="text-[10px] bg-amber-50 text-amber-700 border-amber-300 border font-normal">
                      <Sparkles className="w-2.5 h-2.5 mr-0.5 text-amber-600 inline" />
                      精选入围
                    </Badge>
                  )}

                  {/* 深度分析研报就绪状态 */}
                  {art.research?.status === 'succeeded' ? (
                    <Badge className="text-[10px] bg-purple-50 text-purple-700 border-purple-300 border font-normal">
                      <BookOpen className="w-2.5 h-2.5 mr-0.5 text-purple-600 inline" />
                      研报已就绪
                    </Badge>
                  ) : art.research?.status === 'running' || art.research?.status === 'queued' ? (
                    <Badge className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200 border font-normal animate-pulse">
                      <Loader2 className="w-2.5 h-2.5 mr-0.5 animate-spin inline" />
                      调研进行中
                    </Badge>
                  ) : art.is_deep_analyzed ? (
                    <Badge className="text-[10px] bg-purple-50 text-purple-700 border-purple-300 border font-normal">
                      <FileText className="w-2.5 h-2.5 mr-0.5 text-purple-600 inline" />
                      深度分析
                    </Badge>
                  ) : null}

                  {/* 数据源 */}
                  {art.sources?.map((s) => (
                    <Badge key={s} variant="secondary" className="text-[10px] font-normal">
                      {s}
                    </Badge>
                  ))}
                </div>
              </CardHeader>

              <CardContent className="space-y-3 pt-1">
                {/* Research Highlights or Body Snippet */}
                {art.research?.status === 'succeeded' && art.research.questions && art.research.questions.length > 0 ? (
                  <div className="bg-purple-50/60 border border-purple-100 rounded-md p-2.5 text-xs space-y-1.5">
                    <div className="flex items-center justify-between text-purple-900 font-medium text-[11px]">
                      <span className="flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-purple-600" />
                        深度调研白盒剖析维度:
                      </span>
                      {art.research.finished_at && (
                        <span className="text-[10px] text-purple-400 font-normal">
                          完成于 {new Date(art.research.finished_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <ul className="list-disc list-inside text-neutral-600 space-y-0.5 text-[11px]">
                      {art.research.questions.slice(0, 2).map((q, idx) => (
                        <li key={idx} className="line-clamp-1">{q}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-600 line-clamp-3 bg-neutral-50/70 p-2.5 rounded-md border border-neutral-100 leading-relaxed">
                    {art.body_snippet || '暂无正文预览'}
                  </p>
                )}

                <WikiReadingLinks articleUrl={art.wiki_url} researchUrl={art.research?.wiki_url} />

                {/* Bottom Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
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

                  <div className="flex items-center gap-1.5">
                    {art.research?.status === 'succeeded' ? (
                      <>
                        <Button
                          size="sm"
                          className="h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white gap-1"
                          onClick={() => setViewingResearchArticle(art)}
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                          查看深度研报
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-neutral-400 hover:text-neutral-700"
                          title="重新发起深度调研"
                          onClick={() => {
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
                    ) : art.research?.status === 'running' || art.research?.status === 'queued' ? (
                      <Button size="sm" variant="outline" disabled className="h-8 text-xs gap-1 text-purple-700 border-purple-200 bg-purple-50/40">
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
            共 <span className="font-semibold text-neutral-700">{pagination.total_count}</span> 篇 · 当前第{' '}
            <span className="font-semibold text-neutral-700">{pagination.page}</span> /{' '}
            <span className="font-semibold text-neutral-700">{pagination.total_pages}</span> 页
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
              onClick={() => setPage((p) => Math.min(pagination.total_pages, p + 1))}
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
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <Card className="max-w-md w-full shadow-xl">
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Sparkles className="mr-2 h-4 w-4 text-amber-500" />
                单篇深度调研
              </CardTitle>
              <CardDescription>
                将对 《{selectedArticleForResearch.title}》 展开核心机制白盒剖析、取舍分析与证据交叉验证。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-neutral-600 block mb-1">
                  选择归属流水线任务 (用于读取 AI 配置与归档路由)
                </label>
                <select
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
                  启动调研
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* View Full Research Report Modal */}
      {viewingResearchArticle && viewingResearchArticle.research && (
        <div className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 z-50 overflow-hidden">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-neutral-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 bg-neutral-50/80 rounded-t-xl shrink-0">
              <div className="space-y-1 pr-4">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded bg-purple-100 text-purple-700">
                    <BookOpen className="h-4 w-4" />
                  </span>
                  <h3 className="text-base font-bold text-neutral-900 line-clamp-1">
                    《{viewingResearchArticle.title}》深度技术调研报告
                  </h3>
                </div>
                <p className="text-xs text-neutral-500 flex items-center gap-2">
                  <span>
                    {viewingResearchArticle.research.finished_at
                      ? `完成于 ${new Date(viewingResearchArticle.research.finished_at).toLocaleString()}`
                      : '调研完成'}
                  </span>
                  {viewingResearchArticle.research.evidence && viewingResearchArticle.research.evidence.length > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-neutral-600">
                        {viewingResearchArticle.research.evidence.length} 条交叉验证证据
                      </span>
                    </>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <WikiReadingLinks articleUrl={viewingResearchArticle.wiki_url} researchUrl={viewingResearchArticle.research.wiki_url} />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1"
                  onClick={() => {
                    if (viewingResearchArticle.research?.report_markdown) {
                      navigator.clipboard.writeText(viewingResearchArticle.research.report_markdown);
                      setCopiedReport(true);
                      setTimeout(() => setCopiedReport(false), 2000);
                    }
                  }}
                >
                  {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedReport ? '已复制' : '复制研报'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-neutral-400 hover:text-neutral-700"
                  onClick={() => setViewingResearchArticle(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Core Questions */}
              {viewingResearchArticle.research.questions && viewingResearchArticle.research.questions.length > 0 && (
                <div className="bg-purple-50/70 border border-purple-100 rounded-lg p-4 space-y-2">
                  <h4 className="text-xs font-semibold text-purple-900 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                    核心白盒剖析问题
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
              {viewingResearchArticle.research.evidence && viewingResearchArticle.research.evidence.length > 0 && (
                <div className="border-t border-neutral-100 pt-4 space-y-3">
                  <h4 className="text-xs font-semibold text-neutral-800">交叉引证与事实来源</h4>
                  <div className="grid grid-cols-1 gap-2">
                    {viewingResearchArticle.research.evidence.map((ev: any, idx: number) => (
                      <div key={idx} className="p-3 bg-neutral-50 rounded-md border border-neutral-100 text-xs space-y-1">
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
                        {ev.quote && <p className="text-neutral-600 italic">“{ev.quote}”</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-neutral-100 bg-neutral-50/50 flex items-center justify-between rounded-b-xl shrink-0">
              <span className="text-xs text-neutral-400">OpenLore 深度调研白盒报告</span>
              <Button size="sm" variant="outline" onClick={() => setViewingResearchArticle(null)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
