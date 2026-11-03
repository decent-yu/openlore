import React, { useState } from "react";
import type { Skill } from "@openlore/contracts";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";

export function SkillPicker({
  label,
  type,
  value,
  skills,
  onChange,
  prompt,
  previews,
  locked = false,
  instructionsLabel,
  instructions,
  onInstructionsChange,
  instructionsPlaceholder,
  contextHint,
}: {
  label: string;
  type: string;
  value: string;
  skills: Skill[];
  onChange?: (id: string) => void;
  prompt?: string;
  previews?: Array<{ id: string; title: string; prompt: string }>;
  locked?: boolean;
  instructionsLabel: string;
  instructions: string;
  onInstructionsChange: (value: string) => void;
  instructionsPlaceholder: string;
  contextHint?: string;
}) {
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState("");
  const skill = skills.find((item) => item.id === value && item.type === type);
  const candidates = skills.filter(
    (item) =>
      item.type === type &&
      `${item.name} ${item.id} ${item.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const prompts =
    previews ||
    (prompt
      ? [{ id: "stage", title: "完整指令预览（实时更新）", prompt }]
      : []);
  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-neutral-500">{label}</p>
          <p className="mt-1 break-words text-sm font-semibold">
            {skill?.name || value || "请选择 Skill"}
          </p>
          {skill?.version && (
            <p className="mt-1 text-[10px] text-neutral-400">
              版本 {skill.version}
            </p>
          )}
        </div>
        {!locked && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 text-xs"
            aria-expanded={choosing}
            onClick={() => setChoosing(!choosing)}
          >
            更换 Skill
          </Button>
        )}
      </div>
      <p className="text-xs leading-relaxed text-neutral-500">
        {skill?.description ||
          "当前执行器未提供所选 Skill，请更换或刷新执行器 Skill 目录。"}
      </p>
      {choosing && (
        <div className="space-y-2 rounded-md border bg-neutral-50 p-2">
          <Input
            aria-label={`搜索${label}`}
            placeholder="搜索名称、标识或用途"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div
            role="listbox"
            aria-label={`${label}候选`}
            className="max-h-64 space-y-1 overflow-auto"
          >
            {candidates.map((item) => (
              <button
                type="button"
                role="option"
                aria-selected={item.id === value}
                key={item.id}
                className={`w-full rounded-md border p-3 text-left ${item.id === value ? "border-blue-300 bg-blue-50" : "border-neutral-200 bg-white hover:border-neutral-400"}`}
                onClick={() => {
                  onChange?.(item.id);
                  setChoosing(false);
                  setSearch("");
                }}
              >
                <span className="block text-xs font-semibold">
                  {item.name}
                  {item.id === value ? " · 已选" : ""}
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-neutral-500">
                  {item.description}
                </span>
              </button>
            ))}
            {!candidates.length && (
              <p className="p-3 text-xs text-neutral-500">
                没有匹配的 Skill。请检查该执行器的 Skill 目录。
              </p>
            )}
          </div>
        </div>
      )}
      <details className="border-t pt-2">
        <summary className="cursor-pointer text-xs text-blue-700">
          本阶段实际 Prompt · 查看与编辑
        </summary>
        <label className="mt-3 block text-xs font-medium text-neutral-600">
          {instructionsLabel}
          <textarea
            className="mt-1.5 min-h-24 w-full resize-y rounded-md border p-3 text-xs font-normal leading-relaxed"
            value={instructions}
            onChange={(event) => onInstructionsChange(event.target.value)}
            placeholder={instructionsPlaceholder}
          />
        </label>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          {contextHint ||
            "留空使用默认要求，修改随任务保存。下方显示系统将使用的完整指令；Skill 文件在工作区单独加载。"}
        </p>
        {!prompts.length && (
          <p className="mt-3 text-xs text-neutral-500">
            选择并启用仓库来源后显示其实际目标、历史及指令预览。
          </p>
        )}
        {prompts.map((item) => (
          <div key={item.id} className="mt-3">
            <p className="text-xs font-medium text-neutral-600">{item.title}</p>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-3 text-[11px] leading-relaxed text-neutral-600">
              {item.prompt}
            </pre>
          </div>
        ))}
      </details>
      <details className="border-t pt-2">
        <summary className="cursor-pointer text-xs text-neutral-500">
          查看 Skill 文件内容
        </summary>
        <p className="mt-2 break-all text-[10px] text-neutral-400">
          {skill?.file_path} · {skill?.revision?.slice(0, 12) || "版本待刷新"}
        </p>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-3 text-[11px]">
          {skill?.system_prompt}
        </pre>
      </details>
    </section>
  );
}
