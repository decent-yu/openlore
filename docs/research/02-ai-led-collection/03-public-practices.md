# 公开实践、实际问题与验证结果

> 2026-10-15 调研快照：本文保留当时的核查与提议，不代表当前实现状态。现状见[系统架构](../../architecture/system-architecture.md)与[功能总览](../../product/feature/index.md)。

日期：2026-10-15。返回：[方案总览](01-overview.md)。

这里整理作者公开实现、使用者提交的修复和本次小样本运行。它们是可核实、可借鉴的实践，不代表已经证明适用于所有来源的“最佳方案”。

## 1. HarrisHan：脚本取 RSS，宿主 Agent 做判断

[HarrisHan/ai-daily-digest](https://github.com/HarrisHan/ai-daily-digest/blob/331ccaf62b8f5e1780259aaf396b23169e8fe6c5/SKILL.md) 将工作拆为：脚本并发读取配置中的 RSS → 时间过滤 → Agent 评分与分类 → 内容不足时补读原文。它复用当前 Agent 的模型，不另外要求摘要模型 API Key。

**可借鉴：**采集先形成结构化结果，便于检查、复用和重跑；AI 判断与网络抓取分工明确。

**源码边界：**抓取脚本使用正则解析 RSS/Atom，摘要截断为 500 字符；skill 用摘要长度判断是否需要补读全文。该规则不能证明正文完整。脚本按时间窗过滤，没有持久化游标或跨次去重；日期无法解析的条目会被过滤。

依据：[fetch-rss.mjs](https://github.com/HarrisHan/ai-daily-digest/blob/331ccaf62b8f5e1780259aaf396b23169e8fe6c5/scripts/fetch-rss.mjs)。

### 本次实际运行

使用上述提交的原脚本，仅选择其源列表中的两个公开 RSS，参数为 `--hours 168`；没有执行摘要或推送。

| 来源 | 本次结果 |
| --- | --- |
| `https://simonwillison.net/atom/everything/` | 返回 20 条，包含 title/link/summary/date/source 等字段 |
| `http://antirez.com/rss` | 15 秒超时，脚本记录失败并继续 |
| 整体进程 | 退出码 0，标准输出为有效 JSON；失败只记录在标准错误日志 |

这说明链路可以很轻量，也说明不能只看退出码。OpenLore 应保存逐来源状态和缺口。本次只检查数据结构与运行行为，未人工核对 20 条内容的完整性，也不能据此判定 antirez 长期不可用。

## 2. x-reader 使用者：验证码页面被误当成文章

贡献者 GuinsooRocky 在 [PR #18](https://github.com/runesleo/x-reader/pull/18) 报告：Jina 返回的微信验证页非空，旧代码将它当作成功结果，导致 Playwright 回退没有触发。修复增加验证页特征判断；2026-05-25 合并。

**可借鉴：**“请求成功 + 非空文本”不足以代表正文可用。应检查原文身份、文章容器、验证页、截断和媒体缺失；失败后再切换读取方式。

当前 [微信读取代码](https://github.com/runesleo/x-reader/blob/c359a0ff68af8afa3305a27ed635060b87be09cc/x_reader/fetchers/wechat.py) 已包含相关判断；[证据模块](https://github.com/runesleo/x-reader/blob/c359a0ff68af8afa3305a27ed635060b87be09cc/x_reader/evidence.py) 进一步区分内容完整度。规则能减少误报，仍需目标页面实测，不能据此承诺所有公众号都能读取。

## 3. last30days 使用者：高热度内容挤掉相关结果

贡献者 rzachsmith 在 [PR #488](https://github.com/mvanhorn/last30days-skill/pull/488) 报告：Reddit 搜索结果按互动量排序，让高赞但无关的内容占据前排。修复加入相关性过滤与受限的互动量加分；2026-06-17 合并。

**可借鉴：**搜索扩展时先约束技术主题、来源与时间，再将热度作为辅助信号。采集到很多条，并不意味着发现了更多有效信息。

该项目也提供 [watchlist](https://github.com/mvanhorn/last30days-skill/blob/f4dff26b3b14d3c55c5a9dedfc4c7c8c5df2f84a/skills/last30days/scripts/watchlist.py) 与持久存储，可参考跨次累积与新增判断；但其输入仍是主题搜索，不是账号完整发布历史。

## 4. Agent-Reach：工具可以替换，能力要重新验收

作者将平台接入整理成候选后端与使用指引，让 Agent 直接调用工具。值得参考的是把“知道用什么工具”与“保存采集结果”分开，而不是为每个平台重新写一个全套应用。

**核查发现：**README 对 doctor 的概括较宽泛，实际 [Twitter 检查实现](https://github.com/Panniantong/Agent-Reach/blob/94f06c1969dfc1834001269d79d3ad0972d9dee6/agent_reach/channels/twitter.py) 对已配置凭据仍返回未实时验证的状态。OpenLore 应用真实只读请求验收目标来源，不能只验收工具已安装或配置存在。

依据：[作者的设计说明](https://github.com/Panniantong/Agent-Reach/blob/94f06c1969dfc1834001269d79d3ad0972d9dee6/README.md)。

## 5. ClawFeed：区分产品能力与采集管道规划

[kevinho/clawfeed](https://github.com/kevinho/clawfeed/blob/38b43f0c3d5c781acbc3173a3a4a47f480cb18a5/README.md) 展示了由 Agent 配合来源配置与 API 组织内容的产品形态。不过，其 [架构文档](https://github.com/kevinho/clawfeed/blob/38b43f0c3d5c781acbc3173a3a4a47f480cb18a5/docs/ARCHITECTURE.md) 将 `raw_items` 与来源级共享采集列在待实施计划中；核查当前 `src` 与 `migrations` 也没有找到该表实现。

**可借鉴：**来源配置与结构化内容可独立于 AI 对话维护。但不能仅因项目声明支持 Twitter/RSS，就认为安装后已有完整采集、去重与补采服务。对 OpenLore 而言，该项目更适合作为产品组织参考。

## 归纳为 OpenLore 的实践建议

| 做法 | 依据 | 作用 |
| --- | --- | --- |
| 指定来源轮询与主题搜索分开 | RSS skill 与 last30days 的输入差异 | 分别评价覆盖完整性与发现相关性 |
| 每个来源都返回状态，失败单独补采 | 本次 RSS 实跑 | 防止整体任务正常结束掩盖漏采 |
| 抓取结果先落盘，再让 AI 消费 | RSS JSON 输出、x-reader 统一模型 | 支持追溯、重复分析和独立重试 |
| 校验正文身份、完整度与附件缺口 | x-reader 的实际修复 | 避免把验证页、摘要或配文当作全文 |
| 固定来源 ID、游标、去重和预算规则 | 现成工具能力边界与跨次存储需求 | 避免每次对话临时决定关键采集行为 |
| 已知稳定入口直接执行，复杂页面再交给 AI 探索 | Browser Use、Firecrawl、Crawl4AI 的官方使用方式 | 减少重复探索，保留可复用采集路径 |

最后三项涉及 OpenLore 的工程取舍，属于本次建议；当前尚未建设采集系统或完成长期稳定性验证。
