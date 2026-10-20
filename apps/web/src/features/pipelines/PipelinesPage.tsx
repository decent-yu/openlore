import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bot, GitBranch, Pencil, Play, Plus, Workflow, X } from "lucide-react";
import {
  buildSelectionPrompt,
  buildResearchPrompt,
  GITHUB_CODE_RESEARCH_SKILL,
  type Group,
  type Skill,
} from "@openlore/contracts";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { api } from "../../lib/api.js";
import { useDialog } from "../../lib/useDialog.js";

const fieldClass =
  "w-full rounded-md border border-neutral-200 bg-white p-2 text-sm";
const initialForm = {
  name: "",
  description: "",
  preferences: "",
  enabled: true,
  schedule_cron: "0 8 * * *",
  timezone: "Asia/Shanghai",
  source_ids: [] as string[],
  deep_analysis_count: 3,
  ai_profile_id: "",
  selection_skill_id: "article-selector",
  research_skill_id: "deep-research-expert",
  research_instructions: "",
  repository_connection_id: "",
  base_path: "docs/agent-learning",
};

export function PipelinesPage() {
  const queryClient = useQueryClient();
  const {
    data: groups = [],
    isLoading,
    error,
  } = useQuery({ queryKey: ["groups"], queryFn: api.listGroups });
  const { data: sources = [] } = useQuery({
    queryKey: ["sources"],
    queryFn: api.listSources,
  });
  const { data: repos = [] } = useQuery({
    queryKey: ["repos"],
    queryFn: api.listRepos,
  });
  const { data: profiles = [] } = useQuery({
    queryKey: ["aiProfiles"],
    queryFn: api.listAIProfiles,
  });
  const { data: runs = [] } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.listRuns(),
    refetchInterval: 5000,
  });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [form, setForm] = useState(initialForm);
  const scopeHasCode = (ids: string[]) => sources.some(source => source.capability_id === 'github_repository' && (!ids.length || ids.includes(source.id)));
  const scopeHasArticles = (ids: string[]) => !sources.length || sources.some(source => source.capability_id !== 'github_repository' && (!ids.length || ids.includes(source.id)));
  const { data: skills = [] } = useQuery({
    queryKey: ["skills", form.ai_profile_id || "default"],
    queryFn: () => api.listSkills(form.ai_profile_id || "default"),
  });
  const [message, setMessage] = useState("");
  const update = <K extends keyof typeof initialForm>(
    key: K,
    value: (typeof initialForm)[K],
  ) => setForm((previous) => ({ ...previous, [key]: value }));
  const save = useMutation({
    mutationFn: api.saveGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setOpen(false);
      setMessage("流水线任务已保存");
    },
  });
  const run = useMutation({
    mutationFn: api.triggerGroupRun,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["daily-feed"] });
      setMessage("任务已启动，可在运行记录查看选文、调研与归档进度");
    },
    onError: (error) => setMessage(error.message),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.toggleGroup(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups"] }),
    onError: (error) => setMessage(error.message),
  });
  const edit = (group?: Group) => {
    setEditingId(group?.id);
    save.reset();
    setForm(
      group
        ? {
            name: group.name,
            description: group.description,
            preferences: group.preferences,
            enabled: group.enabled,
            schedule_cron: group.schedule_cron,
            timezone: initialForm.timezone,
            source_ids: group.source_ids,
            deep_analysis_count: group.deep_analysis_count,
            ai_profile_id: group.ai_profile_id || "",
            selection_skill_id: group.selection_skill_id,
            research_skill_id: group.research_skill_id,
            research_instructions: group.research_instructions,
            repository_connection_id: group.route.repository_connection_id,
            base_path: group.route.base_path,
          }
        : {
            ...initialForm,
            repository_connection_id: repos[0]?.id || "",
            ai_profile_id:
              profiles.find((profile) => profile.is_primary)?.id || "",
          },
    );
    setOpen(true);
  };
  useDialog(open, () => setOpen(false));
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">流水线任务</h2>
          <p className="mt-1 text-sm text-neutral-500">
            围绕一个主题，从内容池筛选与调研，再归档到 GitHub。
          </p>
        </div>
        <Button onClick={() => edit()}>
          <Plus className="mr-2 h-4 w-4" />
          新建任务
        </Button>
      </header>
      {message && (
        <p role="status" className="rounded border bg-blue-50 p-3 text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error.message}
        </p>
      )}
      {isLoading && <p>正在加载任务…</p>}
      {!isLoading && groups.length === 0 && (
        <div className="rounded-xl border border-dashed p-12 text-center text-neutral-500">
          还没有任务。创建一个 Agent、前端或其他学习主题的流水线。
        </div>
      )}
      {groups.map((group) => (
        <article
          key={group.id}
          className="space-y-4 rounded-xl border bg-white p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Workflow className="h-5 w-5 text-blue-600" />
                {group.name}
              </h3>
              <p className="mt-1 text-sm text-neutral-500">
                {group.description || "未设置主题说明"}
              </p>
              <p className="mt-2 text-xs text-neutral-500">
                定时执行：{group.schedule_cron} · {group.timezone}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={group.enabled}
                  disabled={toggle.isPending}
                  onChange={(event) =>
                    toggle.mutate({
                      id: group.id,
                      enabled: event.target.checked,
                    })
                  }
                />
                启用
              </label>
              <Button variant="outline" size="sm" onClick={() => edit(group)}>
                <Pencil className="mr-1 h-3 w-3" />
                编辑
              </Button>
              <Button
                size="sm"
                disabled={
                  run.isPending ||
                  runs.some(
                    (run) =>
                      run.group_id === group.id && run.status === "running",
                  )
                }
                onClick={() => run.mutate(group.id)}
              >
                <Play className="mr-1 h-3 w-3" />
                {runs.some(
                  (run) =>
                    run.group_id === group.id && run.status === "running",
                )
                  ? "正在执行…"
                  : "立即运行"}
              </Button>
            </div>
          </div>
          {runs.find((run) => run.group_id === group.id)?.status ===
            "failed" && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
            >
              最近运行失败：
              {runs.find((run) => run.group_id === group.id)?.error_message}
              。修复后可重新运行。
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border bg-blue-50/40 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <Bot className="h-4 w-4" />1 · 选文与调研
              </h4>
              <p className="text-sm">
                {scopeHasArticles(group.source_ids) ? 'AI 批量选文' : '每日仓库研读'} → 每次最多深度调研 {group.deep_analysis_count}{" "}
                篇
              </p>
              <p className="text-xs text-neutral-500">
                池内范围：
                {group.source_ids.length
                  ? group.source_ids
                      .map(
                        (id) =>
                          sources.find((source) => source.id === id)?.name ||
                          id,
                      )
                      .join("、")
                  : "全部来源"}
              </p>
              {scopeHasCode(group.source_ids) && <p className="text-xs text-neutral-500">代码调研：{GITHUB_CODE_RESEARCH_SKILL}</p>}
              {scopeHasArticles(group.source_ids) && <p className="text-xs text-neutral-500">文章调研：{group.research_skill_id}</p>}
              <p className="text-xs text-neutral-500">
                {scopeHasArticles(group.source_ids) ? '范围内已初审、未完成调研的文章参与，不限入池日期；流水线不补跑初审。' : '每天深入探索一个仓库主题，读取固定 Commit 的完整源码。'}
              </p>
            </div>
            <div className="space-y-2 rounded-lg border bg-emerald-50/40 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <GitBranch className="h-4 w-4" />2 · GitHub 归档
              </h4>
              <p className="text-sm">
                {repos.find(
                  (repo) => repo.id === group.route.repository_connection_id,
                )?.name || "仓库未配置"}
              </p>
              <p className="break-all font-mono text-xs text-neutral-500">
                {group.route.base_path}
              </p>
              <p className="text-xs text-neutral-500">
                文章与深度研报完成后统一归档。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-t pt-3 text-xs">
            <Link to="/runs" className="text-blue-700 hover:underline">
              查看运行记录
            </Link>
            <Link
              to={`/reports?pipeline=${encodeURIComponent(group.id)}`}
              className="text-blue-700 hover:underline"
            >
              配置此任务的汇报 →
            </Link>
          </div>
        </article>
      ))}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pipeline-title"
        >
          <form
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate({
                ...form,
                id: editingId,
                ai_profile_id: form.ai_profile_id || null,
              });
            }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-neutral-700" />
                <div>
                  <h3 id="pipeline-title" className="text-base font-semibold">
                    {editingId ? "编辑流水线任务" : "新建流水线任务"}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    定义主题与审核方式，让高分文章的调研结果沉淀到知识库
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭"
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              {save.error && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                >
                  {save.error.message}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="space-y-1.5 text-xs font-medium text-neutral-700">
                  任务名称 *
                  <Input
                    className="mt-1.5 h-9 text-sm"
                    required
                    value={form.name}
                    onChange={(event) => update("name", event.target.value)}
                    placeholder="例如 Agent 工程实践"
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-neutral-700">
                  执行计划（Cron）
                  <Input
                    className="mt-1.5 h-9 font-mono text-xs"
                    required
                    value={form.schedule_cron}
                    onChange={(event) =>
                      update("schedule_cron", event.target.value)
                    }
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-neutral-700">
                  AI 执行器
                  <select
                    className="mt-1.5 h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-xs"
                    value={form.ai_profile_id}
                    onChange={(event) =>
                      update("ai_profile_id", event.target.value)
                    }
                  >
                    <option value="">使用默认执行器</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs font-medium text-neutral-700">
                关注领域与定位
                <textarea
                  rows={2}
                  className="mt-1.5 w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-normal leading-relaxed focus:border-blue-400 focus:outline-none"
                  value={form.description}
                  onChange={(event) =>
                    update("description", event.target.value)
                  }
                  placeholder="说明学习方向、关注的技术领域，以及期望解决的问题"
                />
              </label>
              <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-neutral-500">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                  1 · 审核评分
                </span>
                <span>→</span>
                <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">
                  2 · 深度调研
                </span>
                <span>→</span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                  3 · GitHub 归档
                </span>
              </div>
              <section className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                    1
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold">AI 批量选文</h4>
                    <p className="mt-0.5 text-[11px] text-neutral-500">
                      共享评分与简介 → AI 比较候选 → 最多选择 M 篇
                    </p>
                  </div>
                </div>
                <fieldset>
                  <legend className="mb-2 text-xs font-medium text-neutral-600">
                    池内来源范围{" "}
                    <span className="font-normal text-neutral-400">
                      · 不勾选表示全部来源
                    </span>
                  </legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {sources.map((source) => (
                      <label
                        key={source.id}
                        className={`flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-xs ${form.source_ids.includes(source.id) ? "border-blue-200" : "border-neutral-200"}`}
                      >
                        <input
                          className="accent-blue-600"
                          type="checkbox"
                          checked={form.source_ids.includes(source.id)}
                          onChange={(event) =>
                            update(
                              "source_ids",
                              event.target.checked
                                ? [...form.source_ids, source.id]
                                : form.source_ids.filter(
                                    (id) => id !== source.id,
                                  ),
                            )
                          }
                        />
                        {source.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {scopeHasArticles(form.source_ids) && <SkillPicker
                  label="选文 Skill"
                  type="selection"
                  value={form.selection_skill_id}
                  skills={skills}
                  onChange={(id) => update("selection_skill_id", id)}
                  prompt={buildSelectionPrompt(form.selection_skill_id, form)}
                  instructionsLabel="选文要求"
                  instructions={form.preferences}
                  onInstructionsChange={(value) => update("preferences", value)}
                  instructionsPlaceholder="根据任务定位选择值得深入研究的文章"
                />}
              </section>
              <section className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
                      2
                    </span>
                    <div>
                      <h4 className="text-sm font-semibold">
                        深度调研
                      </h4>
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        读取选中文章全文，按任务要求生成研报
                        ；GitHub 来源使用独立代码调研流程
                      </p>
                    </div>
                  </div>
                </div>
                <label className="block text-xs font-medium text-neutral-600">
                  每次最多调研篇数（M）
                  <Input
                    className="mt-1.5 h-8 w-32 bg-white text-xs"
                    type="number"
                    min={0}
                    max={100}
                    required
                    value={form.deep_analysis_count}
                    onChange={(event) =>
                      update("deep_analysis_count", Number(event.target.value))
                    }
                  />
                </label>
                <p className="text-xs text-neutral-500">
                  {scopeHasCode(form.source_ids) ? 'GitHub 仓库材料优先进入代码调研，剩余额度用于文章选文；' : 'AI 根据已初审文章的评分和简介选文；'}每轮最多 {form.deep_analysis_count} 篇，不要求凑满。M 为 0 时不选文、不调研。
                </p>
                {scopeHasArticles(form.source_ids) && <SkillPicker
                  label="文章调研 Skill"
                  type="research"
                  value={form.research_skill_id}
                  skills={skills.filter(skill => skill.id !== GITHUB_CODE_RESEARCH_SKILL)}
                  onChange={(id) => update("research_skill_id", id)}
                  prompt={buildResearchPrompt(
                    form.research_skill_id,
                    form.research_instructions,
                  )}
                  instructionsLabel="调研要求"
                  instructions={form.research_instructions}
                  onInstructionsChange={(value) =>
                    update("research_instructions", value)
                  }
                  instructionsPlaceholder="深入剖析核心机制、架构设计、技术取舍与适用场景，提供可落地的工程建议。"
                />}
                {scopeHasCode(form.source_ids) && <div className="rounded-md border bg-white p-3 text-xs text-neutral-600">
                  <p className="font-medium">GitHub 代码调研 Skill：{GITHUB_CODE_RESEARCH_SKILL}（固定）</p>
                  <p className="mt-1">仓库来源独立读取固定 Commit 的完整源码，追踪调用链、测试和设计取舍；文章调研 Skill 仅用于文章来源。</p>
                  {!skills.some(skill => skill.id === GITHUB_CODE_RESEARCH_SKILL) && <p className="mt-1 text-amber-700">当前执行器未提供代码调研 Skill，请同步 Skills 或安装到执行机的 Skill 目录。</p>}
                  {!scopeHasArticles(form.source_ids) && <label className="mt-3 block">代码调研补充要求<textarea className={`${fieldClass} mt-1`} value={form.research_instructions} onChange={event => update('research_instructions', event.target.value)} placeholder="例如：重点分析状态恢复机制与测试覆盖" /></label>}
                </div>}
              </section>
              <section className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                    3
                  </span>
                  <h4 className="text-sm font-semibold">GitHub 知识归档</h4>
                </div>
                <label className="block text-xs font-medium text-neutral-600">
                  目标仓库
                  <select
                    required
                    className="mt-1.5 h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-xs"
                    value={form.repository_connection_id}
                    onChange={(event) =>
                      update("repository_connection_id", event.target.value)
                    }
                  >
                    <option value="">选择仓库连接</option>
                    {repos.map((repo) => (
                      <option key={repo.id} value={repo.id}>
                        {repo.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-neutral-600">
                  归档目录
                  <Input
                    className="mt-1.5 h-9 bg-white font-mono text-xs"
                    required
                    value={form.base_path}
                    onChange={(event) =>
                      update("base_path", event.target.value)
                    }
                  />
                </label>
              </section>
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-neutral-100 bg-neutral-50 px-6 py-4">
              <label className="flex items-center gap-2 text-xs text-neutral-600">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => update("enabled", event.target.checked)}
                />
                启用定时执行
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "保存中…" : "保存任务"}
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function SkillPicker({
  label,
  type,
  value,
  skills,
  onChange,
  prompt,
  instructionsLabel,
  instructions,
  onInstructionsChange,
  instructionsPlaceholder,
}: {
  label: string;
  type: string;
  value: string;
  skills: Skill[];
  onChange: (id: string) => void;
  prompt: string;
  instructionsLabel: string;
  instructions: string;
  onInstructionsChange: (value: string) => void;
  instructionsPlaceholder: string;
}) {
  const skill = skills.find((item) => item.id === value);
  return (
    <div className="space-y-2 rounded-md border border-neutral-200/80 bg-white p-3">
      <label className="block text-xs font-medium text-neutral-700">
        {label}
        <select
          className="mt-1.5 h-9 w-full rounded-md border border-neutral-200 bg-neutral-50 px-2.5 text-xs"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {skills
            .filter((item) => item.type === type || item.id === value)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </label>
      <p className="text-[11px] leading-relaxed text-neutral-500">
        {skill?.description ||
          (skills.length === 0
            ? "该执行器尚未提供可用 Skill，请检查目录或启动 Worker，并测试连接。"
            : "所选 Skill 不可用，请重新选择。")}
      </p>
      <details className="border-t border-neutral-100 pt-2">
        <summary className="cursor-pointer text-[11px] text-blue-700">
          本阶段实际 Prompt · 查看与编辑
        </summary>
        <label className="mt-3 block text-xs font-medium text-neutral-600">
          {instructionsLabel}
          <textarea
            className="mt-1.5 min-h-24 w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs font-normal leading-relaxed focus:border-blue-400 focus:outline-none"
            value={instructions}
            onChange={(event) => onInstructionsChange(event.target.value)}
            placeholder={instructionsPlaceholder}
          />
        </label>
        <p className="mt-2 text-[11px] text-neutral-500">
          留空使用默认要求，随任务一起保存。Skill
          加载、输出格式与交付约束由系统固定。
        </p>
        <p className="mt-3 text-[11px] font-medium text-neutral-600">
          完整指令预览（实时更新）
        </p>
        <p className="mt-1 text-[10px] text-neutral-400">
          Skill 文件在执行工作区加载，不在这里展开。
        </p>
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-3 text-[11px] leading-relaxed text-neutral-600">
          {prompt}
        </pre>
      </details>
      <details className="border-t border-neutral-100 pt-2">
        <summary className="cursor-pointer text-[11px] text-neutral-500">
          查看 Skill 文件内容
        </summary>
        <p className="mt-2 break-all text-[10px] text-neutral-400">
          {skill?.file_path} · {skill?.version || "未标注版本"}
        </p>
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-3 text-[11px]">
          {skill?.system_prompt}
        </pre>
      </details>
    </div>
  );
}
