# 最小原型：RSS 订阅与文章导入

日期：2026-10-15。依据：[来源配置](../../feature/01-source-configuration.md)、[采集能力](../../feature/02-content-collection.md)、[内容处理](../../feature/03-content-processing.md)、[推送与 Git 沉淀](../../feature/04-delivery-and-git-archive.md)。

## 结论

**首期采用两个采集入口：RSS/Atom 订阅、单篇 URL 导入。首批自动来源确定为 Cloudflare Blog 和 Simon Willison，关注 Agent 工程与深度工程实践。**两个入口共用正文提取、去重、主题筛选和摘要流程，最后接入一个群推送出口与一个 Git 归档目标。

对当前这些公开技术网站，标准订阅与直接 HTTP 获取更适合建立可重复验证的基线。AI 负责理解主题、判断文章相关性和生成摘要；采集路径由配置明确指定。AI 浏览器与多平台 skill 留作后续复杂来源的候选。

首期来源方向已确认，技术选型仍为调研建议，尚未实现四项功能。

## 信息源选择

Cloudflare 提供厂商一手工程实践，Simon Willison 补充 LLM 与 Agent 的独立实践分析，两者共同覆盖当前阅读目标。Jules Blom 保留为前端专题候选，Anthropic Engineering 作为后续 Agent 深度内容候选。

各网站的主要内容、采集入口、验证结果与边界见[网站信息源清单](02-web-source-catalog.md)，来源配置要求见 [feature 01](../../feature/01-source-configuration.md)。已完成的验证仅说明当时可读取，不代表长期稳定性或正文完整度已验收。

## 配置如何驱动采集

主题与渠道分别配置：**主题定义想看什么，来源定义从哪里获取，渠道类型决定调用哪个采集器。**同一来源可以关联多个主题。

示意配置：

```yaml
topics:
  - id: agent-engineering
    description: 关注 Agent 工具调用、上下文管理、评估、可靠性与编程实践
  - id: engineering-practice
    description: 关注架构设计、性能优化、故障分析、数据库与基础设施

sources:
  - id: cloudflare
    name: Cloudflare Blog
    description: 网络、安全、数据库、性能优化、云基础设施与 Agent 工程实践
    type: rss
    url: https://blog.cloudflare.com/rss/
    topics: [agent-engineering, engineering-practice]
  - id: simon-willison
    name: Simon Willison
    description: LLM 工具、编程 Agent、开发方法与实际实验
    type: rss
    url: https://simonwillison.net/atom/everything/
    topics: [agent-engineering, engineering-practice]

imports:
  - url: https://blog.cloudflare.com/agentic-security-operations/
    topics: [agent-engineering]
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

1. 从 Cloudflare 与 Simon Willison 的 Feed 发现候选；给定文章 URL 能单独导入，重复导入与 RSS 命中合并为同一条。
2. 入选内容有可核对的正文、来源链接、主题匹配理由和短摘要；图示未读、摘要不完整等情况可见。
3. 连续运行两次，相同且未变化的内容不重复进入新简报；已有条目变化可更新记录。
4. 模拟一个来源超时，其余来源继续完成；恢复后可补抓失败条目，不重复处理已成功条目。
5. 配置好一个真实群入口与 Git 目标后，同一批内容实际完成两端交付；仅生成预览不算四项功能全部跑通。

**首期方向收敛为两个信息源、两类主题和四项功能闭环。**下一步明确各功能的具体行为与验收，再确定架构、模型及现有推送/Git 能力的接入方式。
