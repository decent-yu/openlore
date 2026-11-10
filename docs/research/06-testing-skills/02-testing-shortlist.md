# 测试 Skills 二次筛选：优先看能实际找 Bug 的

历史选型记录；两项最终候选的机制与当前参考副本见[核心逻辑拆解](03-dogfood-core-logic.md)。Every 的浏览器策略已补充说明。

核查：2026-11-10，按当前上游源码审阅，未安装实测。**建议先审核 Vercel dogfood 和 gstack qa-only；有移动端业务再看 Callstack dogfood。**

上一版把热门合集中的通用规范选得过多。这版重点看：能否执行真实测试、能否发现非预设问题、能否交付可复现证据。技术亮点不等于行业首创，也不以“最近发布”替代能力判断。

## 5 个重点候选

| 优先级 | Skill / 当前源码 | 它实际干什么 | 值得看的突破点 | 适用与限制 |
| --- | --- | --- | --- | --- |
| **1** | **[dogfood · Vercel](https://github.com/vercel-labs/agent-browser/blob/main/skill-data/dogfood/SKILL.md)** | 给它一个网址，让 Agent 自己探索操作流程，发现功能和体验问题，交付缺陷报告、截图及交互问题的复现视频。 | **探索 → 再次复现 → 截图/录屏取证 → 缺陷交付**；发现的问题必须有运行证据，交互类问题按步骤绑定截图。适合演示“AI 测试员”。 | Web 黑盒探索测试；依赖 agent-browser 和可访问的测试环境。探索到的范围不等于完整业务覆盖。 |
| **2** | **[qa-only · gstack](https://github.com/garrytan/gstack/blob/main/qa-only/SKILL.md)** | 根据需求、测试计划或代码差异选择测试目标，检查浏览器、API、CLI、后台任务、worker、webhook 等入口并形成报告。 | **从测页面扩展到多入口验证**，支持 Quick / Full / Regression，以及基于改动选择范围；浏览器证据和功能执行结果分别记录。 | 适合有源码、原生命令和测试夹具的团队；依赖 gstack 配套资产。当前版本只报告，修复闭环是另一个 `/qa` Skill。 |
| **3** | **[ce-dogfood · Every](https://github.com/EveryInc/compound-engineering-plugin/blob/main/skills/ce-dogfood/SKILL.md)** | 分析当前分支或 PR 的改动，画出受影响的完整用户旅程，生成测试矩阵，运行浏览器验证，小问题可修复并补回归测试。 | **按改动选回归流程 + 检查完整旅程与副作用 + 修复后回归**。要求考虑邮件、通知、任务等真实终态，自动化套件失败时不能宣称就绪。 | 适合合并前回归；需源码、开发服务，以及能覆盖矩阵的宿主内置浏览器；否则使用 agent-browser。上游默认包含本地 commit，使用时须覆盖为团队授权的行为；本次仅调研，没有执行它。 |
| **4** | **[dogfood · Callstack](https://github.com/callstack/agent-device/blob/main/skills/dogfood/SKILL.md)** | 在 iOS / Android App 中探索真实交互，循环操作、截图、取证，整理移动端缺陷。 | **把探索式 QA 延伸到移动端**；要求发现来自实际运行行为，不能读源码后臆测缺陷。 | 移动测试团队更有价值；当前入口是路由型 Skill，详细流程由 `agent-device help dogfood` 提供，要求 CLI ≥ 0.14.0，需设备/模拟器环境。 |
| **5** | **[atheris · Trail of Bits](https://github.com/trailofbits/skills/blob/main/plugins/testing-handbook-skills/skills/atheris/SKILL.md)** | 帮 Python 库编写 fuzz 入口、做覆盖插桩、启动 Atheris；对原生扩展可结合 AddressSanitizer 检测内存错误。 | **让覆盖引导引擎持续生成输入找异常**，适合解析器、编解码器、文件处理库；产出可以是触发崩溃的输入，而非一份用例文档。 | 更偏技术深度，场景比 Web QA 窄。Atheris 本身是成熟技术，不能包装成新发明；Skill 价值是把设置和运行流程交给 Agent。 |

前 3 项的区别：**Vercel 偏整站黑盒找问题；gstack 偏多入口 QA；Every 偏当前代码改动的回归与修复。** 两个 dogfood 来自不同上游，分别面向 Web 和移动端。

## 按赛事权重初评

总分 = 创新 × 20% + 实用 × 25% + 完成度 × 20% + 数据 × 35%。前三项为静态审阅判断，完成度最高暂记 8；不代表稳定性实测结果。

| 候选 | 创新 | 实用 | 完成度 | 数据 | 加权总分 | 公开热度依据 |
| --- | --- | --- | --- | --- | --- | --- |
| gstack qa-only | 8 | 9 | 8 | 8 | **8.25** | [gstack 仓库](https://github.com/garrytan/gstack)页面约 **14.1 万 Star** |
| Vercel dogfood | 8 | 9 | 8 | 7 | **7.90** | [agent-browser 仓库](https://github.com/vercel-labs/agent-browser)页面约 **4.87 万 Star** |
| Every ce-dogfood | 8 | 9 | 8 | 7 | **7.90** | [Compound Engineering 仓库](https://github.com/EveryInc/compound-engineering-plugin)页面约 **2.60 万 Star** |
| Callstack dogfood | 8 | 9 | 8 | 6 | **7.55** | [agent-device 仓库](https://github.com/callstack/agent-device)页面约 **5300 Star** |
| Trail of Bits atheris | 7 | 8 | 8 | 6 | **7.10** | [所属仓库](https://github.com/trailofbits/skills)同日上一轮 API 查询 **8096 Star** |

沿用上一版数据代理规则：仓库 Star ≥ 10 万记 8，≥ 1 万记 7，≥ 1000 记 6。**以上全部是所属仓库指标，不是单项 Skill 点赞或下载量。** 本轮 GitHub API 限流，其余采用页面显示的约数；不做精确增长或最新更新时间承诺。总分用于赛事口径对照，上方审核顺序侧重演示价值和测试场景适配。

## 我更推荐的参赛切口

**首选：面向业务需求的自动探索测试与缺陷证据生成。** 参考 Vercel 的证据链，补上“需求点 → 探索路径 → 发现缺陷 → 复现视频 → 回归用例”的关联，再参考 gstack 扩展接口和 webhook 验证。用预埋且事先不告诉 Agent 的缺陷，统计有效发现数、误报率、复现成功率和人工节省时间；下载、浏览另行统计。这里是二次开发建议，不是这些上游已经具备的完整能力。

偏测试平台团队可选 **改动驱动回归**（Every）；移动业务选 **App 探索测试**（Callstack）；底层库团队选 **自动 fuzz 与崩溃复现**（Atheris）。

## 来源核查补充

- [SkillHub 的 gstack 集合](https://www.skillhub.club/skill-stacks/the-startup-ceo-stack)收录 qa、qa-only、benchmark、canary 等；其旧描述仍偏 Web，当前 qa-only 源码已经包含功能入口。选型以源码为准。
- [Vercel Skills 文档](https://github.com/vercel-labs/agent-browser/blob/main/docs/src/app/skills/page.mdx)说明 dogfood 的详细知识由 CLI 提供，减少安装说明与执行版本脱节。
- [Every 测试阶段说明](https://github.com/EveryInc/compound-engineering-plugin/blob/main/skills/ce-dogfood/references/phases.md)可核对旅程图、测试矩阵、回归与最终就绪判断。
- Claude 社区入口和 SkillHub 用于发现候选；未获得这 5 个单项可比较的 Claude 社区点赞/安装数据，不补造数字。这里列的是实际存在的 Skills，浏览器、设备控制器和 fuzz 引擎是它们的执行依赖。
