# 最小原型：RSS 订阅与文章导入

日期：2026-10-15。依据：[来源配置](../../feature/01-source-configuration.md)、[采集能力](../../feature/02-content-collection.md)、[内容处理](../../feature/03-content-processing.md)、[推送与 Git 沉淀](../../feature/04-delivery-and-git-archive.md)。

## 结论

**首版建议只做两个采集入口：RSS/Atom 订阅、单篇 URL 导入。首批自动来源选 Cloudflare Blog 和 Jules Blom。**两个入口共用正文提取、去重、主题筛选和摘要流程，最后接入一个群推送出口与一个 Git 归档目标。

对当前这些公开技术网站，标准订阅与直接 HTTP 获取更适合建立可重复验证的基线。AI 负责理解主题、判断文章相关性和生成摘要；采集路径由配置明确指定。AI 浏览器与多平台 skill 留作后续复杂来源的候选。

这是基于本次样本的选型建议，不是全网稳定性排名；本轮完成调研和访问验证，尚未实现四项功能。

## 四个网站的实际情况

本次使用普通 HTTP 客户端访问页面，发现页面声明的 Feed，再请求并解析 XML。结果仅代表当前网络和时间点；正文提取器对代码与图示的保真度、模型输出和实际交付尚未验证。

| 网站 / 输入 | 本次验证 | 原型处理建议 |
| --- | --- | --- |
| [Cloudflare Blog](https://blog.cloudflare.com/) | 首页声明 `/rss/`；[Feed](https://blog.cloudflare.com/rss/) 返回 200，20 个条目，抽查条目携带较长的 HTML 正文；一篇技术文章页直接请求也返回 200 | 首个自动来源，优先使用经校验的 Feed 正文，不足时补抓文章页 |
| [Jules Blom 文章](https://julesblom.com/writing/react-visual-notation) | 页面可直接获取，链接到 [rss.xml](https://julesblom.com/rss.xml)；Feed 返回 200，23 个条目，包含用户给定文章；抽查正文字段实际只有短摘要。带 ETag 重请求得到 304 | 第二个自动来源，验证“订阅发现 → 补抓正文”；同时用于单篇导入验收 |
| [Node Weekly 跳转链接](https://nodeweekly.com/link/191261/2859a796a1) | 返回 301，目标是 Medium 的 Booking.com 工程文章；本机访问目标超时。Node Weekly [RSS](https://nodeweekly.com/rss/) 可获取，但 4 个条目代表四期周刊，不是四篇独立文章 | 单篇入口负责跟随跳转、保存最终 URL。周刊内文章发现需要额外识别外链，可后续添加 |
| [Medium](https://medium.com/) | 本机首页、指定 publication Feed 及跳转目标请求超时；检索工具可读取目标文章。官方支持作者、publication、主题 RSS，但付费文章的 Feed 不提供全文 | 后续指定作者或 publication 接入，暂不作为首版成功验收的依赖 |

Node Weekly 的实际目标：[Node.js at scale, rebalanced: how we cut cost by 38%](https://medium.com/booking-com-development/node-js-at-scale-rebalanced-how-we-cut-cost-by-38-62ce247a3002)。这里观察到的是请求超时，不能据此断言目标文章收费或 Medium 永久不可采。

Medium 依据：[官方 RSS 说明](https://help.medium.com/hc/en-us/articles/214874118-Using-RSS-feeds-of-profiles-publications-and-topics)。

两个细节需要保留：Jules Blom 的 Feed 条目不是简单按发布时间倒序，不能只查看第一条决定是否有更新；这篇 React 文章含大量 SVG 图示，取得文字不等于理解全部图示，摘要应保留原文入口并明确视觉内容未解析。

## 配置如何驱动采集

主题与渠道分别配置：**主题定义想看什么，来源定义从哪里获取，渠道类型决定调用哪个采集器。**同一来源可以关联多个主题。

示意配置：

```yaml
topics:
  - id: infrastructure
    description: 关注后端性能、数据库和云基础设施的技术实现
  - id: frontend
    description: 关注 React 原理、组件设计和前端工程实践

sources:
  - id: cloudflare
    type: rss
    url: https://blog.cloudflare.com/rss/
    topics: [infrastructure]
  - id: jules-blom
    type: rss
    url: https://julesblom.com/rss.xml
    topics: [frontend]

imports:
  - url: https://julesblom.com/writing/react-visual-notation
    topics: [frontend]
```

主题筛选在配置来源范围内进行；新增网站首先添加 Feed 或文章 URL。凭据通过环境变量提供。首轮可限定最近 14 天与处理上限，明确报告被上限截断的候选；手动导入的指定文章不受新文章时间窗限制。

## 四项功能的最小交付

| 功能 | 首版范围 | 用户能看到的结果 |
| --- | --- | --- |
| 来源配置 | 一份配置文件维护主题、RSS 来源、文章 URL、处理上限，以及一个推送/Git 目标 | 改配置即可改变主题和来源，无需改采集代码 |
| 采集能力 | RSS 解析；文章 HTTP 获取；跟随重定向；逐条检查发布时间与 ID；保存内容和逐来源状态 | 列出新增、重复、补抓成功、失败及原因 |
| 内容处理 | 正文清洗、规范 URL、源内 ID 与规范 URL 去重；一个模型做主题判断、中文短摘要和相关理由 | 每条结果附标题、原文、来源、日期、摘要、相关主题与完整度 |
| 推送与 Git 沉淀 | 同一批结果生成 Markdown，接入一个现有群推送能力并写入一个 Git 仓库 | 群中简报与仓库归档对应同一批次，分别记录完成或失败 |

首版按“一次手动运行”交付完整闭环；跑通后再由外部定时器触发。使用轻量持久状态记录采集、处理和交付结果，使同一批任务可以重跑。

## 技术取舍

建议单进程工具起步：Python + [feedparser](https://feedparser.readthedocs.io/en/latest/) 解析订阅，HTTP 客户端请求页面，[Trafilatura](https://trafilatura.readthedocs.io/en/latest/) 提取正文，SQLite 保存条目与状态，再接一个模型和已有交付能力。

- 先检查 Feed 内容是全文还是摘要；需要时再补抓，保留原始链接和最终链接。
- RSS/Atom 中的 ID 用于源内识别；重定向后的规范 URL 用于合并重复导入。内容 hash 用于识别已存在文章是否改变。
- 以条目是否可靠入库为准推进状态；正文失败允许单独补抓。ETag/Last-Modified 用于减少重复下载，不替代条目去重。
- 模型只基于取得的内容判断和总结，输出结构化结果；抓取失败、正文缺失或模型失败单独记录并可重试。
- 群推送与 Git 分别保存状态；一端失败只补做该端。发送结果不明时单独标记，不承诺没有幂等支持的渠道绝对零重复。

库与结构属于建议，产品行为不绑定特定语言。重点是同一套流程能可靠处理两个入口，而不是首版就覆盖更多平台。

## 跑通的验收标准

1. 从 Cloudflare 与 Jules Blom 的 Feed 发现候选；给定文章 URL 能单独导入，重复导入与 RSS 命中合并为同一条。
2. 入选内容有可核对的正文、来源链接、主题匹配理由和短摘要；图示未读、摘要不完整等情况可见。
3. 连续运行两次，相同且未变化的内容不重复进入新简报；已有条目变化可更新记录。
4. 模拟一个来源超时，其余来源继续完成；恢复后可补抓失败条目，不重复处理已成功条目。
5. 配置好一个真实群入口与 Git 目标后，同一批内容实际完成两端交付；仅生成预览不算四项功能全部跑通。

**建议就以这个范围实现首版。**下一步只需落实模型与现有推送/Git 接口的接入信息，即可按四份 feature 逐项实现；本次不扩大平台范围。
