import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Boxes,
  CheckCircle2,
  Clock,
  Cpu,
  ExternalLink,
  Github,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import { WikiDisplayConfigSchema, ExecutorConfigSchema, type ExecutorConfig } from '@openlore/contracts';
import { RepositoryWikiFields } from './RepositoryWikiFields.js';
import { ExecutorFields } from './ExecutorFields.js';
import type { AIProfile, NotificationConnection, RepositoryConnection } from '@openlore/contracts';
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

type SettingsTab = 'connections' | 'doctor';

function extractRepoName(url: string): string {
  const trimmed = url.trim();
  const m = trimmed.match(/([^/:]+?)(?:\.git)?\/?$/);
  return m ? m[1] : '';
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SettingsTab>('connections');

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const { data: repos } = useQuery({
    queryKey: ['repos'],
    queryFn: api.listRepos,
  });

  const { data: notifs } = useQuery({
    queryKey: ['notifs'],
    queryFn: api.listNotifs,
  });

  const { data: aiProfiles } = useQuery({
    queryKey: ['aiProfiles'],
    queryFn: api.listAIProfiles,
    refetchInterval: 15000,
  });

  const { data: doctor, refetch: runDoctor, isFetching: doctorRunning } = useQuery({
    queryKey: ['doctor'],
    queryFn: api.getDoctor,
  });

  // Test repo state
  const [repoTestResults, setRepoTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  // Modal States
  const [repoModal, setRepoModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    id?: string;
    url: string;
    name: string;
    branch: string;
    token: string;
    wikiBaseUrl: string;
    wikiRootPath: string;
  }>({
    open: false,
    mode: 'create',
    url: '',
    name: '',
    branch: 'main',
    token: '',
    wikiBaseUrl: '',
    wikiRootPath: 'docs',
  });

  const [aiModal, setAiModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    id?: string;
    name: string;
    provider: 'codex_cli' | 'gemini_cli';
    cliPath: string;
    model: string;
    isPrimary: boolean;
    execution: ExecutorConfig;
  }>({
    open: false,
    mode: 'create',
    name: '',
    provider: 'codex_cli',
    cliPath: 'codex',
    model: '',
    isPrimary: false,
    execution: ExecutorConfigSchema.parse({}),
  });

  const [notifModal, setNotifModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    id?: string;
    name: string;
    webhookUrl: string;
  }>({
    open: false,
    mode: 'create',
    name: '',
    webhookUrl: '',
  });

  // Mutations
  const saveRepoMutation = useMutation({
    mutationFn: api.saveRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      for (const queryKey of ['daily-feed', 'library', 'reports', 'reportPreview']) queryClient.invalidateQueries({ queryKey: [queryKey] });
      setRepoModal((prev) => ({ ...prev, open: false }));
    },
  });

  const deleteRepoMutation = useMutation({
    mutationFn: api.deleteRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      setRepoModal((prev) => ({ ...prev, open: false }));
    },
    onError: (err: any) => {
      alert(err.message || '删除仓库失败');
    },
  });

  const testRepoMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.testRepo(id);
      setRepoTestResults((prev) => ({ ...prev, [id]: res }));
      return res;
    },
  });

  const saveAiMutation = useMutation({
    mutationFn: api.saveAIProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProfiles'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setAiModal((prev) => ({ ...prev, open: false }));
    },
  });

  const deleteAiMutation = useMutation({
    mutationFn: api.deleteAIProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProfiles'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setAiModal((prev) => ({ ...prev, open: false }));
    },
    onError: (err: any) => {
      alert(err.message || '删除 AI 执行器失败');
    },
  });

  const setPrimaryAIMutation = useMutation({
    mutationFn: api.setPrimaryAIProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiProfiles'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const saveNotifMutation = useMutation({
    mutationFn: api.saveNotif,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifs'] });
      setNotifModal((prev) => ({ ...prev, open: false }));
    },
  });

  const deleteNotifMutation = useMutation({
    mutationFn: api.deleteNotif,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifs'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setNotifModal((prev) => ({ ...prev, open: false }));
    },
    onError: (err: any) => {
      alert(err.message || '删除通知通道失败');
    },
  });

  const wikiConfig = WikiDisplayConfigSchema.safeParse({ wiki_base_url: repoModal.wikiBaseUrl, wiki_root_path: repoModal.wikiRootPath });

  // Modal Handlers
  const openCreateRepoModal = () => {
    setRepoModal({
      open: true,
      mode: 'create',
      url: '',
      name: '',
      branch: 'main',
      token: '',
      wikiBaseUrl: '',
      wikiRootPath: 'docs',
    });
  };

  const openEditRepoModal = (r: RepositoryConnection) => {
    setRepoModal({
      open: true,
      mode: 'edit',
      id: r.id,
      url: `https://github.com/${r.owner}/${r.repo}.git`,
      name: r.name,
      branch: r.default_branch,
      token: '',
      wikiBaseUrl: r.wiki_base_url || '',
      wikiRootPath: r.wiki_root_path || '',
    });
  };

  const openCreateAiModal = () => {
    setAiModal({
      open: true,
      mode: 'create',
      name: '',
      provider: 'codex_cli',
      cliPath: 'codex',
      model: '',
      isPrimary: (aiProfiles?.length || 0) === 0,
      execution: ExecutorConfigSchema.parse({}),
    });
  };

  const openEditAiModal = (ai: AIProfile) => {
    setAiModal({
      open: true,
      mode: 'edit',
      id: ai.id,
      name: ai.name,
      provider: ai.provider,
      cliPath: ai.cli_path,
      model: ai.model || '',
      isPrimary: Boolean(ai.is_primary),
      execution: ai.execution,
    });
  };

  const openCreateNotifModal = () => {
    setNotifModal({
      open: true,
      mode: 'create',
      name: '',
      webhookUrl: '',
    });
  };

  const openEditNotifModal = (n: NotificationConnection) => {
    setNotifModal({
      open: true,
      mode: 'edit',
      id: n.id,
      name: n.name,
      webhookUrl: '',
    });
  };

  const TABS = [
    {
      id: 'connections' as const,
      label: '外部集成与执行器',
      icon: Plug,
      count: (repos?.length || 0) + (aiProfiles?.length || 0) + (notifs?.length || 0),
    },
    {
      id: 'doctor' as const,
      label: '系统环境自检',
      icon: Wrench,
      badge: doctor?.ok ? '正常' : '需关注',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">工作区设置</h2>
        <p className="text-neutral-500 text-sm">
          管理代码仓库、AI 执行器、群通知通道与系统健康。任务和汇报请前往对应页面。
        </p>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-neutral-200 gap-1 overflow-x-auto pb-px scrollbar-none">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'border-neutral-900 text-neutral-900 font-semibold'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800 hover:border-neutral-300'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-neutral-900' : 'text-neutral-400'}`} />
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-neutral-100 text-neutral-600 font-normal">
                  {tab.count}
                </span>
              )}

            </button>
          );
        })}
      </div>

      {/* Tab 2: 外部集成与执行器 (3 个独立卡片) */}
      {activeTab === 'connections' && (
        <div className="space-y-6">
          {/* Card 1: GitHub 仓库连接 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-neutral-100">
              <div>
                <CardTitle className="text-base flex items-center">
                  <Github className="mr-2 h-4 w-4" />
                  GitHub 仓库连接
                </CardTitle>
                <CardDescription className="text-xs text-neutral-500 mt-0.5">
                  粘贴仓库 Git 地址与 Personal Access Token，各流水线任务可按需挂载并自动推送 Markdown 归档。
                </CardDescription>
              </div>
              <Button size="sm" onClick={openCreateRepoModal} className="h-8 text-xs gap-1">
                <Plus className="w-3.5 h-3.5" />
                添加仓库
              </Button>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {repos && repos.length > 0 ? (
                <div className="space-y-2">
                  {repos.map((r) => {
                    const testRes = repoTestResults[r.id];
                    const repoUrl = `https://github.com/${r.owner}/${r.repo}`;
                    return (
                      <div
                        key={r.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 border border-neutral-200 rounded-lg gap-2 hover:bg-neutral-50/40 transition-colors"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm text-neutral-900">{r.name}</p>
                            <Badge variant={r.state === 'ready' ? 'success' : 'destructive'}>
                              {r.state}
                            </Badge>
                            <span className="text-xs text-neutral-400 font-mono">分支: {r.default_branch}</span>
                          </div>
                          <a
                            href={repoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-neutral-500 hover:text-blue-600 font-mono mt-1 inline-flex items-center gap-1"
                          >
                            <span>{repoUrl}.git</span>
                            <ExternalLink className="w-3 h-3 text-neutral-400" />
                          </a>
                          {r.wiki_base_url && <p className="mt-1 text-xs text-neutral-500 break-all">Wiki：<a href={r.wiki_base_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{r.wiki_base_url}</a> · 仓库目录：{r.wiki_root_path || '根目录'}</p>}
                          {testRes && (
                            <p className={`text-xs mt-1 ${testRes.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                              {testRes.message}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center space-x-1.5 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => testRepoMutation.mutate(r.id)}
                            disabled={testRepoMutation.isPending}
                            className="text-xs h-8"
                          >
                            测试连通性
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditRepoModal(r)}
                            className="text-xs h-8 gap-1"
                          >
                            <Pencil className="w-3.5 h-3.5 text-neutral-500" />
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (window.confirm(`确定要删除仓库「${r.name}」吗？`)) {
                                deleteRepoMutation.mutate(r.id);
                              }
                            }}
                            disabled={deleteRepoMutation.isPending}
                            className="text-xs h-8 text-neutral-400 hover:text-red-600 hover:bg-red-50 px-2"
                            title="删除仓库"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 border border-dashed border-neutral-200 rounded-lg">
                  <p className="text-xs text-neutral-400">暂无配置的仓库连接，请点击右上角「添加仓库」</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 2: AI 执行器 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-neutral-100">
              <div>
                <CardTitle className="text-base flex items-center">
                  <Cpu className="mr-2 h-4 w-4" />
                  AI 执行器
                </CardTitle>
                <CardDescription className="text-xs text-neutral-500 mt-0.5">
                  配置 Codex CLI 或 Gemini CLI。可设置主执行器，当主执行器执行报错、超时或断连时，系统自动无缝切换到备用执行器兜底。
                </CardDescription>
              </div>
              <Button size="sm" onClick={openCreateAiModal} className="h-8 text-xs gap-1">
                <Plus className="w-3.5 h-3.5" />
                添加执行器
              </Button>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {/* 主备容灾机制说明 Banner */}
              <div className="bg-amber-50/60 border border-amber-200/60 rounded-lg p-3 text-xs text-neutral-700 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold text-neutral-900 text-xs">主备容灾与自动兜底保障</p>
                  <p className="text-[11px] text-neutral-600 leading-relaxed">
                    所有 AI 提炼与深度调研优先调度「主执行器」执行。若遇 CLI 进程挂起、API 鉴权失效或请求超时，系统将自动无缝唤醒备用执行器兜底，避免流水线因单一工具不可用而中断。
                  </p>
                </div>
              </div>

              {aiProfiles && aiProfiles.length > 0 ? (
                <div className="space-y-2">
                  {aiProfiles.map((ai) => (
                    <div
                      key={ai.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between p-3.5 border rounded-lg gap-2 transition-colors ${
                        ai.is_primary ? 'border-amber-300 bg-amber-50/20' : 'border-neutral-200 hover:bg-neutral-50/40'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-neutral-900">{ai.name}</p>
                          {ai.is_primary ? (
                            <Badge className="bg-amber-500/10 text-amber-700 border-amber-300 text-[10px] font-normal">
                              <Sparkles className="w-3 h-3 mr-1 inline text-amber-600" />
                              主执行器
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-neutral-500 text-[10px] font-normal">
                              备用执行器
                            </Badge>
                          )}
                          <Badge variant={ai.state === 'ready' ? 'success' : 'warning'}>
                            {ai.state}
                          </Badge>
                        </div>
                        <p className="text-xs text-neutral-500 font-mono mt-0.5">
                          {ai.provider} · {ai.cli_path} {ai.model ? `(${ai.model})` : ''} · {ai.execution.transport === 'worker' ? (ai.worker_online ? 'Worker 在线' : 'Worker 离线') : ai.execution.transport === 'ssh' ? 'SSH' : '服务端本机'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <Button size="sm" variant="outline" onClick={async()=>{try{const result=await api.testAIProfile(ai.id);alert(result.message);queryClient.invalidateQueries({queryKey:['skills']});queryClient.invalidateQueries({queryKey:['aiProfiles']});}catch(error:any){alert(error.message);}}}>测试连接</Button>
                        {ai.execution.transport==='worker'&&<Button size="sm" variant="outline" onClick={async()=>{
                          if(ai.worker_paired&&!window.confirm('重新配对会使旧令牌失效，是否继续？'))return;
                          try{const paired=await api.pairAIProfile(ai.id);const json=JSON.stringify({server_url:window.location.origin,profile_id:paired.profile_id,token:paired.token,name:ai.name},null,2);const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`openlore-worker-${ai.id}.json`;link.click();URL.revokeObjectURL(url);queryClient.invalidateQueries({queryKey:['aiProfiles']});alert('已下载 Worker 配置文件（包含专用令牌）。在本机运行：node apps/server/dist/cli/index.js worker <配置文件路径>');}catch(error:any){alert(error.message);}
                        }}>下载配对配置</Button>}
                        {!ai.is_primary && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPrimaryAIMutation.mutate(ai.id)}
                            disabled={setPrimaryAIMutation.isPending}
                            className="text-xs h-8 text-neutral-700"
                          >
                            设为主执行器
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditAiModal(ai)}
                          className="text-xs h-8 gap-1"
                        >
                          <Pencil className="w-3.5 h-3.5 text-neutral-500" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`确定要删除 AI 执行器「${ai.name}」吗？`)) {
                              deleteAiMutation.mutate(ai.id);
                            }
                          }}
                          disabled={deleteAiMutation.isPending}
                          className="text-xs h-8 text-neutral-400 hover:text-red-600 hover:bg-red-50 px-2"
                          title="删除执行器"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 border border-dashed border-neutral-200 rounded-lg">
                  <p className="text-xs text-neutral-400">暂无 AI 执行器配置，请点击右上角「添加执行器」</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 3: 消息通知 Webhook */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-neutral-100">
              <div>
                <CardTitle className="text-base flex items-center">
                  <Send className="mr-2 h-4 w-4" />
                  消息通知 Webhook
                </CardTitle>
                <CardDescription className="text-xs text-neutral-500 mt-0.5">
                  配置汇报推送使用的 Webhook 目标通道，支持企微、飞书、钉钉等标准协议。
                </CardDescription>
              </div>
              <Button size="sm" onClick={openCreateNotifModal} className="h-8 text-xs gap-1">
                <Plus className="w-3.5 h-3.5" />
                添加通知通道
              </Button>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {notifs && notifs.length > 0 ? (
                <div className="space-y-2">
                  {notifs.map((n) => (
                    <div
                      key={n.id}
                      className="flex items-center justify-between p-3.5 border border-neutral-200 rounded-lg hover:bg-neutral-50/40 transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-neutral-900">{n.name}</p>
                          <Badge variant={n.state === 'ready' ? 'success' : 'destructive'}>
                            {n.state}
                          </Badge>
                        </div>
                        <p className="text-xs text-neutral-500 font-mono mt-0.5">协议: {n.protocol}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditNotifModal(n)}
                          className="text-xs h-8 gap-1"
                        >
                          <Pencil className="w-3.5 h-3.5 text-neutral-500" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`确定要删除通知通道「${n.name}」吗？`)) {
                              deleteNotifMutation.mutate(n.id);
                            }
                          }}
                          disabled={deleteNotifMutation.isPending}
                          className="text-xs h-8 text-neutral-400 hover:text-red-600 hover:bg-red-50 px-2"
                          title="删除通知通道"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 border border-dashed border-neutral-200 rounded-lg">
                  <p className="text-xs text-neutral-400">暂无通知通道配置，请点击右上角「添加通知通道」</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 3: 系统环境自检 (Doctor) */}
      {activeTab === 'doctor' && (
        <Card className="border-neutral-200">
          <CardHeader className="pb-3 border-b border-neutral-100">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center">
                  <Wrench className="mr-2 h-4 w-4 text-neutral-600" />
                  系统环境自检 (Doctor)
                </CardTitle>
                <CardDescription className="text-xs text-neutral-500 mt-0.5">
                  自动化排查 Node.js 运行时、Git CLI、SQLite 数据库及 AI 执行器连通性。
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {doctor && (
                  <Badge variant={doctor.ok ? 'success' : 'warning'}>
                    {doctor.ok ? '全部检查通过' : '需要关注'}
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runDoctor()}
                  disabled={doctorRunning}
                  className="h-8 text-xs"
                >
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${doctorRunning ? 'animate-spin' : ''}`} />
                  重新诊断
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-2 text-sm">
            {doctor ? (
              doctor.checks.map((chk, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2.5 px-3 border border-neutral-100 rounded-lg hover:bg-neutral-50/60 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${
                        chk.status === 'pass'
                          ? 'text-emerald-600'
                          : chk.status === 'warn'
                          ? 'text-amber-500'
                          : 'text-red-500'
                      }`}
                    />
                    <span className="font-medium text-neutral-800">{chk.name}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-neutral-500 text-xs">{chk.message}</span>
                    <Badge
                      variant={
                        chk.status === 'pass'
                          ? 'success'
                          : chk.status === 'warn'
                          ? 'warning'
                          : 'destructive'
                      }
                    >
                      {chk.status}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-neutral-400 py-6 text-center">正在读取系统诊断数据...</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modal 1: GitHub 仓库创建与编辑弹窗 */}
      {repoModal.open && (
        <div className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto border border-neutral-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-100 bg-neutral-50/60">
              <h3 className="font-bold text-sm text-neutral-900 flex items-center gap-2">
                <Github className="w-4 h-4 text-neutral-700" />
                {repoModal.mode === 'edit' ? '编辑 GitHub 仓库连接' : '添加 GitHub 仓库连接'}
              </h3>
              <button
                type="button"
                onClick={() => setRepoModal((prev) => ({ ...prev, open: false }))}
                className="text-neutral-400 hover:text-neutral-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-700">仓库 Git 地址</label>
                <Input
                  placeholder="如 https://github.com/raven-ai-labs/openlore-knowledge-vault.git"
                  value={repoModal.url}
                  onChange={(e) => {
                    const newUrl = e.target.value;
                    setRepoModal((prev) => {
                      const prevExtracted = extractRepoName(prev.url);
                      const newExtracted = extractRepoName(newUrl);
                      const shouldUpdateName = !prev.name || prev.name === prevExtracted;
                      return {
                        ...prev,
                        url: newUrl,
                        name: shouldUpdateName && newExtracted ? newExtracted : prev.name,
                      };
                    });
                  }}
                />
                <p className="text-[11px] text-neutral-400">
                  直接粘贴完整 Git 地址或 <code>owner/repo</code> 简写，系统会自动解析用户名与仓库名
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-neutral-700">连接别名 (选填)</label>
                  <Input
                    placeholder="留空默认为仓库名"
                    value={repoModal.name}
                    onChange={(e) => setRepoModal((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-neutral-700">默认分支</label>
                  <Input
                    placeholder="默认 main"
                    value={repoModal.branch}
                    onChange={(e) => setRepoModal((prev) => ({ ...prev, branch: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-700">Personal Access Token</label>
                <Input
                  type="password"
                  placeholder={repoModal.mode === 'edit' ? '留空保持原有 Token' : 'ghp_... (需要 repo 读写权限)'}
                  value={repoModal.token}
                  onChange={(e) => setRepoModal((prev) => ({ ...prev, token: e.target.value }))}
                />
                <p className="text-[11px] text-neutral-400">
                  {repoModal.mode === 'edit' ? '若无需更换 Token 请直接留空' : '保存时将自动执行连通性校验'}
                </p>
              </div>
            </div>
            <RepositoryWikiFields value={repoModal} onChange={(wiki) => setRepoModal((previous) => ({ ...previous, ...wiki }))} />
            <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/50 flex items-center justify-between gap-2">
              <div>
                {repoModal.mode === 'edit' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs gap-1 h-8 px-2"
                    disabled={deleteRepoMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`确定要删除仓库配置「${repoModal.name || repoModal.url}」吗？`)) {
                        deleteRepoMutation.mutate(repoModal.id!);
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除此配置
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRepoModal((prev) => ({ ...prev, open: false }))}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  disabled={
                    !repoModal.url ||
                    !wikiConfig.success ||
                    (repoModal.mode === 'create' && !repoModal.token) ||
                    saveRepoMutation.isPending
                  }
                  onClick={() =>
                    saveRepoMutation.mutate({
                      id: repoModal.id,
                      url: repoModal.url,
                      name: repoModal.name || undefined,
                      defaultBranch: repoModal.branch || 'main',
                      token: repoModal.token || undefined,
                      wikiBaseUrl: repoModal.wikiBaseUrl,
                      wikiRootPath: repoModal.wikiRootPath,
                    })
                  }
                >
                  {saveRepoMutation.isPending ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: AI 执行器创建与编辑弹窗 */}
      {aiModal.open && (
        <div className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full max-h-[92vh] flex flex-col border border-neutral-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-100 bg-neutral-50/60">
              <h3 className="font-bold text-sm text-neutral-900 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-neutral-700" />
                {aiModal.mode === 'edit' ? '编辑AI 执行器' : '添加AI 执行器'}
              </h3>
              <button
                type="button"
                onClick={() => setAiModal((prev) => ({ ...prev, open: false }))}
                className="text-neutral-400 hover:text-neutral-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3.5 overflow-y-auto flex-1">
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-700">配置名称</label>
                <Input
                  placeholder="如 本地 Codex"
                  value={aiModal.name}
                  onChange={(e) => setAiModal((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-700">执行器类型</label>
                <select
                  className="w-full h-9 px-3 rounded-md border border-neutral-200 text-sm bg-white"
                  value={aiModal.provider}
                  onChange={(e) => setAiModal((prev) => ({ ...prev, provider: e.target.value as any, cliPath: ['codex','gemini'].includes(prev.cliPath) ? (e.target.value === 'gemini_cli' ? 'gemini' : 'codex') : prev.cliPath, execution: e.target.value === 'gemini_cli' ? {...prev.execution,config_profile:'',inherit_user_config:true} : prev.execution }))}
                >
                  <option value="codex_cli">Codex CLI</option>
                  <option value="gemini_cli">Gemini CLI</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-700">可执行路径</label>
                <Input
                  placeholder="如 codex 或绝对路径 /usr/local/bin/codex"
                  value={aiModal.cliPath}
                  onChange={(e) => setAiModal((prev) => ({ ...prev, cliPath: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-700">指定模型 (选填)</label>
                <Input
                  placeholder="留空则使用 CLI 默认模型"
                  value={aiModal.model}
                  onChange={(e) => setAiModal((prev) => ({ ...prev, model: e.target.value }))}
                />
              </div>
              <ExecutorFields provider={aiModal.provider} value={aiModal.execution} onChange={(execution)=>setAiModal((previous)=>({...previous,execution}))} />
              {saveAiMutation.error&&<p role="alert" className="text-xs text-red-600">{saveAiMutation.error.message}</p>}
              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={aiModal.isPrimary}
                    onChange={(e) => setAiModal((prev) => ({ ...prev, isPrimary: e.target.checked }))}
                    className="rounded border-neutral-300 text-amber-600 focus:ring-amber-500 h-4 w-4"
                  />
                  <span className="text-xs font-medium text-neutral-800">
                    设为主执行器 (优先调度执行，异常时自动由备用执行器兜底)
                  </span>
                </label>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/50 flex items-center justify-between gap-2">
              <div>
                {aiModal.mode === 'edit' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs gap-1 h-8 px-2"
                    disabled={deleteAiMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`确定要删除 AI 执行器「${aiModal.name}」吗？`)) {
                        deleteAiMutation.mutate(aiModal.id!);
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除此配置
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAiModal((prev) => ({ ...prev, open: false }))}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  disabled={!aiModal.name || !aiModal.cliPath || saveAiMutation.isPending}
                  onClick={() =>
                    saveAiMutation.mutate({
                      id: aiModal.id,
                      name: aiModal.name,
                      provider: aiModal.provider,
                      cliPath: aiModal.cliPath,
                      model: aiModal.model || undefined,
                      is_primary: aiModal.isPrimary,
                      execution: aiModal.execution,
                    })
                  }
                >
                  {saveAiMutation.isPending ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: 通知通道创建与编辑弹窗 */}
      {notifModal.open && (
        <div className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-neutral-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-100 bg-neutral-50/60">
              <h3 className="font-bold text-sm text-neutral-900 flex items-center gap-2">
                <Send className="w-4 h-4 text-neutral-700" />
                {notifModal.mode === 'edit' ? '编辑消息通知通道' : '添加消息通知通道'}
              </h3>
              <button
                type="button"
                onClick={() => setNotifModal((prev) => ({ ...prev, open: false }))}
                className="text-neutral-400 hover:text-neutral-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-700">通道名称</label>
                <Input
                  placeholder="如 核心技术群 Webhook"
                  value={notifModal.name}
                  onChange={(e) => setNotifModal((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-700">Webhook 地址 (HTTP POST)</label>
                <Input
                  placeholder={notifModal.mode === 'edit' ? '留空保持原有 Webhook 地址' : 'https://example.com/webhook'}
                  value={notifModal.webhookUrl}
                  onChange={(e) => setNotifModal((prev) => ({ ...prev, webhookUrl: e.target.value }))}
                />
                <p className="text-[11px] text-neutral-400">
                  {notifModal.mode === 'edit' ? '若无需更换 Webhook 地址请直接留空' : '支持企业微信、飞书机器人、钉钉等标准 Webhook'}
                </p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/50 flex items-center justify-between gap-2">
              <div>
                {notifModal.mode === 'edit' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs gap-1 h-8 px-2"
                    disabled={deleteNotifMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`确定要删除通知通道「${notifModal.name}」吗？`)) {
                        deleteNotifMutation.mutate(notifModal.id!);
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除此配置
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNotifModal((prev) => ({ ...prev, open: false }))}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  disabled={
                    !notifModal.name ||
                    (notifModal.mode === 'create' && !notifModal.webhookUrl) ||
                    saveNotifMutation.isPending
                  }
                  onClick={() =>
                    saveNotifMutation.mutate({
                      id: notifModal.id,
                      name: notifModal.name,
                      webhookUrl: notifModal.webhookUrl || undefined,
                    })
                  }
                >
                  {saveNotifMutation.isPending ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
