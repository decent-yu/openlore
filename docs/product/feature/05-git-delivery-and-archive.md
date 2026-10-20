# 05 GitHub 交付归档

归档由云端控制服务执行。Runner 回传 AI 结果和文件，云端校验后构建归档包，再使用云端保管的 GitHub 凭据更新目标仓库。执行机不需要仓库 Token。

## 文件结构

每条流水线配置仓库、分支与相对目录 `base_path`（如 `docs/agent-learning`）。批次按任务时区的日期和当天序号组织：

```text
<base_path>/
├── README.md
├── .openlore/manifest.json
└── 20261016-01/
    ├── README.md
    ├── 01-article-slug/
    │   ├── article.md          # 原文整理
    │   ├── article-zh-CN.md    # 简体中文译文
    │   ├── research.md          # 完成调研时提供
    │   └── assets/              # 成功归档的图片与生成配图
    └── 02-another-article/
        ├── article.md
        └── article-zh-CN.md
```

流水线不生成批次 `digest.md`。简报由独立的[汇报方案](06-reporting.md)生成并发送，不能混作每次文章归档的必选产物。

## 规则

- 无新调研产出时返回 `unchanged`，不生成文件或空提交。
- 批次包含文章、本次完成研报和可用图片；成功下载的图片按哈希存储并重写为相对引用。下载失败不能声称“所有图片已永久保存”。
- 每篇文章同时交付 `article.md` 与 `article-zh-CN.md`，批次目录提供中文入口。译文逐段翻译标题、导读和正文，保留原文结构、图片引用、链接目标与代码，两份文章共用同一份图片资源。
- 中文翻译使用流水线配置的 AI 执行器，执行记录标为“中文翻译”。翻译失败或结构校验不通过时停止本次归档；重试可复用已校验的译文。历史已归档批次不会自动补译。
- GitHub 客户端使用 Git Data API 构造 Blob、Tree、Commit 并更新 Ref；交付结果记录状态、变更路径、Commit 与错误信息。
- `.openlore/manifest.json` 描述托管文件与文章/批次位置；交付结果和 Commit 记录在云端数据库，不应把 manifest 当作完整提交历史账本。
- 文章与研报一起归档成功后流水线才完成，汇报方案只消费成功结果。手动追加调研也要单独记录归档结果。

## Wiki 阅读链接

在“系统设置 → 外部集成与执行器 → GitHub 仓库连接”中配置 Wiki Base URL 与 Wiki 展示路由（仓库目录）。例如 Base URL 为 `https://wiki.mua5201314.com/raven/openlore-knowledge-vault`、目录为 `docs` 时：

```text
docs/agent-leaning/20261015-02/01-deno-is-joining-cloudflare/research.md
→ https://wiki.mua5201314.com/raven/openlore-knowledge-vault/agent-leaning/20261015-02/01-deno-is-joining-cloudflare/research
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
