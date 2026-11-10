# 赛道一 Skills 候选：测试与算法研究

测试方向优先参考[二次筛选：实际执行与缺陷取证](07-testing-skills-advanced-2026-11-10.md)。本篇保留通用候选与算法方向。

核查日期：2026-11-10。按方向 A、B 各选 5 个，共 10 个，供审核。

## 评分口径

**总分 = 创新性 × 20% + 实用价值 × 25% + 完成度与质量 × 20% + 数据表现 × 35%。** 四项均为 1–10 分，表中「创 / 实 / 完 / 数」依次对应这四项。

- 前三项为阅读当前 `SKILL.md`、配套脚本与参考材料后的主观初评；未安装实测，完成度暂不评 9–10 分。
- 社区缺少统一的单项点赞榜，因此以 GitHub Star、安装量筛选“高热度”候选。**合集 Star、插件安装量均不能算成单个 Skill 的成绩。**
- 数据项采用本次调研的代理规则：所属仓库 Star ≥ 10 万记 8 分，≥ 1 万记 7 分，≥ 1000 记 6 分；若另有单项安装量 ≥ 10 万，记 9 分。仅有合集数据最高 8 分；这不是赛事官方换算规则。
- 下表 Star 来自本次 GitHub API 查询；安装量取页面或 CLI 展示值，非独立用户数。未取得的单项下载量、浏览量不估算。

## 方向 A：测试与质量保障

| 排名 | Skill / 源码 | 简单说：干什么 | 热度证据 | 创 / 实 / 完 / 数 → 总分 | 审核重点 |
| --- | --- | --- | --- | --- | --- |
| 1 | [webapp-testing](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md) · Anthropic | 用 Playwright 操作本地网页、检查页面行为，保存截图并采集控制台日志。 | 单项约 **20.12 万安装**；所属仓库 191,093 Star | 7 / 9 / 8 / 9 → **8.40** | 有服务启动辅助脚本，容易演示；主要面向本地 Web 应用，业务断言仍需补充。 |
| 2 | [systematic-debugging](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md) · obra | 从失败用例、日志和最近改动定位根因，再验证假设、修复并回归。 | 所属仓库 **315,196 Star**；Superpowers 插件约 100.94 万安装 | 7 / 9 / 8 / 8 → **8.05** | 四阶段诊断流程可复用；核心是方法指导，不能替代日志采集和真实复现环境。 |
| 3 | [e2e-testing](https://github.com/affaan-m/ECC/blob/main/skills/e2e-testing/SKILL.md) · affaan-m | 帮团队编写和维护 Playwright 回归套件，组织页面对象、CI、失败截图与报告。 | 所属仓库 **300,268 Star**；SkillHub 收录 | 6 / 9 / 7 / 8 → **7.65** | 工程模板较全，适合长期回归；示例中的等待方式需要按实际页面调整。 |
| 4 | [property-based-testing](https://github.com/trailofbits/skills/blob/main/plugins/property-based-testing/skills/property-based-testing/SKILL.md) · Trail of Bits | 根据“编解码可还原”等规则生成大量输入，寻找边界问题和最小失败样例。 | 所属仓库 **8,096 Star**；SkillHub 收录 | 8 / 9 / 8 / 6 → **7.55** | 比普通用例生成更有区分度；需先定义正确的性质，适合解析器、转换器、算法逻辑。 |
| 5 | [qa-test-planner](https://github.com/davila7/claude-code-templates/blob/main/cli-tool/components/skills/ai-research/qa-test-planner/SKILL.md) · davila7 | 把需求整理成测试计划、手工用例、回归清单和规范缺陷报告。 | 所属仓库 **33,243 Star**；SkillHub 收录 | 6 / 9 / 8 / 7 → **7.50** | 最贴近日常测试文档工作，有模板和辅助脚本；Figma 对照需另配 MCP。 |

**优先看：**快速落地选 webapp-testing；希望做出差异化演示选 property-based-testing；需求到用例的流程选 qa-test-planner。webapp-testing 偏即时页面验证，e2e-testing 偏持续维护回归套件。

## 方向 B：算法研究与模型实验

| 排名 | Skill / 源码 | 简单说：干什么 | 热度证据 | 创 / 实 / 完 / 数 → 总分 | 审核重点 |
| --- | --- | --- | --- | --- | --- |
| 1 | [huggingface-llm-trainer](https://github.com/huggingface/skills/blob/main/skills/huggingface-llm-trainer/SKILL.md) · Hugging Face | 辅助生成并提交 SFT、DPO、GRPO 等微调任务，选择 GPU、估算成本、保存模型。 | 所属仓库 **11,310 Star**；HF 插件约 3.46 万安装 | 8 / 9 / 8 / 7 → **7.90** | 训练链路覆盖较全，有示例脚本；依赖 HF 账号、权限及付费云算力。 |
| 2（并列） | [huggingface-community-evals](https://github.com/huggingface/skills/blob/main/skills/huggingface-community-evals/SKILL.md) · Hugging Face | 用 inspect-ai、lighteval 跑模型评测，选择 vLLM / Transformers 等推理后端。 | 同属 HF 仓库：**11,310 Star**，无单项安装量 | 7 / 9 / 8 / 7 → **7.70** | 自带评测脚本和小样本试跑路径；当前范围是本地执行，结果发布和云任务需另接。 |
| 2（并列） | [literature-review](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/literature-review/SKILL.md) · K-Dense | 检索 arXiv 等文献，筛选论文、核对引用，整理研究脉络与综述。 | 所属仓库 **56,616 Star**；SkillHub AI 评分 A / 7.9 | 7 / 9 / 8 / 7 → **7.70** | 有检索、筛选、引用检查流程；检索片段不能替代论文全文阅读，PDF 导出需额外依赖。 |
| 2（并列） | [huggingface-trackio](https://github.com/huggingface/skills/blob/main/skills/huggingface-trackio/SKILL.md) · Hugging Face | 记录 loss 等训练指标，查看实验曲线、对比运行结果，并配置异常告警。 | 同属 HF 仓库：**11,310 Star**，无单项安装量 | 7 / 9 / 8 / 7 → **7.70** | 日志、查询、告警接口清楚；需在训练代码中接入指标记录，异常阈值需自行设置。 |
| 5 | [exploratory-data-analysis](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/exploratory-data-analysis/SKILL.md) · K-Dense | 训练前检查数据结构、缺失值、异常值和潜在泄漏，输出数据质量报告。 | 同属 K-Dense 仓库：**56,616 Star**，无单项安装量 | 7 / 8 / 8 / 7 → **7.45** | 适合数据入场检查；当前只直接支持明确列出的格式，不自动清洗或覆盖原始数据。 |

**优先看：**需要完整模型实验演示选 huggingface-llm-trainer；已有模型需要横向比较选 huggingface-community-evals；低算力门槛选 literature-review 或 exploratory-data-analysis。

## 社区交叉核查

| 渠道 | 可复核入口与发现 |
| --- | --- |
| GitHub | 上表全部链接直达具体 `SKILL.md`，不是普通工具或 MCP 服务。Star 可由 [GitHub REST API](https://docs.github.com/en/rest/repos/repos#get-a-repository) 的 `stargazers_count` 复查；本次数值见[证据快照](evidence/2026-11-10-skill-shortlist.json)。 |
| Claude 社区 / 插件目录 | [Superpowers](https://claude.com/plugins/superpowers) 展示 1,009,371 次插件安装；[Hugging Face Skills](https://claude.com/plugins/huggingface-skills) 展示 34,575 次插件安装。均为整包指标，不重复计入单项数据分。 |
| SkillHub（skillhub.club） | [测试目录](https://www.skillhub.club/skills?category=testing&sort=stars)、[系统调试](https://www.skillhub.club/skills/obra-superpowers-systematic-debugging)、[性质测试](https://www.skillhub.club/skills/trailofbits-skills-property-based-testing)、[E2E](https://www.skillhub.club/skills/affaan-m-everything-claude-code-e2e-testing)、[文献综述](https://www.skillhub.club/skills/k-dense-ai-claude-scientific-skills-literature-review)。AI 评分不是用户点赞；文献综述页为 0 UP / 0 DOWN。 |
| 补充安装数据 | [skills.sh：webapp-testing](https://skills.sh/anthropics/skills/webapp-testing)；`npx skills find testing` 本次显示该单项 201.2K installs。 |

**版本注意：**ECC 原名 everything-claude-code；K-Dense 原名 claude-scientific-skills。HF 部分旧目录仍使用 hugging-face-model-trainer、hugging-face-evaluation 等名称，本表按当前上游名称和职责筛选。SkillHub 的旧 Star 和功能描述可能滞后，以当前源码为准。

以上用于候选审核；正式参赛的数据表现还需补充参赛作品自身的下载、浏览、使用数据。
