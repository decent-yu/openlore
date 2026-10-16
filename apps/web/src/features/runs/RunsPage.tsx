import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api.js';

const stages: Record<string, string> = {
  processing: 'AI 审核',
  research: '深度调研',
  delivery: 'GitHub 归档',
  completed: '已完成',
};
const statuses: Record<string, string> = {
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  partial: '部分失败',
  queued: '排队中',
};
export function RunsPage() {
  const client = useQueryClient();
  const [fullReport, setFullReport] = useState<{title:string;markdown:string}|null>(null);
  const [detailError, setDetailError] = useState('');
  const { data: runs = [], error } = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.listRuns(),
    refetchInterval: 10000,
  });
  const { data: pushes = [] } = useQuery({
    queryKey: ['pushDeliveries'],
    queryFn: api.listPushDeliveries,
    refetchInterval: 15000,
  });
  useEffect(() => {
    const events = new EventSource('/api/v1/events');
    events.onmessage = () => {
      client.invalidateQueries({ queryKey: ['runs'] });
      client.invalidateQueries({ queryKey: ['pushDeliveries'] });
    };
    return () => events.close();
  }, [client]);
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold">运行记录</h2>
        <p className="mt-1 text-sm text-neutral-500">
          查看流水线审核、调研、归档进度，以及独立的汇报推送结果。
        </p>
      </header>
      {error && (
        <p role="alert" className="text-red-600">
          {error.message}
        </p>
      )}
      <section className="space-y-3">
        <div className="flex justify-between">
          <h3 className="font-semibold">流水线任务</h3>
          <Link to="/pipelines" className="text-sm text-blue-700">
            管理任务 →
          </Link>
        </div>
        {runs.length === 0 && (
          <p className="rounded-lg border p-8 text-center text-neutral-500">
            暂无任务运行记录
          </p>
        )}
        {runs.map((run) => (
          <article key={run.id} className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <strong>{run.group_name}</strong>
              <span
                className={
                  run.status === 'failed'
                    ? 'text-red-600'
                    : run.status === 'succeeded'
                      ? 'text-emerald-700'
                      : 'text-blue-700'
                }
              >
                {statuses[run.status] || run.status} ·{' '}
                {stages[run.stage] || run.stage}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              开始：{new Date(run.started_at).toLocaleString()}{' '}
              {run.finished_at
                ? `· 结束：${new Date(run.finished_at).toLocaleString()}`
                : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <span>扫描文章 {run.counts.observed}</span>
              <span>参与评估 {run.counts.candidate}</span>
              <span>精选 {run.counts.selected}</span>
              <span>
                调研{' '}
                {run.output?.entries.filter((entry) => entry.is_deep_analyzed)
                  .length || 0}
              </span>
              <span>审核排除 {run.counts.excluded}</span>
              {!!run.counts.deferred && <span>合格待选 {run.counts.deferred}</span>}
              <span>已精选/调研跳过 {run.counts.already_processed}</span>
            </div>
            <p className="mt-2 text-xs text-neutral-500">来源范围内，除已精选或已深度调研外，池内文章全部参与评估；精选篇数只限制输出。</p>
            {run.error_message && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {run.error_message}
              </p>
            )}
            {run.output?.commit_url && (
              <a
                className="mt-2 inline-block text-sm text-blue-700"
                href={run.output.commit_url}
                target="_blank"
                rel="noreferrer"
              >
                查看 GitHub 归档
              </a>
            )}
            <details className="mt-3 border-t pt-3">
              <summary className="cursor-pointer text-sm">
                查看 AI 处理记录（{run.ai_logs.length}）
              </summary>
              <div className="mt-2 space-y-2">
                {run.ai_logs.map((log, index) => (
                  <details
                    key={index}
                    className="rounded border bg-neutral-50 p-3"
                  >
                    <summary className="cursor-pointer text-sm">
                      {log.article_title || log.task_type} · {log.status}
                    </summary>
                    <p className="mt-2 text-xs text-neutral-500">{log.model}</p>
                    {log.execution && <p className="mt-1 break-all text-[10px] text-neutral-400">{log.execution.mode === 'native' ? '工作区 Skill' : '工作区路径加载'} · 版本 {log.execution.skill_revision?.slice(0,12)} · {log.execution.workspace}</p>}
                    <p className="mt-3 text-[11px] font-semibold text-neutral-600">实际任务 Prompt · {log.skill_id}</p>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                      {log.prompt_preview}
                    </pre>
                    <p className="mt-3 text-[11px] font-semibold text-neutral-600">AI 返回结果</p>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                      {log.response_preview}
                    </pre>
                    {log.task_type === 'research' && log.article_id && <button type="button" className="mt-3 text-xs text-blue-700 underline" onClick={async()=>{
                      try {
                        setDetailError('');
                        const reports=await api.listResearch(run.group_id);
                        const report=reports.filter((task)=>task.article_id===log.article_id && task.status==='succeeded' && task.created_at>=run.started_at && task.created_at<=log.timestamp).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
                        if(!report)throw new Error('没有找到本次运行生成的完整文章');
                        setFullReport({title:log.article_title || '深度调研文章',markdown:report.report_markdown});
                      }catch(error:any){setDetailError(error.message);}
                    }}>查看本次生成的完整文章</button>}
                  </details>
                ))}
              </div>
            </details>
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <div className="flex justify-between">
          <h3 className="font-semibold">汇报推送</h3>
          <Link to="/reports" className="text-sm text-blue-700">
            配置汇报 →
          </Link>
        </div>
        {pushes.length === 0 && (
          <p className="rounded-lg border p-8 text-center text-neutral-500">
            暂无推送记录
          </p>
        )}
        {pushes.map((push) => (
          <details key={push.id} className="rounded-xl border bg-white p-4">
            <summary className="cursor-pointer text-sm">
              {new Date(push.created_at).toLocaleString()} · {push.headline} · {push.webhook_name}{' '}
              · {push.status === 'sent' ? '已发送' : push.status} ·{' '}
              {push.total_count} 篇
            </summary>
            {push.error_message && (
              <p className="mt-2 text-sm text-red-600">{push.error_message}</p>
            )}
            <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
              {push.summary}
            </pre>
            {push.platform_response && <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-xs text-neutral-600">查看通知平台回执</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{push.platform_response}</pre></details>}
          </details>
        ))}
      </section>
      {detailError && <p role="alert" className="text-sm text-red-600">{detailError}</p>}
      {fullReport && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="full-report-title"><div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"><div className="flex items-center justify-between gap-3 border-b p-5"><h3 id="full-report-title" className="text-sm font-semibold">{fullReport.title}</h3><button type="button" className="shrink-0 text-sm text-neutral-500" onClick={()=>setFullReport(null)}>关闭文章</button></div><div className="prose prose-sm max-w-none overflow-y-auto p-6"><ReactMarkdown remarkPlugins={[remarkGfm]}>{fullReport.markdown}</ReactMarkdown></div></div></div>}
    </div>
  );
}
