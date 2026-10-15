# 来源接入与持续采集

日期：2026-10-15。参考：[产品规划](../../product-brief.md) · [调研总览与源码版本](01-open-source-overview.md)。

## RSSHub：统一来源格式

**功能：**通过站点路由，把 X 用户动态、GitHub 仓库事件及其他网站内容转换为 Feed。

**关键逻辑：**X 用户路由先解析账号与回复/转发参数，再调用对应 API，最后统一转换成订阅条目。API 选择器优先使用已配置的第三方接口或 Web 登录态，否则使用开发者凭据；缺少配置会明确报错。GitHub 仓库事件通过事件类型过滤后转换成标题、链接与发布时间。

**适用边界：**RSSHub 解决“怎样拿到并标准化内容”，不负责团队价值判断。X 接入方式应逐账号实测，不能把第三方服务或登录态的可用性当作长期保证。

依据：[X 用户路由](https://github.com/DIYgod/RSSHub/blob/d24f5136487a388662ec6656e4f1ba4ff46b0ed8/lib/routes/twitter/user.ts)、[API 选择器](https://github.com/DIYgod/RSSHub/blob/d24f5136487a388662ec6656e4f1ba4ff46b0ed8/lib/routes/twitter/api/index.ts)、[GitHub 仓库事件](https://github.com/DIYgod/RSSHub/blob/d24f5136487a388662ec6656e4f1ba4ff46b0ed8/lib/routes/github/repo-event.ts)。

## WeRSS 与 wewe-rss：公众号接入

| 对比项 | WeRSS（we-mp-rss） | wewe-rss |
| --- | --- | --- |
| 功能 | 定时采集、RSS、正文、Markdown 等格式导出、API/Webhook、授权失效提醒 | 定时采集、历史文章、RSS/Atom/JSON、全文、标题过滤、OPML |
| 采集方式 | 包含公众号后台登录态与可选微信读书模式 | 微信读书账号，经可配置的外部平台 API 获取文章列表 |
| 去重方式 | 文章 ID 查重，并按内容字段变化更新 | SQLite 按文章 ID upsert；MySQL 批量写入时跳过重复 |
| 主要边界 | 微信读书模式只取最新一篇；缺正文条目下轮可能被跳过 | 项目已归档；默认中转服务不在本地部署闭环内 |

**WeRSS 关键逻辑：**定时任务读取公众号与任务配置，采集结果通过 `UpdateArticle → Db.add_article` 入库，再由 RSS 或消息任务输出。微信读书模式请求 `/api/mp/cover` 获取最新文章，再请求正文并抽取 `#js_content`。官方文档明确：没有历史列表；正文失败时可空正文入库，下轮同一 ID 会跳过。因此，两次轮询之间发布多篇文章时，存在漏采，不能视为完整历史同步。

依据：[功能说明](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/ReadMe.md)、[采集任务](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/jobs/mps.py)、[入库逻辑](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/core/db.py)、[微信读书模式与限制](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/docs/weread-mp.md)。

**wewe-rss 关键逻辑：**按计划遍历订阅，串行更新并等待；选择可用账号，分页请求平台 API；按文章 ID 保存；读取数据库生成 Feed，按需补抓正文。默认 `PLATFORM_URL` 指向外部服务，说明“可私有化部署”不等于采集链路完全自包含。历史文章是仓库声明与实现提供的能力，本次未验证当前上游仍可用。

依据：[采集与入库](https://github.com/cooderl/wewe-rss/blob/e751c64294080d83deb1610d2667bed3cfa4b393/apps/server/src/trpc/trpc.service.ts)、[定时与 Feed 生成](https://github.com/cooderl/wewe-rss/blob/e751c64294080d83deb1610d2667bed3cfa4b393/apps/server/src/feeds/feeds.service.ts)、[外部平台配置](https://github.com/cooderl/wewe-rss/blob/e751c64294080d83deb1610d2667bed3cfa4b393/apps/server/src/configuration.ts)、[归档状态](https://github.com/cooderl/wewe-rss)。

## Miniflux：稳定轮询与正文处理

**功能：**RSS/Atom 等订阅、分类、过滤、正文抓取、API 和增量 Webhook。

**关键逻辑：**请求带上上次的 ETag/Last-Modified；内容未变则跳过解析。发生限流时读取重试时间，正常请求结合 Feed TTL 与缓存头安排下次检查。条目处理后按 `(feed_id, hash)` 判断是否已存在，再把新条目交给通知集成。

**适用边界：**按订阅源识别重复，不等于跨站同一事件合并。正文抓取解决摘要源内容不足，但仍受页面结构和访问条件影响。可作为独立 RSS 服务接入，也可仅参考其轮询逻辑，不必引入整个阅读器。

依据：[刷新主流程](https://github.com/miniflux/v2/blob/c317f84bc3779bc5d936b75408b631589983c81a/internal/reader/handler/handler.go)、[条目存储](https://github.com/miniflux/v2/blob/c317f84bc3779bc5d936b75408b631589983c81a/internal/storage/entry.go)、[过滤与正文规则](https://miniflux.app/docs/rules.html)。

## GitHub 项目：先明确关注什么

项目规划中的“关注 GitHub 项目”可以指版本发布、仓库活动或发现新项目，数据入口不同：

| 目标 | 可用入口 | 对日报的影响 |
| --- | --- | --- |
| 指定项目版本更新 | GitHub Releases API，获取版本号、说明、发布时间、预发布标记 | 适合提炼“变了什么、为什么值得关注” |
| Issue、PR 等活动 | GitHub API 或 RSSHub 对应路由 | 需要明确事件范围，避免大量开发流水进入日报 |
| 发现新项目 | RSSHub GitHub Trending 路由等 | 属于候选内容发现，不能替代已选项目追踪 |

GitHub 官方 API 支持条件请求，适合复用 ETag 降低重复拉取。依据：[Releases API](https://docs.github.com/en/rest/releases/releases)、[API 最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)、[Trending 路由](https://github.com/DIYgod/RSSHub/blob/d24f5136487a388662ec6656e4f1ba4ff46b0ed8/lib/routes/github/trending.tsx)。

## 对 OpenLore 的归纳（建议）

- 原生 RSS/API 优先；无标准入口时接 RSSHub；公众号使用独立适配服务。
- 统一保存来源、上游 ID、原文 URL、发布时间、发现时间与正文获取状态。已发现但缺正文的条目允许单独补抓。
- 以来源 ID + 条目 ID 做基础去重；无可靠 ID 时用规范化 URL。来源失效应记录为采集失败，不能伪装成“今日无更新”。
- 在选定少量真实来源后验证：新增能否发现、重复是否过滤、连续多篇是否漏采、认证失效是否可见。当前不承诺 X 或公众号全量可采。
