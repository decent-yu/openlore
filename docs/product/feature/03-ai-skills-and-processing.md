# 03 Skills 与 Prompt 调用流程

AI 任务由云端编排，标准方式为独立 Runner 领取并执行；无需在执行机启动网站。部署边界见[系统架构](../../architecture/system-architecture.md)，配对与启动见[Runner 指引](../../guides/ai-executors.md)。

## 流水线任务

1. **审核精选**：使用 `assessment_skill_id`（默认 `tech-article-extractor`），通过 `$skill-name` 和工作区路径加载 Skill，传入任务定位和附加审核要求 `preferences`。全部备选文章逐篇评分后统一排序，选出目标篇数。
2. **深度调研**：从精选结果中择优选择指定篇数，使用 `research_skill_id`（默认 `deep-research-expert`），通过工作区加载该 Skill，并传入 `research_instructions`。
3. **GitHub 归档**：完成文章与研报归档，不再调用简报 Skill。

编辑器分阶段配置 Skill 和附加 Prompt，并展示实际任务指令。前后端共用 `packages/contracts/src/prompts.ts`，避免展示内容和实际调用不一致。AI 日志记录实际 Skill ID 和 Prompt。

审核和调研阶段不混用 Skills。AI 返回失败或无效结果时明确报错，不生成通用模板冒充成功内容。

## 汇报方案

每个汇报方案选择一个或多个任务结果，再调用自己的简报 Skill（默认 `batch-digest-generator`）生成群汇报。多个方案可使用不同任务组合、目标群和时间。

## Skill 来源

同步模式下，`skillsService` 从云端仓库 `skills/` 与业务数据目录 `skills/` 发现 SKILL.md，读取类型、说明、基础 Prompt 和引用材料。审核列表筛选 extraction 类型，调研列表筛选 research 类型，汇报列表筛选 digest 类型。

Skill 文件与任务指令分开展示。审核阶段配置调研篇数并输出调研名单，调研阶段只对选定文章生成新文章。Skills 随任务复制到 `.agents/skills/`，不会全局安装。

执行机本地目录模式由 Runner 上报 Skill 清单，SSH 通过连接测试刷新，本机执行则直接读取；流水线列表按所选执行器获取对应 Skills。
