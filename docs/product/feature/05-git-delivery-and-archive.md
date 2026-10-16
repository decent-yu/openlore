# 05 知识库与 Git 交付归档 (Git Delivery & Archive)

OpenLore 坚持“本地主权与透明归档”原则。系统不是一个封闭的黑盒数据库，所有入选的文章、配图、批次简报与深度调研报告，最终均以干净易读的 Markdown 结构归档沉淀至用户的 Git 仓库中。

---

## 一、产品功能与交付物结构

### 1. 仓库归档文件树

每个流水线任务（Group）在绑定的目标仓库中拥有独立的路由前缀（`base_path`，如 `docs/agent-learning`）。每次运行交付时，按“日期批次”组织目录：

```text
<base_path>/
├── .openlore/
│   └── manifest.json                    # 批次与文章版本追踪清单
└── 20261016-01/                         # 日期批次目录 (YYYYMMDD-序号)
    ├── 01-agent-recovery-persistence/   # 序号 + 语义 Slug 目录
    │   ├── article.md                   # 导读与清洗后的规范化原文
    │   ├── research.md                  # 深度技术调研报告 (已完成调研的文章)
    │   └── assets/                      # 本地化配图目录 (防防盗链/永久可用)
    │       ├── diagram-a1b2c3d4.png
    │       └── flow-e5f6g7h8.svg
    ├── 02-llm-context-window-cache/
    │   ├── article.md
    │   └── ...
    └── ...
```

### 2. 关键设计原则

- **图片全量本地化 (`assets/`)**：
  - 自动爬取并本地下载原文中的所有配图，计算 SHA-256 并持久化存储。
  - 自动将 Markdown 中的远程图床链接重写为相对路径 `./assets/<file>`，彻底杜绝外链失效、防盗链 403 或内容被删的问题。
- **零新内容 = 零提交 (Zero Empty Commits)**：
  - 若某次定时运行没有发现符合评分门槛的新文章，则不生成任何文件，不向 Git 仓库推送任何空 Commit。
- **可复现与增量同步**：
  - 通过 `.openlore/manifest.json` 记录所有交付批次、Commit SHA 与文章 Revision。
  - 重复运行无变更内容时自动检测并跳过，防止产生冗余提交。

---

## 二、代码与系统实现

### 1. 核心架构与模块对应
- **交付服务**：`apps/server/src/modules/delivery/service.ts` (`DeliveryService`)
  - 负责分配批次目录序号、生成产物包（Artifact Bundle）及调度仓库写入。
- **配图归档与链接重写**：`apps/server/src/modules/processing/service.ts` (`MediaAssetsArchiver`)
  - 安全下载图片并存入 `media_assets`，重写正文图片链接。
- **GitHub API 客户端**：`apps/server/src/infrastructure/repositories/github/client.ts` (`GitHubClient`)
  - 基于 GitHub Git Data API（Blob -> Tree -> Commit -> Ref），以单次原子 Commit 方式提交完整目录包。
- **通知发送器**：`apps/server/src/infrastructure/notifications/generic_webhook/sender.ts` (`GenericWebhookSender`)
  - 由汇报模块在所选任务全部成功归档后调用，任务归档本身不发送通知。

### 2. 批次序号分配算法 (`allocateCollectionSequence`)
以流水线任务所在时区（如 `Asia/Shanghai`）的当前日期作为前缀：
```ts
// 格式化 YYYYMMDD
const dateSequence = `${yyyymmdd}-${String(todayCols.length + 1).padStart(2, '0')}`;
```
同一天内的多次运行自动递增序号（`-01`, `-02` ...），确保目录结构井然有序。

### 3. 数据表与交付记录
- `collectionsTable`：记录生成的批次序号及所属组 ID。
- `deliveriesTable`：记录交付结果（`status: 'success' | 'failed'`、Commit SHA、耗时及变更文件数）。
- `mediaAssetsTable`：管理所有已本地化的图片资源及哈希值。

## 任务与汇报边界

流水线先完成审核与调研，再将文章和研报一起归档。归档模块不发送群通知；汇报推送独立汇总一个或多个任务的成功归档结果。
