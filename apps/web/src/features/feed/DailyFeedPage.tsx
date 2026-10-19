import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BookOpen,
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Heart,
  Layers,
  Search,
  Sparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { WikiReadingLinks } from '../../components/WikiReadingLinks.js';
import { useDialog } from '../../lib/useDialog.js';

export function DailyFeedPage() {
  const queryClient = useQueryClient();
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [activeReport, setActiveReport] = useState<{ title: string; markdown: string; wikiUrl?: string; articleUrl?: string } | null>(null);

  const { data: settings } = useQuery({queryKey:['settings'],queryFn:api.getSettings});
  const todayStr = new Intl.DateTimeFormat('en-CA', {timeZone:settings?.timezone || 'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

  const { data: feedData, isLoading, error: feedError } = useQuery({
    queryKey: ['daily-feed', selectedGroupId, selectedDate],
    queryFn: () => api.getDailyFeed(selectedGroupId || undefined, selectedDate || undefined),
    refetchInterval: 10000,
  });

  const researchMutation = useMutation({
    mutationFn: async ({ groupId, articleId }: { groupId: string; articleId: string }) => {
      const task = await api.researchFeedArticle(groupId, articleId);
      if (task.status === 'failed') throw new Error(task.error_message || '调研失败，请重试');
      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-feed'] });
      queryClient.invalidateQueries({ queryKey: ['research'] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });

  const toggleInterestMutation = useMutation({
    mutationFn: ({ articleId, interested }: { articleId: string; interested: boolean }) =>
      api.toggleArticleInterest(articleId, { interested, group_id: currentGroup?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-feed'] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });

  const triggerRunMutation = useMutation({
    mutationFn: (groupId: string) => api.triggerGroupRun(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-feed'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });

  useDialog(Boolean(activeReport), () => setActiveReport(null));
  const currentGroup = feedData?.group;
  const running = feedData?.current_run?.status === 'running';
  const deepArticles = feedData?.deep_articles || [];
  const candidateArticles = feedData?.candidate_articles || [];
  const stats = feedData?.stats;
  const activeDate = selectedDate || feedData?.date || todayStr;
  const isToday = activeDate === todayStr;

  const navigateDay = (offset: number) => {
    const cur = new Date(activeDate);
    cur.setDate(cur.getDate() + offset);
    const nextStr = cur.toISOString().slice(0, 10);
    if (nextStr <= todayStr) {
      setSelectedDate(nextStr);
    }
  };

  return (
    <div className="space-y-8">
      {feedError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">加载精选失败：{feedError.message}</p>}
      {(researchMutation.error || toggleInterestMutation.error || triggerRunMutation.error) && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{researchMutation.error?.message || toggleInterestMutation.error?.message || triggerRunMutation.error?.message}</p>}
      {feedData?.current_run?.status === 'failed' && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">上次生成失败：{feedData.current_run.error_message}。已完成的历史精选仍可阅读。<Link className="ml-2 underline" to="/runs">查看失败详情</Link></p>}
      {running && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{({processing:'正在审核内容池文章',research:'正在生成深度调研文章',delivery:'正在同步知识库归档'} as Record<string,string>)[feedData?.current_run?.stage || ''] || '正在生成新一批精选'}，完成后自动更新。<Link className="ml-2 underline" to="/runs">查看实时进度</Link></p>}
      {/* Header & Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
              <Sparkles className="h-5 w-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
              {isToday ? '今日学习精选' : `${activeDate} 学习精选归档`}
            </h1>
            <Badge variant={isToday ? 'outline' : 'secondary'} className="text-xs font-normal">
              <Calendar className="mr-1 h-3 w-3" />
              {activeDate}
            </Badge>
            {!isToday && (
              <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">
                历史归档
              </Badge>
            )}
          </div>
          <p className="text-sm text-neutral-500 mt-1">
            已精选 {stats?.total_selected_count || 0} 篇文章，{stats?.deep_analyzed_count || 0} 篇已完成深度调研。归档状态与完整研报可在卡片中查看。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Date Navigator */}
          <div className="flex items-center bg-white border border-neutral-200 rounded-md p-0.5 shadow-sm">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => navigateDay(-1)}
              title="前一天"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              aria-label="精选日期"
              type="date"
              className="text-xs border-0 bg-transparent px-1.5 py-1 focus:outline-none text-neutral-700 font-mono"
              value={activeDate}
              max={todayStr}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => navigateDay(1)}
              disabled={activeDate >= todayStr}
              title="后一天"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isToday && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 border-l border-neutral-100"
                onClick={() => setSelectedDate('')}
              >
                今日
              </Button>
            )}
          </div>

          {isToday && currentGroup && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50"
              onClick={() => triggerRunMutation.mutate(currentGroup.id)}
              disabled={triggerRunMutation.isPending || running}
            >
              <Sparkles className={`h-3.5 w-3.5 text-amber-600 ${triggerRunMutation.isPending ? 'animate-spin' : ''}`} />
              {triggerRunMutation.isPending || running ? '正在生成精选…' : '生成新一批精选'}
            </Button>
          )}

          {feedData?.groups && feedData.groups.length > 1 && (
            <select
              aria-label="筛选流水线任务"
              className="text-xs bg-white border border-neutral-200 rounded-md px-2.5 py-1.5 h-8 focus:outline-none focus:ring-1 focus:ring-neutral-900"
              value={selectedGroupId || currentGroup?.id || ''}
              onChange={(e) => setSelectedGroupId(e.target.value)}
            >
              {feedData.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  流水线任务: {g.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Metrics Ribbon */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-white border border-neutral-200 rounded-lg">
            <div className="text-xs text-neutral-500">来源范围内池文章</div>
            <div className="text-xl font-bold text-neutral-800 mt-0.5">
              {stats.pool_count} <span className="text-xs font-normal text-neutral-400">篇</span>
            </div>
          </div>
          <div className="p-3 bg-white border border-neutral-200 rounded-lg">
            <div className="text-xs text-neutral-500">今日 AI 入选总量</div>
            <div className="text-xl font-bold text-neutral-800 mt-0.5">
              {stats.total_selected_count} <span className="text-xs font-normal text-neutral-400">篇</span>
            </div>
          </div>
          <div className="p-3 bg-amber-50/50 border border-amber-200 rounded-lg">
            <div className="text-xs text-amber-800 font-medium">完成深度调研</div>
            <div className="text-xl font-bold text-amber-900 mt-0.5">
              {stats.deep_analyzed_count} <span className="text-xs font-normal text-amber-700">篇</span>
            </div>
          </div>
          <div className="p-3 bg-white border border-neutral-200 rounded-lg">
            <div className="text-xs text-neutral-500">尚未精选或调研</div>
            <div className="text-xl font-bold text-neutral-800 mt-0.5">
              {stats.candidate_remaining_count} <span className="text-xs font-normal text-neutral-400">篇</span>
            </div>
          </div>
        </div>
      )}

      {isLoading ? <p role="status" className="py-20 text-center text-sm text-neutral-500">正在加载精选…</p> : !feedData?.group && !feedError ? <div className="rounded-xl border border-dashed bg-white p-10 text-center"><h2 className="font-semibold">先创建一个学习主题</h2><p className="mt-2 text-sm text-neutral-500">配置来源和流水线后，即可生成每日精选与研报。</p><Link to="/pipelines" className="mt-4 inline-block text-sm text-blue-700 underline">创建流水线任务</Link></div> : deepArticles.length === 0 && candidateArticles.length === 0 ? (
        isToday ? (
          <Card className="border-neutral-200 bg-white shadow-sm p-8 text-center">
            <CardContent className="space-y-4 max-w-lg mx-auto p-0">
              <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-neutral-900">{running ? '今日精选正在生成' : feedData?.has_run_today ? '本次没有新增精选' : '今日精选尚未生成'}</h3>
                <p className="text-sm text-neutral-500 mt-1.5 leading-relaxed">
                  {running ? '任务正在审核、调研或归档，完成后此页自动更新。' : feedData?.has_run_today ? '本次审核已完成，没有符合标准的新增内容，未生成空归档。' : ''} 当前池中有 <strong className="text-neutral-800">{stats?.pool_count || 0}</strong> 篇文章，其中 {stats?.candidate_remaining_count || 0} 篇尚未精选或深度调研，全部参与下次审核。系统定时任务设定于每天 {currentGroup?.schedule_cron || '09:00'} 执行，您也可以立即手动触发跑批。
                </p>
              </div>
              {triggerRunMutation.error && <p role="alert" className="text-sm text-red-600">{triggerRunMutation.error.message}</p>}
              <p className="text-xs text-neutral-500">采集完成的原始文章可在<Link to="/pool" className="text-blue-700 underline">内容池</Link>查看；此页展示成功归档的精选。<Link to="/runs" className="ml-2 text-blue-700 underline">查看任务进度</Link></p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                {feedData?.available_dates?.some((d) => d !== todayStr) && (
                  <Button
                    variant="outline"
                    onClick={() => setSelectedDate(feedData.available_dates.find((d) => d !== todayStr) || '')}
                  >
                    查看昨日/历史归档 ({feedData.available_dates.find((d) => d !== todayStr)})
                  </Button>
                )}
                <Button
                  onClick={() => currentGroup && triggerRunMutation.mutate(currentGroup.id)}
                  disabled={triggerRunMutation.isPending || running || !currentGroup}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {triggerRunMutation.isPending || running ? '正在执行 AI 筛选与调研…' : '立即执行今日精选'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed border-neutral-300 bg-neutral-50/50 p-8 text-center">
            <CardContent className="space-y-3 max-w-sm mx-auto p-0">
              <div className="text-neutral-400 font-mono text-sm">{activeDate}</div>
              <h3 className="text-base font-semibold text-neutral-800">该日期无精选归档数据</h3>
              <p className="text-xs text-neutral-500">该日期未触发跑批或无文章入围归档。</p>
              <Button
                variant="outline"
                size="sm"
                className="text-xs mt-2"
                onClick={() => setSelectedDate('')}
              >
                返回今日精选
              </Button>
            </CardContent>
          </Card>
        )
      ) : (
        <>
          {/* Section 1: Top 3 Deep Analyzed Articles */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <h2 className="text-lg font-bold text-neutral-900">
                  {isToday ? '今日深度技术研报' : `${activeDate} 深度技术研报`} ({deepArticles.length} 篇)
                </h2>
              </div>
              <span className="text-xs text-neutral-400">完整研报可直接阅读，归档状态见文章卡片</span>
            </div>

        {deepArticles.length === 0 ? (
          <Card className="border-dashed border-neutral-300 bg-neutral-50/50">
            <CardContent className="p-8 text-center text-neutral-500 text-sm">
              今日尚未生成深度研报。可点击下方备选文章的「深度调研」。
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
            {deepArticles.map((art) => (
              <Card
                key={art.id}
                className="flex flex-col justify-between border-neutral-200 hover:border-amber-400 transition-colors shadow-sm"
              >
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3">
                    <CardTitle className="min-w-0 text-base font-semibold leading-relaxed line-clamp-3 hover:text-amber-600">
                      <a href={art.research?.wiki_url || art.wiki_url || art.original_url || '#'} target="_blank" rel="noreferrer">
                        {art.title}
                      </a>
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {art.group_id && (
                        <Badge
                          variant="outline"
                          data-group-id={art.group_id}
                          className="text-[10px] text-neutral-600 bg-neutral-50 border-neutral-200 cursor-pointer hover:bg-neutral-100"
                          onClick={() => setSelectedGroupId(art.group_id)}
                          title={`流水线任务 ID: ${art.group_id}`}
                        >
                          流水线任务: {art.group_name || art.group_id}
                        </Badge>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          toggleInterestMutation.mutate({
                            articleId: art.id,
                            interested: !art.user_interested,
                          })
                        }
                        className="p-1 rounded hover:bg-neutral-100 transition-colors"
                        title={art.user_interested ? '已标为感兴趣（点击取消）' : '标为感兴趣'}
                      >
                        <Heart
                          className={`h-4 w-4 transition-colors ${
                            art.user_interested
                              ? 'fill-rose-500 text-rose-500'
                              : 'text-neutral-400 hover:text-neutral-600'
                          }`}
                        />
                      </button>
                      <Badge variant="success" className="text-[10px]">
                        {art.delivery?.commit_url ? '已归档' : '研报就绪'}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="text-xs text-neutral-400 flex items-center gap-1.5 pt-1">
                    <span>{art.author || '未知作者'}</span>
                    <span>·</span>
                    <span>{art.published_at ? new Date(art.published_at).toLocaleDateString() : '无日期'}</span>
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3.5 text-xs">
                  <p className="text-neutral-600 line-clamp-3 bg-neutral-50 p-2.5 rounded border border-neutral-100">
                    {art.summary}
                  </p>

                  {/* Research Questions preview */}
                  {art.research?.questions && art.research.questions.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-neutral-500">核心论证问题：</span>
                      <ul className="list-disc list-inside text-neutral-600 text-[11px] space-y-0.5 line-clamp-2">
                        {art.research.questions.slice(0, 2).map((q, i) => (
                          <li key={i} className="truncate">
                            {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <WikiReadingLinks articleUrl={art.wiki_url} researchUrl={art.research?.wiki_url} />

                  {/* Git Delivery Info */}
                  {art.delivery?.commit_sha && (
                    <a href={art.delivery.commit_url || undefined} target="_blank" rel="noreferrer" aria-label="查看此文章归档提交" className="flex items-center space-x-1.5 text-[11px] text-neutral-500 bg-neutral-100/70 px-2 py-1 rounded hover:text-blue-700">
                      <GitBranch className="h-3 w-3 text-neutral-600" />
                      <span className="font-mono text-neutral-700">
                        {art.delivery.commit_sha.slice(0, 7)}
                      </span>
                      <span>已同步到仓库</span>
                    </a>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 px-2.5"
                      onClick={() =>
                        setActiveReport({
                          title: art.title,
                          markdown: art.research?.report_markdown || '研报准备中',
                          wikiUrl: art.research?.wiki_url, articleUrl: art.wiki_url,
                        })
                      }
                      disabled={!art.research?.report_markdown}
                    >
                      <BookOpen className="mr-1 h-3 w-3" />
                      查看研报
                    </Button>

                    {art.original_url && (
                      <a
                        href={art.original_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-xs text-neutral-500 hover:text-neutral-900"
                      >
                        原文
                        <ExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Remaining 7 Candidate Articles */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <h2 className="text-lg font-bold text-neutral-900">
              更多精选阅读 ({candidateArticles.length} 篇)
            </h2>
          </div>
          <span className="text-xs text-neutral-400">
            对感兴趣的内容可点击「深度调研」，系统将生成完整研报并记录您的阅读偏好
          </span>
        </div>

        {candidateArticles.length === 0 ? (
          <Card className="border-dashed border-neutral-300 bg-neutral-50/50">
            <CardContent className="p-6 text-center text-neutral-500 text-sm">
              暂无备选文章。
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {candidateArticles.map((art) => {
              const isResearching =
                researchMutation.isPending &&
                researchMutation.variables?.articleId === art.id;

              return (
                <Card
                  key={art.id}
                  className="flex flex-col justify-between border-neutral-200 hover:border-neutral-300 transition-colors"
                >
                  <CardHeader className="pb-2">
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1">
                        <CardTitle className="text-base font-medium line-clamp-2 hover:text-blue-600">
                          <a
                            href={art.research?.wiki_url || art.wiki_url || art.original_url || '#'}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {art.title}
                          </a>
                        </CardTitle>
                        <CardDescription className="text-xs text-neutral-400">
                          {art.author || '未知作者'} ·{' '}
                          {art.published_at
                            ? new Date(art.published_at).toLocaleDateString()
                            : '无日期'}
                        </CardDescription>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {art.group_id && (
                          <Badge
                            variant="outline"
                            data-group-id={art.group_id}
                            className="text-[10px] text-neutral-600 bg-neutral-50 border-neutral-200 cursor-pointer hover:bg-neutral-100"
                            onClick={() => setSelectedGroupId(art.group_id)}
                            title={`流水线任务 ID: ${art.group_id}`}
                          >
                            流水线任务: {art.group_name || art.group_id}
                          </Badge>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            toggleInterestMutation.mutate({
                              articleId: art.id,
                              interested: !art.user_interested,
                            })
                          }
                          className="p-1 rounded hover:bg-neutral-100 transition-colors"
                          title={art.user_interested ? '已标为感兴趣（点击取消）' : '标为感兴趣'}
                        >
                          <Heart
                            className={`h-4 w-4 transition-colors ${
                              art.user_interested
                                ? 'fill-rose-500 text-rose-500'
                                : 'text-neutral-400 hover:text-neutral-600'
                            }`}
                          />
                        </button>
                        <div className="flex flex-wrap gap-1">
                          {art.tags?.map((t, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 bg-neutral-100 text-neutral-600 rounded text-[10px]"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 text-xs">
                    <p className="text-neutral-600 line-clamp-2 bg-neutral-50 p-2.5 rounded border border-neutral-100">
                      {art.summary}
                    </p>

                    <WikiReadingLinks articleUrl={art.wiki_url} researchUrl={art.research?.wiki_url} />

                    <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
                      {art.original_url ? (
                        <a
                          href={art.original_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center text-neutral-500 hover:underline"
                        >
                          查看原文
                          <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      ) : (
                        <span />
                      )}

                      {art.research?.report_markdown ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 px-2.5 text-amber-900 border-amber-300 bg-amber-50 hover:bg-amber-100"
                          onClick={() =>
                            setActiveReport({
                              title: art.title,
                              markdown: art.research?.report_markdown || '',
                              wikiUrl: art.research?.wiki_url, articleUrl: art.wiki_url,
                            })
                          }
                        >
                          <BookOpen className="mr-1 h-3 w-3 text-amber-600" />
                          查看研报
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-3 border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100"
                          onClick={() =>
                            researchMutation.mutate({
                              groupId: currentGroup!.id,
                              articleId: art.id,
                            })
                          }
                          disabled={isResearching || !currentGroup}
                        >
                          <Sparkles
                            className={`mr-1 h-3 w-3 text-amber-600 ${
                              isResearching ? 'animate-spin' : ''
                            }`}
                          />
                          {isResearching ? '深度调研中...' : '发起深度调研'}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
        </>
      )}

      {/* Research Report Modal */}
      {activeReport && (
        <div role="dialog" aria-modal="true" aria-label={activeReport.title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                  深度技术研报
                </span>
                <h3 className="font-semibold text-neutral-900 text-base line-clamp-1">
                  {activeReport.title}
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-3">
              <WikiReadingLinks articleUrl={activeReport.articleUrl} researchUrl={activeReport.wikiUrl} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveReport(null)}
              >
                关闭
              </Button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto prose prose-neutral prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {activeReport.markdown}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
