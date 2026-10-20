# 05 GitHub 交付归档

归档由云端控制服务执行。Runner 回传 AI 结果和文件，云端校验后构建归档包，再使用云端保管的 GitHub 凭据更新目标仓库。执行机不需要仓库 Token。

## 文件结构

每条流水线配置仓库、分支与相对目录 `base_path`（如 `docs/agent-learning`）。文章平铺，目录使用首次收录日期（`YYYYMMDD`）加语义名称：

```text
<base_path>/
├── README.md                         # 最近收录、最近更新、采集批次
├── articles/
│   └── 20261020-article-slug/
│       ├── README.md                 # 原文、中文、研报、来源与收录时间
│       ├── article.md                # 原文整理
│       ├── article-zh-CN.md          # 简体中文译文
│       ├── research.md               # 完成调研时提供
│       └── assets/                   # 成功归档的图片与生成配图
├── batches/
│   └── 20261020-01.md                # 链接到文章，不复制正文
└── .openlore/manifest.json

```

日期按流水线时区计算，表示首次收录时间，原文发布日期另外展示。重新调研、跨日更新和标题变更沿用已发布目录，仅更新页面中的更新时间。同一天同名的不同文章使用标识摘要消歧。目录支持中文和完整词边界，现有文章可使用人工精简的语义名称。

首页分别按首次收录时间和内容更新时间倒序展示文章，累计保留已成功归档的文章与批次，失败交付不进入后续索引。不生成自动主题分类目录。追加研报时同步更新文章概览和首页。

流水线不生成批次 `digest.md`。简报由独立的[汇报方案](06-reporting.md)生成并发送，不能混作每次文章归档的必选产物。

## GitHub 仓库研读目录

使用同一流水线的目标仓库、分支和自定义 `base_path`，按来源仓库分目录，研报编号跨天递增：

```text
docs/xxx/
└── stablyai@orca/
    ├── README.md
    ├── 01-核心执行架构.md
    ├── 02-工作区隔离机制.md
    ├── 03-任务状态与恢复.md
    ├── articles/
    │   ├── 01-核心执行架构.md       # 本次源码与文档材料
    │   └── 02-工作区隔离机制.md
    └── assets/
        └── 01-核心执行架构/         # 该主题的可用配图
```

编号在每条流水线的每个仓库内独立递增；目录使用小写 `owner@repo`。重试保持首次分配的路径，避免重复编号或覆盖历史研报。仓库索引保留已归档主题，manifest 累积托管文件。文章和研报的实际路径记录在归档包中，Wiki 与汇报使用已确认成功的真实路径。RSS 文章继续使用日期批次目录，混合来源也可同批归档。

例如目标仓库选择 `Openlore Knowledge Vault`，目录填 `docs/agent-leaning`，则生成 `docs/agent-leaning/stablyai@orca/01-主题.md`；改填 `docs/xxx` 则生成 `docs/xxx/stablyai@orca/01-主题.md`。

## 规则

- 无新调研产出时返回 `unchanged`，不生成文件或空提交。
- 批次包含文章、本次完成研报和可用图片；成功下载的图片按哈希存储并重写为相对引用。下载失败不能声称“所有图片已永久保存”。
- 每篇文章同时交付 `article.md` 与 `article-zh-CN.md`，文章概览、首页和批次索引提供中文入口。译文逐段翻译标题、导读和正文，保留原文结构、图片引用、链接目标与代码，两份文章共用同一份图片资源。
- 译文使用自然、直白的中文，允许在同一文本节点内调整语序、将长句译成短句，保留原意、语气和适用限制；不增添术语定义、背景、例子或建议。已有中文与受保护内容保持不变，不套用调研文章的章节和配图模板。
- 中文翻译使用流水线配置的 AI 执行器，执行记录标为“中文翻译”。翻译失败或结构校验不通过时停止本次归档；原文和完整翻译 Prompt 一致时，重试可复用已校验的译文，规则变化后重新翻译。历史已归档批次不会自动补译。
- GitHub 客户端使用 Git Data API 构造 Blob、Tree、Commit 并更新 Ref；交付结果记录状态、变更路径、Commit 与错误信息。
- `.openlore/manifest.json` 描述托管文件与文章/批次位置；交付结果和 Commit 记录在云端数据库，不应把 manifest 当作完整提交历史账本。
- 文章与研报一起归档成功后流水线才完成，汇报方案只消费成功结果。手动追加调研也要单独记录归档结果。

## Wiki 阅读链接

在“系统设置 → 外部集成与执行器 → GitHub 仓库连接”中配置 Wiki Base URL 与 Wiki 展示路由（仓库目录）。例如 Base URL 为 `https://wiki.mua5201314.com/raven/openlore-knowledge-vault`、目录为 `docs` 时：

```text
docs/agent-learning/articles/20261015-deno-is-joining-cloudflare/research.md
→ https://wiki.mua5201314.com/raven/openlore-knowledge-vault/agent-learning/articles/20261015-deno-is-joining-cloudflare/research
```

移除完整目录前缀与 `.md`，按路径段编码后拼到 Base URL；目录留空表示仓库根目录，Base URL 留空关闭 Wiki 链接。目录外的文件不生成链接。

首页、内容池的标题、正文和研报入口使用已成功归档的真实文件位置；研报弹窗保留 Wiki 入口。汇报中的深度调研文章优先链接到 Wiki 研报，否则使用 Wiki 正文或原有链接。修改配置后历史归档即时应用，无需重新生成文章。

缺少独立交付记录的已完成研报，按已归档正文目录映射到同目录 `research` 页面；已有明确归档失败记录时不推断研报已发布。链接映射不等于逐页检查网站是否存在。

该配置只负责阅读链接映射；GitHub 到 Wiki 的同步由现有网站集成负责，OpenLore 不验证或触发网站同步，因此归档成功后页面仍可能有同步延迟。

## 实现位置

- `modules/delivery/service.ts`：批次分配、归档包、目录与 manifest。
- `infrastructure/repositories/github/client.ts`：GitHub 写入。
- `infrastructure/media_assets/archiver.ts`：图片下载与相对引用处理。
- `modules/processing/service.ts`、`modules/research/service.ts`：组织文章和调研材料。

示例见[人工阅读样例](examples/README.md)，不能代替真实归档验收。
