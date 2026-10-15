# 筛选、提炼与知识整理

日期：2026-10-15。关联：[产品规划](../product-brief.md) · [调研总览与源码版本](01-open-source-overview.md)。

## TrendRadar：从候选内容到简报

**功能：**热榜与 RSS 聚合、关键词或 AI 兴趣筛选、翻译、AI 分析、分组报告和多渠道通知。热榜抓取默认依赖 NewsNow API，RSS 则直接读取配置的订阅源。

**关键逻辑：**

1. 关键词和 AI 是可选筛选策略，并非默认串行执行两遍。
2. AI 流水线读取兴趣描述并计算 hash，判断标签是否需更新；筛出尚未分类的条目，分批调用模型并保存结果，再按标签与分数生成报告。
3. RSS 使用 URL + Feed、非空 GUID + Feed 的唯一索引控制源内重复；已有分类可复用，兴趣变更时支持重新分类。
4. `daily` 汇总当天匹配内容，可能包含已经推送过的条目；`current` 展示当前结果；`incremental` 只展示新增。报告范围与发送防重需要分别理解。

**重要边界：**本次核查的 `AIAnalyzer._prepare_news_content` 为热榜组装标题、来源、排名、时间与出现次数；RSS 主要组装标题、来源和发布时间。这里没有将文章全文送入该分析入口。可以借鉴筛选编排，但不能把此分析结果直接当作完整技术文章的摘要。

依据：[筛选配置](https://github.com/sansan0/TrendRadar/blob/ceabb027fe9bbdafec59dbbfa12cb46c2ba256ce/config/config.yaml)、[AI 流水线](https://github.com/sansan0/TrendRadar/blob/ceabb027fe9bbdafec59dbbfa12cb46c2ba256ce/trendradar/ai/filter_pipeline.py)、[分析输入](https://github.com/sansan0/TrendRadar/blob/ceabb027fe9bbdafec59dbbfa12cb46c2ba256ce/trendradar/ai/analyzer.py)、[RSS 索引](https://github.com/sansan0/TrendRadar/blob/ceabb027fe9bbdafec59dbbfa12cb46c2ba256ce/trendradar/storage/rss_schema.sql)、[热榜抓取](https://github.com/sansan0/TrendRadar/blob/ceabb027fe9bbdafec59dbbfa12cb46c2ba256ce/trendradar/crawler/fetcher.py)。

## Karakeep：从网页到可复用知识条目

**功能：**保存链接、笔记、图片和 PDF；抓取网页内容；AI 标签与摘要；全文和语义搜索；协作列表；RSS 导入与列表 Feed 输出。

**关键逻辑：**

1. Feed worker 每小时安排刷新，并按订阅源分散执行时间；通过该 Feed 的已导入 GUID 过滤已有条目，再创建链接书签，可将 RSS 分类导入为标签。
2. Crawler worker 抓取网页、提取可读正文和元信息并保存，成功后再安排标签、摘要、索引等后续任务，避免在订阅请求中同步完成全部 AI 工作。
3. 摘要附着在具体书签上，能与原文、标签、列表和后续检索共用。自动摘要需要启用配置，官方文档默认关闭。

**适用边界：**核心是资料收藏与整理，不能直接替代团队日报的筛选标准。Feed 导入路径要求条目存在 link 和 GUID；OpenLore 如果支持缺 GUID 的源，需要定义自己的回退身份。已核查路径未显示跨来源语义事件合并，不能把书签去重视为此能力。

依据：[官方功能](https://docs.karakeep.app/)、[Feed worker](https://github.com/karakeep-app/karakeep/blob/b783cf6d155d36e8e821e454b83499ed766228af/apps/workers/workers/feedWorker.ts)、[Crawler worker](https://github.com/karakeep-app/karakeep/blob/b783cf6d155d36e8e821e454b83499ed766228af/apps/workers/workers/crawlerWorker.ts)、[AI 配置](https://docs.karakeep.app/configuration/environment-variables/)、[RSS 集成](https://docs.karakeep.app/integrations/rss-feeds/)。

## 合并后的处理思路（建议）

| 环节 | 输入与输出 | 可借鉴逻辑 |
| --- | --- | --- |
| 初筛 | 来源、标题、时间 → 候选条目 | TrendRadar 的兴趣描述、分类缓存和批处理 |
| 正文补全 | 候选 URL → 可读正文或明确的缺失状态 | Miniflux 的站点规则、Karakeep 的异步抓取 |
| 提炼 | 正文与出处 → 短摘要、关键变化、适用场景、标签 | Karakeep 的条目级摘要；保留证据关联 |
| 合并 | 多条相关内容 → 同一主题/事件及多个来源 | 本次样本未验证完整能力，需要单独设计 |
| 产出 | 已整理条目 → 群日报与 Git 知识条目 | 同一份内容结果供两种渠道渲染 |

“值得关注”建议优先看团队相关性、信息增量与可行动性；热度只作为辅助。不要仅凭热榜排名决定技术知识价值。

## 三种去重不能混用

| 层次 | 示例 | 判断依据 |
| --- | --- | --- |
| 采集重复 | 同一文章被轮询多次 | 来源 ID、上游 ID、规范化 URL |
| 内容/事件重复 | 作者发 X、GitHub 发版本、公众号解读同一次发布 | 项目与版本、主要事实、原始出处；保留不同观点 |
| 发布重复 | 任务重跑，再次向同一群发送同一日报 | 日报标识、目标渠道、发送状态 |

这些是 OpenLore 的候选规则，不是已选实现。建议先用一小组真实材料验证：重复报道、无正文条目、版本更新、长篇技术文章各取样，检查摘要是否有原文依据、重要事实是否遗漏、事件是否误合并。模型成本和效果本次未测量。
