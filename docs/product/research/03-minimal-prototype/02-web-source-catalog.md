# 网站信息源与采集清单

核查日期：2026-10-15。关联：[最小原型结论](01-conclusion.md)、[来源配置](../../feature/01-source-configuration.md)。

## 信息源与内容定位

| 信息源 | 主要内容 | 内容特点与局限 | 当前定位 |
| --- | --- | --- | --- |
| [Cloudflare Blog](https://blog.cloudflare.com/) | 网络、安全、数据库、性能优化、云基础设施、Agent 工程 | 一手架构与故障分析较多，同时包含产品发布和公司动态；筛选时关注技术细节 | **首期启用**：深度工程实践与 Agent 工程 |
| [Simon Willison](https://simonwillison.net/) | LLM 工具、编程 Agent、开发方法、实验与技术评论 | 独立开发者的实践视角；长文、短评和外链推荐混合，短评不能等同于外链原文 | **首期启用**：Agent 工程与开发实践 |
| [Jules Blom](https://julesblom.com/writing) | React 原理、渲染性能、JavaScript、SVG、数据可视化 | 前端解释深入，部分内容依赖图示；当前目录并不以 Agent 为重点 | 后续前端专题候选；保留作图文采集样本 |
| [Anthropic Engineering](https://www.anthropic.com/engineering) | Agent 架构、上下文工程、工具设计、评估与可靠性 | 一手 Agent 工程经验，带有厂商技术栈视角 | 后续 Agent 深度内容候选 |
| [Node Weekly](https://nodeweekly.com/) | Node.js 生态资讯、文章、工具与版本更新 | 编辑精选周刊；同一期包含多条外链，目标站点各有获取条件 | 后续 Node.js 内容发现候选 |
| [Medium](https://medium.com/) | 综合写作平台，技术内容随作者、专栏和主题而变化 | 首页不能代表一个明确的技术来源；正文质量和访问条件不同 | 后续按具体作者或专栏选择 |

## 采集入口与验证记录

| 信息源 | 入口 | 已验证能力与边界 |
| --- | --- | --- |
| Cloudflare | [RSS](https://blog.cloudflare.com/rss/) | HTTP 200、20 个条目；抽查条目携带较长 HTML 正文，技术文章页也可直接获取。正文不足时仍需补抓 |
| Simon Willison | [Atom](https://simonwillison.net/atom/everything/) | 第二批调研用公开 RSS 脚本在 168 小时时间窗内取得 20 条，含标题、链接、摘要、日期；未逐条验收全文完整度，不能把该数量当作 Feed 总量 |
| Jules Blom | [RSS](https://julesblom.com/rss.xml) | HTTP 200、23 个条目；抽查正文实际为摘要，需补抓。ETag 条件请求返回 304。条目并非简单按发布日期倒序 |
| Anthropic Engineering | [工程文章列表](https://www.anthropic.com/engineering) | 已通过检索工具阅读列表与文章；自动发现入口、订阅源及程序化采集尚未验证 |
| Node Weekly | [RSS](https://nodeweekly.com/rss/) | HTTP 200、4 个条目，分别是四期周刊。提取期内文章需要额外识别外链与跳转 |
| Medium | [官方 RSS 格式说明](https://help.medium.com/hc/en-us/articles/214874118-Using-RSS-feeds-of-profiles-publications-and-topics) | 支持作者、专栏、主题 Feed；官方说明付费文章不提供 Feed 全文。本机直接请求首页、Booking.com 专栏 Feed 与指定文章均超时，检索工具可读指定文章 |

Simon 的运行依据见[第二批公开实践中的 RSS 实跑](../02-ai-led-collection/03-public-practices.md)。所有结果均为单次核查，不代表长期可用率；采集器、模型和真实交付的端到端验收尚未完成。

## 代表内容与样本

- **Cloudflare**：[Agent 安全运营系统](https://blog.cloudflare.com/agentic-security-operations/)，说明其有 Agent 架构与工程实践内容。
- **Simon Willison**：[Agentic Engineering Patterns](https://simonwillison.net/guides/agentic-engineering-patterns/)，涵盖工具调用、子 Agent、测试及代码理解等实践。
- **Jules Blom**：[React 父子树与所有者树的可视化表达](https://julesblom.com/writing/react-visual-notation)，可直接获取 HTML，但大量 SVG 图示不能仅靠文字提取完整理解。
- **Anthropic**：[Agent 评估](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)、[上下文工程](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，适合补充系统性的 Agent 技术分析。
- **Node Weekly → Medium**：[用户提供的链接](https://nodeweekly.com/link/191261/2859a796a1) 返回 301，指向 [Booking.com 的 Node.js 性能优化文章](https://medium.com/booking-com-development/node-js-at-scale-rebalanced-how-we-cut-cost-by-38-62ce247a3002)。本机目标访问超时，不代表文章收费或网站永久不可采。

## 首期选用依据

首期选择 **Cloudflare + Simon Willison**：内容分别覆盖一手工程实践与独立 Agent 分析，且订阅入口已有读取记录。相较于此前为验证采集而选择的 Jules Blom，这个组合更贴合用户明确的阅读目标。

主题和筛选偏好统一维护在 [feature 01](../../feature/01-source-configuration.md)。本清单维护网站内容定位、入口与验证依据，后续新增来源时继续补充。
