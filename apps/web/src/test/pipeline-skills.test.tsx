import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  buildCodeResearchPrompt,
  buildRepositoryResearchInstructions,
  repositoryResearchContext,
  SourceSchema,
  type Skill,
} from "@openlore/contracts";
import { SkillPicker } from "../features/pipelines/SkillPicker.js";

const skill: Skill = {
  id: "custom-selection",
  name: "项目自定义筛选器",
  type: "selection",
  description: "根据研究方向比较已审核资料",
  tags: [],
  system_prompt: "自定义规则",
  file_path: "/skills/custom/SKILL.md",
  revision: "rev",
};
it("renders the configured executor Skill and its description with an explicit change action", () => {
  const html = renderToStaticMarkup(
    <SkillPicker
      label="选文 Skill"
      type="selection"
      value={skill.id}
      skills={[skill]}
      onChange={() => {}}
      prompt="实际阶段指令"
      instructionsLabel="选文要求"
      instructions="面向开发者"
      onInstructionsChange={() => {}}
      instructionsPlaceholder="选文要求"
    />,
  );
  expect(html).toContain("项目自定义筛选器");
  expect(html).toContain("根据研究方向比较已审核资料");
  expect(html).toContain("更换 Skill");
  expect(html).toContain("本阶段实际 Prompt");
  expect(html).not.toContain("<select");
  expect(html).not.toContain("article-selector");
});
it("previews source goals, archived progress and independent first-study instructions with the runtime builder", () => {
  const source = SourceSchema.parse({
    id: "orca",
    name: "Orca",
    url: "https://github.com/stablyai/orca",
    capability_id: "github_repository",
    options: { research_focus: "理解核心架构和状态恢复" },
    repository_history: [],
  });
  const prompt = buildCodeResearchPrompt(
    buildRepositoryResearchInstructions(
      repositoryResearchContext(source),
      "根据场景自主绘制 SVG",
    ),
  );
  const html = renderToStaticMarkup(
    <SkillPicker
      label="仓库研读 Skill"
      type="research"
      value="github-code-research"
      skills={[]}
      locked
      previews={[{ id: source.id, title: source.name, prompt }]}
      instructionsLabel="补充要求"
      instructions="根据场景自主绘制 SVG"
      onInstructionsChange={() => {}}
      instructionsPlaceholder="补充要求"
    />,
  );
  expect(html).toContain("理解核心架构和状态恢复");
  expect(html).toContain("历史研读：0 篇已归档");
  expect(html).toContain("首次系统研读");
  expect(html).toContain("根据场景自主绘制 SVG");
  expect(html).toContain("input/research-context.json");
  expect(html).not.toContain("更换 Skill");
});
