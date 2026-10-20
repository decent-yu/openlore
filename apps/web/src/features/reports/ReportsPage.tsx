import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Clock, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { DEFAULT_REPORT_TEMPLATE, DEFAULT_REPORT_CARD_TITLE, ReportCardTitleTemplateSchema, ReportTemplateSchema, type ReportPlan } from '@openlore/contracts';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { api } from '../../lib/api.js';
import { FeishuCardPreview } from './FeishuCardPreview.js';
import { ReportTemplateEditor } from './ReportTemplateEditor.js';
import { useDialog } from '../../lib/useDialog.js';

const statuses: Record<string, string> = {
  succeeded: '已完成归档',
  running: '处理中',
  failed: '执行失败',
  partial: '部分失败',
  not_run: '今天尚未运行',
  missing: '任务已删除',
  cancelled: '已取消',
};
type Draft = Omit<ReportPlan, 'id'> & { id?: string };
const empty: Draft = {
  name: '',
  enabled: true,
  schedule_cron: '0 9 * * *',
  timezone: 'Asia/Shanghai',
  notification_connection_id: null,
  template: DEFAULT_REPORT_TEMPLATE,
  card_title_template: DEFAULT_REPORT_CARD_TITLE,
  pipeline_ids: [],
};
export function ReportsPage() {
  const client = useQueryClient();
  const [search] = useSearchParams();
  const requestedPipeline = search.get('pipeline');
  const {
    data: plans = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ['reportPlans'], queryFn: api.listReportPlans });
  const { data: tasks = [] } = useQuery({
    queryKey: ['groups'],
    queryFn: api.listGroups,
  });
  const { data: channels = [] } = useQuery({
    queryKey: ['notifs'],
    queryFn: api.listNotifs,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previewId, setPreviewId] = useState('');
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const {
    data: preview,
    refetch,
    error: previewError,
  } = useQuery({
    queryKey: ['reportPreview', previewId],
    queryFn: () => api.previewReport(previewId),
    enabled: Boolean(previewId),
    refetchInterval: 15000,
  });
  const selectedPlan = plans.find((plan) => plan.id === previewId);
  const invalidate = () => {
    client.invalidateQueries({ queryKey: ['reportPlans'] });
    client.invalidateQueries({ queryKey: ['reportPreview'] });
  };
  const save = useMutation({
    mutationFn: api.saveReportPlan,
    onSuccess: (plan) => {
      invalidate();
      setMessageError(false);
      setDraft(null);
      setPreviewId(plan.id);
      setMessage(`「${plan.name}」已保存`);
    },
  });
  const toggle = useMutation({
    mutationFn: api.saveReportPlan,
    onSuccess: invalidate,
    onError: (error) => { setMessageError(true); setMessage(error.message); },
  });
  const remove = useMutation({
    mutationFn: api.deleteReportPlan,
    onMutate: async (id) => {
      if (previewId === id) setPreviewId('');
      await client.cancelQueries({ queryKey: ['reportPreview', id] });
    },
    onSuccess: (_, id) => {
      client.invalidateQueries({ queryKey: ['reportPlans'] });
      setMessageError(false);
      setMessage('汇报方案已删除');
    },
    onError: (error) => { setMessageError(true); setMessage(error.message); },
  });
  const send = useMutation({
    mutationFn: api.sendReport,
    onSuccess: (result) => {
      setMessageError(!result.ok);
      setMessage(result.message);
      client.invalidateQueries({ queryKey: ['pushDeliveries'] });
    },
    onError: (error) => { setMessageError(true); setMessage(error.message); },
  });
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((previous) =>
      previous ? { ...previous, [key]: value } : previous,
    );
  const edit = (plan?: ReportPlan) => {
    save.reset();
    setDraft(
      plan
        ? { ...plan }
        : {
            ...empty,
            notification_connection_id: channels[0]?.id || null,
            pipeline_ids:
              requestedPipeline &&
              tasks.some((task) => task.id === requestedPipeline)
                ? [requestedPipeline]
                : [],
          },
    );
  };
  useDialog(Boolean(draft), () => setDraft(null));
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">汇报推送</h2>
          <p className="mt-1 text-sm text-neutral-500">
            按群与受众建立汇报方案，分别汇总任务结果。
          </p>
        </div>
        <Button onClick={() => edit()}>
          <Plus className="mr-2 h-4 w-4" />
          新建汇报方案
        </Button>
      </header>
      {requestedPipeline && (
        <p className="text-xs text-neutral-500">
          新建方案时将预选「
          {tasks.find((task) => task.id === requestedPipeline)?.name ||
            requestedPipeline}
          」。同一个任务可以加入多个汇报方案。
        </p>
      )}
      {message && (
        <p role={messageError ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${messageError ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error.message}
        </p>
      )}
      {isLoading && <p>正在加载汇报方案…</p>}
      {!isLoading && plans.length === 0 && (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-neutral-500">
          还没有汇报方案。可以分别创建「Agent 日报 → 群 A」和「前端日报 → 群
          B」。
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {plans.map((plan) => (
          <article
            key={plan.id}
            className={`space-y-4 rounded-xl border bg-white p-5 ${previewId === plan.id ? 'border-blue-300 shadow-sm' : 'border-neutral-200'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 font-semibold">
                  <Send className="h-4 w-4 text-blue-600" />
                  {plan.name}
                </h3>
                <p className="mt-1 text-xs text-neutral-500">
                  发送到：
                  {channels.find(
                    (channel) => channel.id === plan.notification_connection_id,
                  )?.name || '未配置通道'}
                </p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                <input
                  type="checkbox"
                  checked={plan.enabled}
                  disabled={toggle.isPending}
                  onChange={(event) =>
                    toggle.mutate({ ...plan, enabled: event.target.checked })
                  }
                />
                启用
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.pipeline_ids.map((id) => (
                <span
                  key={id}
                  className="rounded-md border border-neutral-200/70 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600"
                >
                  {tasks.find((task) => task.id === id)?.name || id}
                </span>
              ))}
            </div>
            <div className="space-y-1 text-[11px] text-neutral-500">
              <p className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {plan.schedule_cron} · {plan.timezone}
              </p>
              <p>可配置模板 · 程序生成 · 无 AI 调用</p>
            </div>
            <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPreviewId(plan.id)}
              >
                查看今天的汇报
              </Button>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => edit(plan)}>
                  <Pencil className="mr-1 h-3 w-3" />
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`删除 ${plan.name}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `删除汇报方案「${plan.name}」？任务与历史推送记录会保留。`,
                      )
                    )
                      remove.mutate(plan.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-neutral-400" />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {selectedPlan && (
        <section className="space-y-4 rounded-xl border bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">{selectedPlan.name} · 汇报预览</h3>
              <p className="mt-1 text-xs text-neutral-500">
                {preview
                  ? preview.state === 'invalid_config'
                    ? preview.message
                    : '手动推送当前预览，无需等待全部任务完成，允许重复发送。'
                  : '正在加载任务结果…'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => refetch()}>
                刷新
              </Button>
              <Button
                disabled={!preview || preview.state === 'invalid_config' || send.isPending}
                onClick={() => send.mutate(selectedPlan.id)}
              >
                <Send className="mr-1 h-4 w-4" />
                {send.isPending ? '发送中…' : '立即汇总推送'}
              </Button>
            </div>
          </div>
          {previewError && (
            <p role="alert" className="text-red-600">
              {previewError.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {preview?.tasks.map((task) => (
              <span
                key={task.id}
                className="rounded border bg-neutral-50 px-2 py-1 text-xs"
              >
                {task.name}：{statuses[task.status] || task.status} ·{' '}
                {task.count} 篇
              </span>
            ))}
          </div>
          {preview?.summary && (
            <div className="space-y-2 rounded-lg bg-neutral-50 p-4">
              <p className="text-xs font-medium text-neutral-600">飞书卡片模拟 · 真实数据</p>
              <FeishuCardPreview title={preview.card_title} markdown={preview.summary} />
              <p className="text-[11px] text-neutral-500">标题和正文与实际发送内容一致，排版以飞书客户端为准。</p>
            </div>
          )}
          <p className="text-[11px] text-neutral-500">
            预览即按模板生成的待发送正文，不调用 AI。手动推送可重复发送，方便测试；定时推送仍会跳过当天已成功发送的汇报。
          </p>
        </section>
      )}
      <Link
        to="/runs"
        className="inline-block text-xs text-blue-700 hover:underline"
      >
        查看历史推送记录 →
      </Link>
      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-title"
        >
          <form
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(draft);
            }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <Send className="h-5 w-5 text-neutral-700" />
                <h3 id="report-title" className="text-base font-semibold">
                  {draft.id ? '编辑汇报方案' : '新建汇报方案'}
                </h3>
              </div>
              <button
                type="button"
                aria-label="关闭"
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100"
                onClick={() => setDraft(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              <label className="block text-xs font-medium text-neutral-700">
                方案名称 *
                <Input
                  className="mt-1.5 h-9"
                  required
                  placeholder="例如 Agent 日报 · 工程群"
                  value={draft.name}
                  onChange={(event) => update('name', event.target.value)}
                />
              </label>
              <section className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4">
                <h4 className="text-sm font-semibold">1 · 选择任务结果</h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {tasks.map((task) => (
                    <label
                      key={task.id}
                      className={`flex items-start gap-2 rounded-md border bg-white p-3 ${draft.pipeline_ids.includes(task.id) ? 'border-blue-200' : 'border-neutral-200'}`}
                    >
                      <input
                        className="mt-0.5 accent-blue-600"
                        type="checkbox"
                        checked={draft.pipeline_ids.includes(task.id)}
                        onChange={(event) =>
                          update(
                            'pipeline_ids',
                            event.target.checked
                              ? [...draft.pipeline_ids, task.id]
                              : draft.pipeline_ids.filter(
                                  (id) => id !== task.id,
                                ),
                          )
                        }
                      />
                      <span className="text-xs font-medium">
                        {task.name}
                        <span className="mt-1 block text-[11px] font-normal text-neutral-400">
                          {task.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-neutral-500">
                  支持多个任务。所选任务今天全部成功归档后发送，未就绪则等待；相同文章自动去重。
                </p>
              </section>
              <section className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4">
                <ReportTemplateEditor value={draft.template} titleTemplate={draft.card_title_template} onTitleChange={(value) => update('card_title_template', value)} reportName={draft.name} taskNames={tasks.filter((task) => draft.pipeline_ids.includes(task.id)).map((task) => task.name)} onChange={(value) => update('template', value)} />
              </section>
              <section className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4">
                <h4 className="text-sm font-semibold">3 · 推送到群</h4>
                <label className="block text-xs font-medium text-neutral-600">
                  目标群通知通道
                  <select
                    className="mt-1.5 h-9 w-full rounded-md border bg-white px-3 text-xs"
                    required
                    value={draft.notification_connection_id || ''}
                    onChange={(event) =>
                      update(
                        'notification_connection_id',
                        event.target.value || null,
                      )
                    }
                  >
                    <option value="">选择通道</option>
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Link
                  className="inline-block text-[11px] text-blue-700"
                  to="/settings"
                >
                  管理通知通道 →
                </Link>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-neutral-600">
                    发送计划（Cron）
                    <Input
                      className="mt-1.5 h-8 bg-white font-mono text-xs"
                      required
                      value={draft.schedule_cron}
                      onChange={(event) =>
                        update('schedule_cron', event.target.value)
                      }
                    />
                    <span className="mt-1 block text-[10px] text-neutral-400">
                      例如每天 09:00：0 9 * * *
                    </span>
                  </label>
                  <label className="text-xs text-neutral-600">
                    时区
                    <Input
                      className="mt-1.5 h-8 bg-white text-xs"
                      required
                      value={draft.timezone}
                      onChange={(event) =>
                        update('timezone', event.target.value)
                      }
                    />
                  </label>
                </div>
              </section>
              {save.error && (
                <p
                  role="alert"
                  className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                >
                  {save.error.message}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-neutral-100 bg-neutral-50 px-6 py-4">
              <label className="flex items-center gap-2 text-xs text-neutral-600">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => update('enabled', event.target.checked)}
                />
                启用定时汇报
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDraft(null)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={save.isPending || !ReportTemplateSchema.safeParse(draft.template).success || !ReportCardTitleTemplateSchema.safeParse(draft.card_title_template).success}>
                  {save.isPending ? '保存中…' : '保存方案'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
