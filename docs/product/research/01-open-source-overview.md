# 开源项目调研总览

日期：2026-10-15。关联：[产品规划](../product-brief.md)。当前无 Roadmap 编号，01–04 仅为调研序号。

## 范围与结论

围绕“团队挑选来源 → 持续采集 → 整理提炼 → 每日群推送 → Git 知识库”核查 7 个开源项目的官方资料及关键源码。未部署运行，登录态采集、模型质量和消息送达仍需实测。

本次样本中，**TrendRadar 最接近采集到推送的主流程；RSSHub、WeRSS 解决来源接入；Miniflux、Karakeep 提供内容处理参考；osmosfeed 提供 Git 驱动发布参考。**未发现可直接覆盖全部规划的现成闭环，尤其缺少“同一份精选内容同时形成群日报和长期 Git 知识条目”的完整实现。

## 项目对比

| 项目 | 已提供的相关功能 | 关键逻辑 | 对 OpenLore 的价值与边界 |
| --- | --- | --- | --- |
| [TrendRadar](https://github.com/sansan0/TrendRadar) | 热榜与 RSS 聚合、关键词或 AI 筛选、翻译、分析简报、多渠道通知 | 分离采集、筛选、报告和发送；保存分类结果；区分当日、当前、增量模式 | 最接近主流程；已核查分析入口主要使用标题和排名等元信息，不能直接等同于技术全文提炼 |
| [RSSHub](https://github.com/DIYgod/RSSHub) | 将多个网站、X 用户动态、GitHub 事件等转成订阅源 | 站点路由适配上游接口，再返回统一 Feed | 适合作为采集适配层；X 路由依赖凭据或第三方服务，存在路由不代表目标账号已验证可采 |
| [WeRSS](https://github.com/rachelos/we-mp-rss) | 公众号订阅、定时采集、全文、RSS、导出、Webhook、授权失效提醒 | 登录态驱动采集，文章入库，再生成 Feed 或消息 | 公众号候选接入服务；微信读书模式仅获取最新一篇，不能回补历史 |
| [wewe-rss](https://github.com/cooderl/wewe-rss) | 公众号历史文章、定时更新、全文 Feed、标题过滤、OPML | 账号选择、分页取文、按文章 ID 去重、Feed 渲染 | 可参考简洁实现；已归档且默认依赖外部中转，不作为首选运行依赖 |
| [Miniflux](https://github.com/miniflux/v2) | RSS 阅读、分类、过滤、正文抓取、REST API、Webhook | 条件请求、按源识别新条目、正文处理、增量通知 | 适合参考稳定采集逻辑；其 Webhook 失败不重试，仍需补偿机制 |
| [Karakeep](https://github.com/karakeep-app/karakeep) | RSS 导入、网页保存、AI 标签与摘要、全文与语义搜索、协作列表 | 导入书签后异步抓正文，再触发推理和搜索索引 | 适合参考正文驱动提炼与可查阅条目；群日报和 Git 发布需另接 |
| [osmosfeed](https://github.com/osmoscraft/osmosfeed) | GitHub Actions 更新 RSS 聚合站、HTML/Atom 输出、缓存 | 读取上次缓存、合并新增链接、渲染并部署静态产物 | 适合参考轻量发布；默认缓存只保留 30 天，不是永久知识库 |

关键实现与依据按能力合并在以下文件，避免每个项目重复介绍整条流程：

- [02 来源接入与持续采集](02-source-collection.md)：RSSHub、WeRSS、wewe-rss、Miniflux，以及 GitHub 项目接入。
- [03 筛选、提炼与知识整理](03-content-processing.md)：TrendRadar、Karakeep，以及去重层次。
- [04 群推送与 Git 沉淀](04-delivery-and-git-archive.md)：TrendRadar、Miniflux、osmosfeed，以及双端发布。

## 综合判断（调研建议，尚未定案）

1. **OpenLore 自己组织核心流程，按需接入采集服务。**RSSHub、WeRSS 可独立部署后通过 Feed/API 接入，无需同时运行全部项目。
2. **内容提炼以原文证据为基础。**标题筛选可控制成本，入选后再抓正文、生成摘要和关联主题；保留原始链接与来源。
3. **采集去重、事件合并、发布防重分别处理。**不同源谈论同一发布时可以合并展示，但保留多条出处。
4. **日报与知识条目共用内容结果。**群内提供短摘要，Git 保存可长期查阅的 Markdown 条目和日报索引；两端分别记录发布结果。

作为全新项目，直接围绕上述职责划分实现即可，不沿用参考项目的旧接口兼容层或历史迁移逻辑。具体选型仍需小规模验证，不将本次建议写成已确认功能。

## 核查快照

下表记录本次源码基准。许可证名称来自对应版本的根目录 LICENSE，仅用于标识项目；源码引用均尽量固定到提交。

| 项目 | 源码基准 | 许可证 | 维护信号 |
| --- | --- | --- | --- |
| RSSHub | [d24f513](https://github.com/DIYgod/RSSHub/tree/d24f5136487a388662ec6656e4f1ba4ff46b0ed8) | [AGPL-3.0](https://github.com/DIYgod/RSSHub/blob/d24f5136487a388662ec6656e4f1ba4ff46b0ed8/LICENSE) | 快照提交日期 2026-10-15 |
| WeRSS | [9b40351](https://github.com/rachelos/we-mp-rss/tree/9b40351fd1913e7f74cf88f65740cd67a28baf81) | [MIT](https://github.com/rachelos/we-mp-rss/blob/9b40351fd1913e7f74cf88f65740cd67a28baf81/LICENSE) | 快照提交日期 2026-10-10 |
| wewe-rss | [e751c64](https://github.com/cooderl/wewe-rss/tree/e751c64294080d83deb1610d2667bed3cfa4b393) | [MIT](https://github.com/cooderl/wewe-rss/blob/e751c64294080d83deb1610d2667bed3cfa4b393/LICENSE) | 仓库页面标记 2026-05-11 归档 |
| Miniflux | [c317f84](https://github.com/miniflux/v2/tree/c317f84bc3779bc5d936b75408b631589983c81a) | [Apache-2.0](https://github.com/miniflux/v2/blob/c317f84bc3779bc5d936b75408b631589983c81a/LICENSE) | 快照提交日期 2026-10-12 |
| TrendRadar | [ceabb02](https://github.com/sansan0/TrendRadar/tree/ceabb027fe9bbdafec59dbbfa12cb46c2ba256ce) | [GPL-3.0](https://github.com/sansan0/TrendRadar/blob/ceabb027fe9bbdafec59dbbfa12cb46c2ba256ce/LICENSE) | 快照提交日期 2026-10-13 |
| Karakeep | [b783cf6](https://github.com/karakeep-app/karakeep/tree/b783cf6d155d36e8e821e454b83499ed766228af) | [AGPL-3.0](https://github.com/karakeep-app/karakeep/blob/b783cf6d155d36e8e821e454b83499ed766228af/LICENSE) | 核查当日 HEAD 及官方文档，非部署验证 |
| osmosfeed | [49fcf4b](https://github.com/osmoscraft/osmosfeed/tree/49fcf4b13bc416d34df6e3451fc92565c6779cf7) | [MIT](https://github.com/osmoscraft/osmosfeed/blob/49fcf4b13bc416d34df6e3451fc92565c6779cf7/LICENSE) | 快照提交日期 2023-10-10；旧工作流需更新后使用 |
