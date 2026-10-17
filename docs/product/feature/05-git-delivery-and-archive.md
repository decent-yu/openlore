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
    │   ├── article.md
    │   ├── research.md          # 完成调研时提供
    │   └── assets/              # 成功归档的图片与生成配图
    └── 02-another-article/
        └── article.md
```

流水线不生成批次 `digest.md`。简报由独立的[汇报方案](06-reporting.md)生成并发送，不能混作每次文章归档的必选产物。

## 规则

- 无新增精选时返回 `unchanged`，不生成文件或空提交。
- 批次包含文章、已完成研报和可用图片；成功下载的图片按哈希存储并重写为相对引用。下载失败不能声称“所有图片已永久保存”。
- GitHub 客户端使用 Git Data API 构造 Blob、Tree、Commit 并更新 Ref；交付结果记录状态、变更路径、Commit 与错误信息。
- `.openlore/manifest.json` 描述托管文件与文章/批次位置；交付结果和 Commit 记录在云端数据库，不应把 manifest 当作完整提交历史账本。
- 文章与研报一起归档成功后流水线才完成，汇报方案只消费成功结果。手动追加调研也要单独记录归档结果。

## 实现位置

- `modules/delivery/service.ts`：批次分配、归档包、目录与 manifest。
- `infrastructure/repositories/github/client.ts`：GitHub 写入。
- `infrastructure/media_assets/archiver.ts`：图片下载与相对引用处理。
- `modules/processing/service.ts`、`modules/research/service.ts`：组织文章和调研材料。

示例见[人工阅读样例](examples/README.md)，不能代替真实归档验收。
