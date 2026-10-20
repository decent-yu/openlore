import { RepositoryHistory } from './RepositoryHistory.js';
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, ExternalLink, Github, Globe, Pencil, Plus, RefreshCw, Rss, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { parseGitHubRepository, sourceSupportsTask } from '@openlore/contracts';
import type { Source } from '@openlore/contracts';
import { Badge } from '../../components/ui/badge.js';
import { Button, cn } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { api } from '../../lib/api.js';
import { useDialog } from '../../lib/useDialog.js';

export function SourcesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: sources, isLoading, error: sourcesError } = useQuery({
    queryKey: ['sources'],
    queryFn: api.listSources,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeType, setActiveType] = useState('web_feed');
  const [sourceType, setSourceType] = useState('web_feed');
  const [researchFocus, setResearchFocus] = useState('');
  const { data: groups } = useQuery({ queryKey: ['groups'], queryFn: api.listGroups });
  const isRepository = sourceType === 'github_repository';
  useDialog(isModalOpen, () => setIsModalOpen(false));
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [pollMsg, setPollMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [pollInterval, setPollInterval] = useState(30);
  const [keywords, setKeywords] = useState('');
  const [excludedKeywords, setExcludedKeywords] = useState('');
  const [maxAgeDays, setMaxAgeDays] = useState(30);
  const [currentYearOnly, setCurrentYearOnly] = useState(true);
  const [verifyDate, setVerifyDate] = useState(true);
  const [keywordPolicy, setKeywordPolicy] = useState<'assist'|'strict'>('assist');
  const [excludedCategories, setExcludedCategories] = useState('Company, Company Announcements, Global Affairs');
  const [keywordMode, setKeywordMode] = useState<'any' | 'all'>('any');

  // SSE for real-time source polling updates
  useEffect(() => {
    const es = new EventSource('/api/v1/events');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.entity_type === 'source' || data.entity_type === 'run') {
          queryClient.invalidateQueries({ queryKey: ['sources'] });
        }
      } catch {}
    };
    return () => {
      es.close();
    };
  }, [queryClient]);

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.toggleSource(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  const pollMutation = useMutation({
    mutationFn: (id: string) => api.pollSource(id),
    onSuccess: (res, id) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['daily-feed'] });
      setPollMsg({
        type: res.status === 'failed' ? 'error' : 'success',
        text: res.status === 'failed' ? res.errors?.[0]?.message || '采集失败' : sources?.find(source => source.id === id)?.capability_id === 'github_repository' ? '本地仓库已更新。请在关联流水线中运行研读并归档。' : `同步完成：新增可读 ${res.stats?.items_new ?? 0} 篇，待补抓 ${res.stats?.queued ?? 0} 篇。未通过准入的内容不会进入内容池。`,
      });
      setTimeout(() => setPollMsg(null), 4000);
    },
    onError: (err: any) => {
      setPollMsg({ type: 'error', text: err.message || '抓取同步失败' });
      setTimeout(() => setPollMsg(null), 5000);
    },
  });

  const pollAllMutation = useMutation({
    mutationFn: api.pollAllSources,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['daily-feed'] });
      setPollMsg({
        type: res.polled_sources.length === sources?.filter(source => source.enabled).length ? 'success' : 'error',
        text: `已同步 ${res.polled_sources.length} / ${sources?.filter(source => source.enabled).length || 0} 个启用来源。${res.polled_sources.length < (sources?.filter(source => source.enabled).length || 0) ? '部分来源失败，请查看卡片中的异常信息。' : '内容池已更新。'}`,
      });
      setTimeout(() => setPollMsg(null), 4000);
    },
    onError: (err: any) => {
      setPollMsg({ type: 'error', text: err.message || '批量同步失败' });
      setTimeout(() => setPollMsg(null), 5000);
    },
  });

  const revalidateMutation = useMutation({
    mutationFn: api.revalidateSource,
    onSuccess: () => { queryClient.invalidateQueries({queryKey:['sources']}); queryClient.invalidateQueries({queryKey:['library']}); setPollMsg({type:'success',text:'已重评未入池候选，通过准入后进入内容池。'}); },
    onError: (error: Error) => setPollMsg({type:'error',text:error.message}),
  });

  const saveMutation = useMutation({
    mutationFn: api.saveSource,
    onSuccess: () => {
      setActiveType(sourceType);
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      setIsModalOpen(false);
      setEditingSource(null);
      setName('');
      setUrl('');
      setDescription('');
      setEnabled(true);
    },
  });

  const handleOpenCreate = () => {
    setSourceType(activeType);
    setResearchFocus('');
    setEditingSource(null);
    saveMutation.reset();
    setPollInterval(activeType === 'github_repository' ? 60 : 30);
    setKeywords('');
    setExcludedKeywords('');
    setKeywordMode('any');
    setMaxAgeDays(30); setCurrentYearOnly(true); setVerifyDate(true); setKeywordPolicy('assist'); setExcludedCategories('Company, Company Announcements, Global Affairs');
    setName('');
    setUrl('');
    setDescription('');
    setEnabled(true);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (source: Source) => {
    setSourceType(source.capability_id);
    setResearchFocus(source.options.research_focus);
    setEditingSource(source);
    saveMutation.reset();
    setPollInterval(source.options.poll_interval_mins);
    setKeywords(source.options.keywords.join(', '));
    setExcludedKeywords(source.options.excluded_keywords.join(', '));
    setKeywordMode(source.options.keyword_mode);
    setMaxAgeDays(source.options.max_age_days); setCurrentYearOnly(source.options.current_year_only);
    setVerifyDate(source.options.verify_publication_date); setKeywordPolicy(source.options.keyword_policy);
    setExcludedCategories(source.options.excluded_categories.join(', '));
    setName(source.name);
    setUrl(source.url);
    setDescription(source.description || '');
    setEnabled(source.enabled !== false);
    setIsModalOpen(true);
  };

  useEffect(() => {
    const id = searchParams.get('edit');
    const source = sources?.find(item => item.id === id);
    if (source) { setActiveType(source.capability_id); handleOpenEdit(source); setSearchParams({}, { replace: true }); }
  }, [sources, searchParams]);

  const handleSave = () => {
    if (!name.trim() || !url.trim()) return;
    saveMutation.mutate({
      id: editingSource?.id,
      name: name.trim(),
      url: url.trim(),
      description: description.trim(),
      capability_id: sourceType,
      options: { research_focus: researchFocus, max_age_days:maxAgeDays, current_year_only:currentYearOnly, verify_publication_date:verifyDate, keyword_policy:keywordPolicy, excluded_categories:excludedCategories.split(/[,，]/).map(x=>x.trim()).filter(Boolean), poll_interval_mins: pollInterval, keywords: keywords.split(/[,，]/).map((x) => x.trim()).filter(Boolean), excluded_keywords: excludedKeywords.split(/[,，]/).map((x) => x.trim()).filter(Boolean), keyword_mode: keywordMode },
      enabled,
    });
  };

  const visibleSources = sources?.filter(s => s.capability_id === activeType) || [];

  return (
    <div className="space-y-6 w-full min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">来源采集</h2>
          <p className="text-neutral-500 text-sm">
            订阅文章，或每天深入研读 GitHub 仓库的架构与核心思想。
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            onClick={() => pollAllMutation.mutate()}
            disabled={pollAllMutation.isPending}
            className="text-xs"
          >
            <RefreshCw
              className={cn(
                'mr-1.5 h-3.5 w-3.5 text-blue-600',
                pollAllMutation.isPending && 'animate-spin',
              )}
            />
            {pollAllMutation.isPending ? '正在批量抓取...' : '立即同步全部源'}
          </Button>
          <Button onClick={handleOpenCreate} className="shrink-0 text-xs">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            新增信息源
          </Button>
        </div>
      </div>

      {pollMsg && (
        <div
          className={cn(
            'p-3 rounded-lg text-xs font-medium flex items-center justify-between',
            pollMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200',
          )}
        >
          <span>{pollMsg.text}</span>
          <button
            onClick={() => setPollMsg(null)}
            className="text-neutral-400 hover:text-neutral-600 text-sm leading-none"
          >
            &times;
          </button>
        </div>
      )}

      {(sourcesError || toggleMutation.error) && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{sourcesError?.message || toggleMutation.error?.message}</p>}
      {/* Tabs */}
      <div role="tablist" aria-label="来源类型" className="flex items-center space-x-2 border-b border-neutral-200">
        {[{ id: 'web_feed', label: 'RSS / Atom', icon: Rss }, { id: 'github_repository', label: 'GitHub 仓库', icon: Github }].map(type => (
          <button key={type.id} role="tab" aria-selected={activeType === type.id} onClick={() => setActiveType(type.id)} className={cn('flex items-center gap-2 py-2.5 px-4 text-sm font-semibold border-b-2 -mb-px', activeType === type.id ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500')}>
            <type.icon className="h-4 w-4" />{type.label}
            <span className="text-xs rounded-full bg-neutral-100 px-2 py-0.5">{sources?.filter(source => source.capability_id === type.id).length || 0}</span>
          </button>
        ))}
      </div>
      {activeType === 'github_repository' && <p className="rounded-lg border bg-neutral-50 p-3 text-xs text-neutral-600">根据各仓库的研读目标和历史研报持续深入研究，每次新调研先更新默认分支源码。在<Link to="/pipelines" className="underline">流水线</Link>中关联来源、设置每天运行及归档目录；研报按“目录/owner@repo/01-主题.md”连续归档。</p>}

      {/* Responsive Multi-column Cards Grid */}
      {isLoading ? <p role="status" className="p-12 text-center text-sm text-neutral-500">正在加载信息源…</p> : visibleSources.length === 0 ? (
        <Card className="p-12 text-center text-neutral-500 border-dashed">
          <Rss className="mx-auto h-8 w-8 text-neutral-300 mb-2" />
          <p className="text-sm font-medium">当前暂无{activeType === 'github_repository' ? ' GitHub 仓库' : ' RSS / Atom 信息源'}</p>
          <p className="text-xs text-neutral-400 mt-1">点击右上角“新增信息源”即可添加。</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-5 w-full min-w-0">
          {visibleSources.map((s) => (
            <div
              key={s.id}
              className="bg-white rounded-xl border border-neutral-200/80 shadow-xs hover:border-neutral-300 hover:shadow-sm transition-all flex flex-col justify-between overflow-hidden min-w-0"
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between gap-2.5 p-4 sm:p-5 pb-3">
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 text-amber-600">
                      {s.capability_id === 'github_repository' ? <Github className="h-5 w-5" /> : <Rss className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-1.5">
                        <h3 className="font-semibold text-base text-neutral-900 truncate" title={s.name}>
                          {s.name}
                        </h3>
                        <span className="text-[10px] sm:text-[11px] font-medium px-1.5 sm:px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200/60 shrink-0">
                          {s.capability_id === 'github_repository' ? 'GitHub 仓库' : 'RSS / Atom'}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 line-clamp-1 mt-0.5" title={s.description}>
                        {s.description || '暂无描述说明'}
                      </p>
                    </div>
                  </div>

                  {/* Status Toggle Switch */}
                  <div className="flex items-center space-x-2 shrink-0">
                    <span
                      className={cn(
                        'text-xs font-medium select-none',
                        s.enabled ? 'text-emerald-700' : 'text-neutral-400',
                      )}
                    >
                      {s.enabled ? '已启用' : '已停用'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.enabled}
                      onClick={() => toggleMutation.mutate({ id: s.id, enabled: !s.enabled })}
                      disabled={toggleMutation.isPending}
                      className={cn(
                        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-50',
                        s.enabled ? 'bg-emerald-600' : 'bg-neutral-300',
                      )}
                      title={s.enabled ? '点击停用' : '点击启用'}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out',
                          s.enabled ? 'translate-x-5' : 'translate-x-0',
                        )}
                      />
                    </button>
                  </div>
                </div>

                {/* Body Content */}
                <div className="px-4 sm:px-5 py-2">
                  {/* URL Bar */}
                  <div className="flex items-center justify-between text-xs bg-neutral-50 px-3 py-2 rounded-lg border border-neutral-200/60 text-neutral-600">
                    <div className="flex items-center space-x-2 min-w-0 flex-1 pr-2">
                      <Globe className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                      <span className="truncate font-mono text-[11px] text-neutral-700 select-all" title={s.url}>
                        {s.url}
                      </span>
                    </div>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-neutral-400 hover:text-neutral-700 p-0.5 rounded hover:bg-neutral-200/50 transition-colors"
                      title="打开链接"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>

                  {/* Polling & Sync Status Bar */}
                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-neutral-500 px-0.5 flex-wrap gap-1">
                    <div className="flex items-center space-x-1.5">
                      <Clock className="h-3.5 w-3.5 text-neutral-400" />
                      <span>
                        最近同步:{' '}
                        {s.last_polled_at ? (
                          <strong className="text-neutral-700">
                            {new Date(s.last_polled_at).toLocaleString()}
                          </strong>
                        ) : (
                          <span className="text-amber-600">{s.enabled ? '尚未同步，等待首次采集' : '尚未同步，来源已停用'}</span>
                        )}
                      </span>
                    </div>
                    <span className="text-neutral-400 font-mono text-[10px] bg-neutral-100 px-1.5 py-0.5 rounded">
                      每 {s.options.poll_interval_mins} 分钟采集
                    </span>
                  </div>

                  {s.capability_id === 'github_repository' ? <div className="mt-2"><RepositoryHistory source={s} compact /></div> : <p className="mt-2 text-[11px] text-neutral-500 break-words">主题关键词：{s.options.keywords.join('、') || '不限'} · {s.options.keyword_mode === 'all' ? '全部命中' : '任一命中'}</p>}
                  {s.options.excluded_keywords.length > 0 && <p className="mt-1 text-[11px] text-neutral-500">排除：{s.options.excluded_keywords.join('、')}</p>}
                  {s.last_error && (
                    <div className="mt-2 p-2 bg-red-50 text-red-700 rounded text-[11px] border border-red-200/80">
                      <strong>同步异常:</strong> {s.last_error}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions Footer */}
              <div className="px-4 pb-3 text-xs text-neutral-600 space-y-2">
                {s.capability_id === 'github_repository' ? <>
                  <p>按目标持续研读 · 不要求仓库有新提交</p>
                  {(groups || []).filter(group => sourceSupportsTask(s.capability_id, group.task_type) && (!group.source_ids.length || group.source_ids.includes(s.id))).map(group => <p key={group.id} className="break-all">{group.name} · {group.schedule_cron}（{group.timezone}）<br />归档：{group.route.base_path}/{parseGitHubRepository(s.url)?.directory}/01-主题.md</p>)}
                  {!groups?.some(group => sourceSupportsTask(s.capability_id, group.task_type) && (!group.source_ids.length || group.source_ids.includes(s.id))) && <Link to="/pipelines" className="underline">关联流水线并设置归档目录</Link>}
                </> : <>
                <p>最近 {s.options.max_age_days} 天{s.options.current_year_only ? ' · 仅今年' : ''} · {s.options.verify_publication_date ? '核验原文日期' : '采用来源日期'} · {s.options.keyword_policy==='assist' ? '关键词辅助' : '关键词严格'}</p>
                <p>准入通过 {s.quality_stats?.ready || 0} · 待补全文 {s.quality_stats?.pending || 0} · 待复核 {s.quality_stats?.review || 0} · 超期拒收 {s.quality_stats?.history || 0} · 规则拒收 {s.quality_stats?.excluded || 0} · 失败丢弃 {s.quality_stats?.failed || 0}</p>
                <p className="text-[11px] text-neutral-400">待处理候选留在后台；拒收及失败原因保留 30 天，正文丢弃。</p>
                <Button variant="outline" size="sm" disabled={revalidateMutation.isPending} onClick={() => revalidateMutation.mutate(s.id)}>重评未入池候选</Button>
                </>}
              </div>
              <div className="p-3 sm:p-4 pt-3 mt-2 border-t border-neutral-100 bg-neutral-50/50 flex items-center justify-between">
                <span className="text-[11px] text-neutral-400 font-mono">
                  来源 ID: <span className="text-neutral-700 font-semibold">{s.id}</span>
                </span>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white hover:bg-neutral-50 text-neutral-700 text-xs h-8 px-2.5 shadow-2xs"
                    onClick={() => pollMutation.mutate(s.id)}
                    disabled={pollMutation.isPending || !s.enabled}
                    title="立即手动拉取最新文章"
                  >
                    <RefreshCw
                      className={cn(
                        'mr-1.5 h-3 w-3 text-blue-600',
                        pollMutation.isPending && 'animate-spin',
                      )}
                    />
                    立即同步
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white hover:bg-neutral-50 text-neutral-700 text-xs h-8 px-3 shadow-2xs"
                    onClick={() => handleOpenEdit(s)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5 text-neutral-500" />
                    编辑配置
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Source Modal */}
      {isModalOpen && (
        <div role="dialog" aria-modal="true" aria-label={editingSource ? "编辑信息源配置" : "新增信息源"} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <form onSubmit={(event) => { event.preventDefault(); handleSave(); }} className="flex flex-col w-full max-w-lg max-h-[90vh] bg-white rounded-xl shadow-2xl border border-neutral-200 overflow-hidden">
            <div className="shrink-0 p-6 pb-4 border-b border-neutral-100 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {editingSource ? (
                  <Pencil className="h-5 w-5 text-neutral-900" />
                ) : (
                  <Plus className="h-5 w-5 text-neutral-900" />
                )}
                <h3 className="text-base font-semibold text-neutral-900">
                  {editingSource ? '编辑信息源配置' : '新增信息源'}
                </h3>
                <Badge variant="outline" className="text-xs text-amber-700 bg-amber-50 border-amber-200">
                  {isRepository ? 'GitHub 仓库' : 'RSS / Atom'}
                </Badge>
              </div>
              <button
                type="button" aria-label="关闭信息源配置" onClick={() => setIsModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 p-1 rounded hover:bg-neutral-100 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <label className="block space-y-1 text-xs">来源类型
                <select className="w-full rounded border p-2" value={sourceType} disabled={Boolean(editingSource)} onChange={event => { setSourceType(event.target.value); setPollInterval(event.target.value === 'github_repository' ? 60 : 30); }}>
                  <option value="web_feed">RSS / Atom</option><option value="github_repository">GitHub 仓库</option>
                </select>
              </label>
              <div className="space-y-1.5">
                <label htmlFor="source-name" className="text-xs font-medium text-neutral-700">来源名称 *</label>
                <Input
                  id="source-name" required placeholder="例如：OpenAI Blog 或 Cloudflare"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="source-url" className="text-xs font-medium text-neutral-700">{isRepository ? 'GitHub 仓库地址 *' : 'Feed URL *'}</label>
                <Input
                  id="source-url" type="url" required disabled={Boolean(editingSource && isRepository)} placeholder={isRepository ? 'https://github.com/stablyai/orca' : 'https://example.com/feed.xml'}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              {!isRepository && <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-700">内容定位与说明</label>
                <Input
                  placeholder="简述该来源的内容特点与定位"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>}
              <label className="block space-y-1 text-xs">采集间隔（分钟）
                <Input type="number" min={1} max={10080} value={pollInterval} onChange={(e) => setPollInterval(Number(e.target.value))} />
              </label>
              {isRepository ? <>
                <label className="block space-y-1 text-xs">研读目标<textarea className="w-full rounded border p-2 min-h-24" maxLength={4000} value={researchFocus} onChange={event => setResearchFocus(event.target.value)} placeholder="例如：理解核心执行链路、工作区隔离、状态恢复与设计取舍" /></label>
                <p className="text-xs text-neutral-500">每次新研读读取仓库真实默认分支的最新源码，结合目标和历史研报选择深入方向。目标由你填写，历史记录自动关联；修改目标保留已有报告。</p>
                {editingSource && <RepositoryHistory source={sources?.find(source => source.id === editingSource.id) || editingSource} showGoal={false} />}
                <p className="break-all text-xs text-neutral-500">归档示例：docs/xxx/{parseGitHubRepository(url)?.directory || 'stablyai@orca'}/01-主题.md</p>
              </> : <>
              <label className="block space-y-1 text-xs">自动采集范围（最近几天首发）
                <Input type="number" min={1} max={3650} value={maxAgeDays} onChange={e=>setMaxAgeDays(Number(e.target.value))} />
              </label>
              <label className="flex gap-2 text-xs"><input type="checkbox" checked={currentYearOnly} onChange={e=>setCurrentYearOnly(e.target.checked)} />只自动采集今年首发文章</label>
              <label className="flex gap-2 text-xs"><input type="checkbox" checked={verifyDate} onChange={e=>setVerifyDate(e.target.checked)} />用原文核验首发日期</label>
              <label className="block space-y-1 text-xs">关键词作用
                <select className="w-full rounded border p-2" value={keywordPolicy} onChange={e=>setKeywordPolicy(e.target.value as 'assist'|'strict')}><option value="assist">辅助：允许工程主题补充命中，未命中留待复核</option><option value="strict">严格：必须匹配配置的关键词</option></select>
              </label>
              <label className="block space-y-1 text-xs">主题关键词
                <Input placeholder="逗号分隔；留空仅取消关键词限制" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              </label>
              <label className="block space-y-1 text-xs">关键词匹配方式
                <select className="w-full rounded border p-2" value={keywordMode} onChange={(e) => setKeywordMode(e.target.value as 'any' | 'all')}><option value="any">命中任意关键词</option><option value="all">命中全部关键词</option></select>
              </label>
              <label className="block space-y-1 text-xs">排除关键词
                <Input placeholder="命中任意排除词则不入池" value={excludedKeywords} onChange={(e) => setExcludedKeywords(e.target.value)} />
              </label>
              <label className="block space-y-1 text-xs">排除来源分类
                <Input value={excludedCategories} onChange={e=>setExcludedCategories(e.target.value)} placeholder="例如 Company, Global Affairs" />
              </label>
              <p className="text-[11px] text-neutral-500">按标题、分类和补抓正文匹配，支持 agent/agents、eval/evals 等变体。保存规则会重评未入池候选。未通过准入的候选不进入内容池；已入池文章保留。</p>
              </>}
              {saveMutation.error && <p role="alert" className="text-xs text-red-600">{saveMutation.error.message}</p>}
              <div className="flex items-center space-x-2.5 pt-2 border-t border-neutral-100">
                <input
                  type="checkbox"
                  id="source-enabled"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900 cursor-pointer"
                />
                <label
                  htmlFor="source-enabled"
                  className="text-xs font-medium text-neutral-700 cursor-pointer select-none"
                >
                  {isRepository ? '启用此仓库来源（同步源码并参与研读）' : '启用此信息源（独立定时采集入池）'}
                </label>
              </div>
            </div>
            <div className="shrink-0 p-4 bg-neutral-50 border-t border-neutral-100 flex items-center justify-end space-x-2">
              <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
                取消
              </Button>
              <Button
                type="submit"
                disabled={(isRepository ? !parseGitHubRepository(url) : !Number.isInteger(maxAgeDays) || maxAgeDays<1 || maxAgeDays>3650) || !name.trim() || !url.trim() || !Number.isInteger(pollInterval) || pollInterval < 1 || pollInterval > 10080 || saveMutation.isPending}
              >
                {saveMutation.isPending ? '保存中...' : editingSource ? '保存变更' : '确认保存'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
