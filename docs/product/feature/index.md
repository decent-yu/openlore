# 功能与架构总览

管理员维护公共信息源；用户建立采集组，选择来源、配置关键词与 GitHub/Webhook 目标。系统获取内容，按组处理成文件，同步仓库后推送简报。

![OpenLore 架构与运行流程](assets/system-architecture.svg)

[单独查看 SVG](assets/system-architecture.svg)

| 功能 | 核心职责 |
| --- | --- |
| [01 来源与采集组配置](01-source-configuration.md) | 管理员维护来源；用户配置多个组及各自筛选与同步目标 |
| [02 采集能力](02-content-collection.md) | 统一协议调用独立适配器，获取内容并维护续采状态 |
| [03 内容处理](03-content-processing.md) | 按组筛选、提炼，生成稳定的 Markdown 文件包 |
| [04 文件同步与推送](04-delivery-and-git-archive.md) | 使用 GitHub Token 创建/更新仓库文件，再发送组内通知 |

本期来源为 Cloudflare 与 Simon Willison，采集能力为 RSS/Atom 与单篇 Web 文章。原始内容可共享，筛选、文件与交付状态按组独立；新基建能力通过独立目录和统一接口接入。

详细约定：[采集接入](../../design/collection-adapters.md) · [处理与文件同步](../../design/processing-and-delivery.md)。当前为文档设计，尚未实现运行系统。
