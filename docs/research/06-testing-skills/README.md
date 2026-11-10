# 测试 Skills 调研

更新：2026-11-10。**Vercel 提供探索与证据交付流程，Every 提供按改动回归与修复流程。建议新 Skill 采用 Every 的旅程建模，结合 Vercel 的逐项复现取证。**

已实现 [raven-pr-dogfood](07-raven-pr-dogfood-delivery.md)，包含可执行工具、完整工作流和实际验证记录；当前已支持[标准 JSON 与 HTML 报告](08-standard-report-json-html.md)。

## 阅读顺序

| 文档 | 用途 |
| --- | --- |
| [标准 JSON 与可视化报告](08-standard-report-json-html.md) | 当前字段契约、HTML 报告与新 smoke |
| [实现与验证](07-raven-pr-dogfood-delivery.md) | 当前 Skill 入口、实际能力与测试证据 |
| [PR 测试 Skill 初步方案](06-pr-dogfood-proposal.md) | 前期评审方案，当前实现见上方入口 |
| [核心逻辑拆解](03-dogfood-core-logic.md) | 两套执行流程、文件职责、真实实现与脚本验证 |
| [异同与局限](04-dogfood-comparison.md) | 横向对照、同一业务例子、容易高估的能力 |
| [新 Skill 借鉴建议](05-design-takeaways.md) | 前期设计素材；范围已收敛为上方 PR 方案 |
| [测试候选二次筛选](02-testing-shortlist.md) | 从通用规范转向实际执行测试的选型记录 |
| [赛道一初筛](01-track-one-shortlist.md) | 测试、算法各 5 个候选与原始评分，保留为历史依据 |

## 资料与证据

- [原始 Skill 参考目录](../../../skills-reference/test-dogfood/README.md)：上游文件与本地来源说明分开标识；本轮未改写原始文件。
- [原始热度数据](evidence/2026-11-10-skill-shortlist.json)：此前筛选时的公开指标，不代表能力测试。
- [源码哈希清单](evidence/2026-11-10-dogfood-source-manifest.json)：12 个参考文件、归档时的本地 commit、外部一手资料入口。
- [脚本探针结果](evidence/2026-11-10-packs-resolver-probes.json)：Every Pack 解析器的 7 个隔离本地夹具结果。

## 结论边界

报告以仓库内 2026-11-10 下载副本为可复核基线，并阅读上游页面及官方浏览器文档。原下载未记录上游 commit，不能据此声称与未来的 `main` 相同。只执行了 Pack 解析器的本地探针，**未执行浏览器 QA、自动修复或性能对比**；流程优劣是源码分析判断。

此前两份 Skills 调研及对应评分证据集中在本目录。其他独立调研及证据按主题归档，见[总目录](../README.md)。
