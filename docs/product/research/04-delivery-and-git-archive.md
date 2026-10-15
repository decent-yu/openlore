# 群推送与 Git 知识沉淀

日期：2026-10-15。关联：[产品规划](../product-brief.md) · [调研总览与源码版本](01-open-source-overview.md)。

## TrendRadar：报告渲染与多渠道发送

**功能：**支持飞书、钉钉、企业微信、Telegram、邮件等渠道，包含分组、AI 分析区域与消息分批。

**关键逻辑：**统一调度器选择渠道与账号；渲染层把报告数据转换成各渠道格式；分批逻辑按消息字节大小预留批次头部；发送器解析平台返回值。飞书发送器同时检查 HTTP 状态和业务状态码，某批失败会返回失败。

**适用边界：**多渠道发送成功判断不等于持久化可靠投递。以已核查的飞书路径为例，前几批成功、后续失败后，仅重跑整份报告可能重复前几批；需要单独处理投递记录与重试。不能因为某个渠道有重试，就推断所有渠道都具备同样保证。

依据：[调度器](https://github.com/sansan0/TrendRadar/blob/ceabb027fe9bbdafec59dbbfa12cb46c2ba256ce/trendradar/notification/dispatcher.py)、[分批逻辑](https://github.com/sansan0/TrendRadar/blob/ceabb027fe9bbdafec59dbbfa12cb46c2ba256ce/trendradar/notification/batch.py)、[渠道发送器](https://github.com/sansan0/TrendRadar/blob/ceabb027fe9bbdafec59dbbfa12cb46c2ba256ce/trendradar/notification/senders.py)。

## Miniflux：增量事件出口

新条目入库后触发 `new_entries`，手动保存条目触发 `save_entry`；载荷包含来源、条目 URL、正文等信息，并使用 HMAC 签名。官方明确说明请求失败不重试。因此它可以是内容入口，不能单独承担 OpenLore 每日简报的可靠发送职责。

依据：[Webhook 文档](https://miniflux.app/docs/webhooks.html)、[实现](https://github.com/miniflux/v2/blob/c317f84bc3779bc5d936b75408b631589983c81a/internal/integration/webhook/webhook.go)。

## osmosfeed：Git 驱动的聚合发布

**功能：**仓库配置订阅源，Actions 定时构建，输出 HTML、Atom 和 `cache.json`，模板工作流将 `public` 部署到 GitHub Pages。

**关键逻辑：**先恢复上次缓存，再拉取 Feed；在每个来源内按链接过滤已有条目，为新条目补充网页描述等元信息；合并缓存后按日期窗口保留内容，渲染站点并写出新缓存。获取源失败时可以沿用旧缓存。

**适用边界：**默认 `cacheMaxDays=30`，过期文章会从当前产物移除；所谓摘要主要来自 Feed 内容、页面描述或截断，不是 AI 提炼。静态站点发布与“保存长期 Markdown 知识条目”仍有差距。该快照较旧，模板中的 Node 16、Actions 旧版本只作为流程参考。

依据：[构建入口](https://github.com/osmoscraft/osmosfeed/blob/49fcf4b13bc416d34df6e3451fc92565c6779cf7/packages/cli/src/main.ts)、[增量合并与内容补充](https://github.com/osmoscraft/osmosfeed/blob/49fcf4b13bc416d34df6e3451fc92565c6779cf7/packages/cli/src/lib/enrich.ts)、[缓存配置](https://github.com/osmoscraft/osmosfeed/blob/49fcf4b13bc416d34df6e3451fc92565c6779cf7/docs/osmosfeed-yaml-reference.md)、[官方模板工作流](https://github.com/osmoscraft/osmosfeed-template/blob/main/.github/workflows/update-feed.yaml)。

## OpenLore 双端产出（建议）

同一批已筛选、已提炼内容，生成两种产物：

| 产物 | 建议保留的内容 | 用途 |
| --- | --- | --- |
| 群日报 | 日期、精选主题、短摘要、原文与知识库链接 | 当天快速了解 |
| Git 知识条目 | 稳定标识、标题、来源及发布时间、摘要、关键事实、主题标签、出处 | 日后查阅和复用 |
| Git 日报索引 | 当天入选条目链接和简短说明 | 回顾某一天关注了什么 |

建议流程：

1. 固定本次日报的日期窗口、条目集合与生成结果，得到稳定日报标识。
2. 写出知识条目与日报索引；同一条目使用稳定路径，内容无变化不制造重复提交。
3. Git 同步成功后，向群发送含知识库链接的短日报。群发送失败仅重试发送；Git 同步失败则保留待发布结果。
4. 分别保存 Git 提交与各群/批次发送结果。超时但平台可能已收件时标记结果不明；平台不支持幂等键时，不能承诺绝对零重复。

以上是候选交付逻辑，并非参考项目已提供的完整能力；群平台、目标 Git 仓库、发送时刻和内容数量仍待确定。

## 调度选择

| 方式 | 适合场景 | 主要取舍 |
| --- | --- | --- |
| GitHub Actions 定时运行 | 低频采集、每日生成、希望少维护服务 | 官方说明计划任务可能延迟甚至丢弃；不应承诺准点发送 |
| 常驻服务 + 定时任务 | 来源有登录态、需要持续采集和失败补偿 | 需要持久化状态与服务运维，但便于单独重试各阶段 |

推断：如果公众号、X 是主要来源，常驻采集更便于管理状态；如果主要来源是公开 RSS 与 GitHub Releases，Actions 可用于验证轻量闭环。依据：[GitHub schedule 行为](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。
