# 05 GitHub 交付归档

归档由云端控制服务执行。Runner 回传 AI 结果和文件，云端校验后构建归档包，再使用云端保管的 GitHub 凭据更新目标仓库。执行机不需要归档仓库的写入 Token；研读私有源码时使用执行机自身的读取凭据。

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
    ├── 01-核心执行架构.md
    ├── 02-工作区隔离机制.md
    ├── 03-任务状态与恢复.md
    └── assets/
        └── 01-核心执行架构/         # 该主题的可用配图
```

编号在每条流水线的每个仓库内独立递增；目录使用小写 `owner@repo`。重试保持首次分配的路径，避免重复编号或覆盖历史研报。仓库目录直接保存编号研报与配图，不生成 `articles/` 材料副本或仓库内 `README.md`。流水线根目录首页和批次导航保留，manifest 累积托管文件。归档包只记录实际研报路径，Wiki 与汇报直接链接研报。文章调研采用 `articles/YYYYMMDD-slug/` 目录。两类流水线各自产出归档包，共用 manifest、首页和批次导航、上传与交付记录；汇报方案统一汇总两类成功结果。

例如目标仓库选择 `Openlore Knowledge Vault`，目录填 `docs/agent-leaning`，则生成 `docs/agent-leaning/stablyai@orca/01-主题.md`；改填 `docs/xxx` 则生成 `docs/xxx/stablyai@orca/01-主题.md`。

在系统设置的 GitHub 仓库连接旁点击“设为默认 Token”，即可复用该连接已有的 Token；所选连接显示“默认 Token”标记。同机执行器的源码拉取和没有专用 Token 的归档连接自动使用默认值；远程 Runner 使用其自身读取凭据，连接自己的 Token 优先。更新默认连接的 Token 会同步生效；删除该连接会清除默认配置。Token 保存在本机凭据存储，不在界面回显。

## 规则

- 无新调研产出时返回 `unchanged`，不生成文件或空提交。
- 批次包含文章、本次完成研报和可用图片；成功下载的图片按哈希存储并重写为相对引用。下载失败不能声称“所有图片已永久保存”。
- 文章调研任务每篇文章同时交付 `article.md` 与 `article-zh-CN.md`，文章概览、首页和批次索引提供中文入口。译文逐段翻译标题、导读和正文，保留原文结构、图片引用、链接目标与代码，两份文章共用同一份图片资源。
- 译文使用自然、直白的中文，允许在同一文本节点内调整语序、将长句译成短句，保留原意、语气和适用限制；不增添术语定义、背景、例子或建议。已有中文与受保护内容保持不变，不套用调研文章的章节和配图模板。
- 文章调研的中文翻译使用流水线配置的 AI 执行器，执行记录标为“中文翻译”。翻译失败或结构校验不通过时停止本次归档；原文和完整翻译 Prompt 一致时，重试可复用已校验的译文，规则变化后重新翻译。历史已归档批次不会自动补译。
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

- `modules/delivery/service.ts`：统一交付入口、文章归档与手动追加调研。
- `modules/delivery/repository-archive.ts`：仓库研读产物与连续编号目录。
- `modules/delivery/publication.ts`：共享 manifest 读取、上传、交付记录和归档确认。
- `modules/delivery/archive-layout.ts`：共享首页和批次索引。
- `infrastructure/repositories/github/client.ts`：GitHub 写入。
- `infrastructure/media_assets/archiver.ts`：图片下载与相对引用处理。
- `modules/processing/service.ts`、`modules/research/service.ts`：组织文章和调研材料。

示例见[人工阅读样例](examples/README.md)，不能代替真实归档验收。

## 清理旧版仓库研读副本

更新并构建服务端后，执行只读预览：

```sh
node apps/server/scripts/repair-repository-layout.mjs --group <仓库研读流水线ID>
```

加 `--apply` 执行清理。工具只删除 manifest 托管的 `owner@repo/articles/` 副本与 `owner@repo/README.md`，保留研报、配图、流水线根首页与批次导航。先备份本地数据库、旧 manifest、待删文件及远端 HEAD，再用一个非强制 Git 提交删除重复页面并更新索引；分支变化时停止，完成后保存新的修复交付记录。报告路径与编号不变，旧交付记录和 Git 历史保留，重复执行不再次修改。
