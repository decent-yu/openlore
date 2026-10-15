# 内容处理与文件同步设计

对应：[内容处理](../product/feature/03-content-processing.md)、[推送与 Git 沉淀](../product/feature/04-delivery-and-git-archive.md)。状态：本期接口与实现方向，尚未编码。

## 处理接口

`process(ProcessingRequest) -> ProcessingResult`，输入引用已持久化的 ContentItem，不重新定义采集结构。

| 输入字段 | 类型与含义 |
| --- | --- |
| `run_id/group_id` | string，本次运行与采集组 |
| `group_revision` | string，本次使用的不可变组配置修订 |
| `items` | `{article_id, revision, content_ref, source_ids}[]`，稳定文章、内容版本与来源关联 |
| `focus/source_keywords/preferences` | 关注描述、按来源区分的关键词、筛选偏好 |
| `model_ref/prompt_revision/rules_revision` | 模型配置引用与处理版本 |
| `language` | 输出语言，首期中文 |

| 输出字段 | 类型与含义 |
| --- | --- |
| `status` | `success/partial/failed` |
| `decisions` | `{article_id, outcome, reason}[]`；outcome 为 `selected/excluded/pending` |
| `entries` | 本组的知识条目：文章标识、摘要、关键事实、相关理由、来源、完整度 |
| `bundle_ref/batch_id` | 已保存文件包及不可变批次标识，无可交付内容时可空 |
| `errors` | 按文章标识关联的错误与重试条件 |

处理结果按文章版本、组配置和处理版本复用。模型输出经过结构校验，引用必须来自输入证据；失败或内容缺失返回 pending。全部排除也可成功，但不为凑数编造文章；没有文件变化时跳过交付。

## 文件包：ArtifactBundle

| 字段 | 语义 |
| --- | --- |
| `group_id/batch_id` | 所属组和固定批次；重试沿用，不重新生成 |
| `group_revision` | 绑定的组配置修订，避免重试时改投其他仓库或 Webhook |
| `entries` | 本批入选文章标识与内容版本，供核对 |
| `files` | `{path, content, sha256, media_type}[]`；path 相对组归档根目录，内容为 UTF-8 |
| `base_manifest_ref` | 生成文件包时依据的上次已确认管理清单，可空 |

路径固定为 `articles/<article_id>.md`、`digests/<batch_id>.md`、`index.md` 与 `.openlore-manifest.json`。索引与管理清单由该组已归档条目和本批变化生成；清单不包含自身摘要值，避免自引用。最终清单记录实际管理的文件和最后成功的批次，不保存秘密。

单篇文件包含来源、发布时间、内容修订、摘要、关键事实和原文链接；不同组可对同一文章生成不同侧重点的文件。同一批的路径、内容和摘要值均固定，单纯重试不改生成时间或模型文本。

交付目标从文件包绑定的组配置快照解析；修改组配置对新批次生效，不在重试时悄悄更换既有批次的目的地。

## 仓库接口

`sync_files(RepositorySyncRequest) -> RepositorySyncResult`。

| 输入字段 | 含义 |
| --- | --- |
| `group_id/batch_id/bundle_ref` | 本次交付身份与文件包 |
| `repository/branch/base_path` | GitHub `owner/repo`、目标分支、组归档路径；未指定分支由仓库元信息解析并固定到本批 |
| `credential_ref` | GitHub Token 引用，由运行环境解析 |

输出：`status=updated/unchanged/failed/conflict/unknown`、`commit_sha`、`commit_url`、`changed_paths` 和结构化错误。只有目标分支包含对应文件包后才认定 updated；仅创建 tree 或 commit 对象不算完成。

### GitHub 更新步骤

1. 校验仓库、可写分支和 Token，获取最新 head、tree 与目标目录管理清单。空仓库或不存在的目标分支报告需初始化，不自动猜测分支。
2. 规范化 base_path 与文件路径，拒绝绝对路径、`..` 越界和跨组重叠管理目录。对照清单检查已有文件归属和人工修改；相同内容跳过。
3. 以当前 tree 为 `base_tree` 创建新 tree，只更新本批管理文件；创建以当前 head 为父节点的 commit，最后以 `force=false` 更新分支引用。
4. 若 head 发生变化，重新读取并比较。仅无关路径变化时重新基于最新 tree 提交；管理文件发生冲突则返回 conflict，不覆盖对方修改。
5. 引用更新超时返回 unknown；先读取分支、管理清单及文件摘要值确认本批是否已落地，再决定是否重试。不可盲目追加重复提交。

同一组按序生成和交付批次；失败批次恢复或明确取消前不让后续批次覆盖其索引。不同组写同一分支也需协调并发，并保留远端最新树中的其他文件。

本期优先使用 GitHub Git Database API，一批多文件通过一次分支更新交付。参考：[创建 tree 与 base_tree](https://docs.github.com/en/rest/git/trees)、[创建 commit](https://docs.github.com/en/rest/git/commits)、[更新引用](https://docs.github.com/en/rest/git/refs)。官方要求相关写接口具有仓库 Contents 写权限；分支保护仍然适用。实际客户端版本在实现时锁定。

## 消息接口与恢复

`notify(NotificationRequest) -> NotificationResult`。

- 输入：`group_id`、`batch_id`、Webhook 凭据引用、已确定简报、仓库提交及文章链接。
- 输出：`status=sent/skipped/failed/unknown`、可用的消息标识、错误与重试信息。
- 仓库确认 updated 或 unchanged 后再执行通知。每个组/批次/目标独立记录状态；仓库成功但通知失败时仅补发消息。
- 同一批已发送则 skipped。网络超时且无法核对平台结果时为 unknown；平台没有幂等能力时不宣称严格一次投递。
- Webhook 只是传输入口，成功判断和消息格式需按具体平台实现；首期仅落地一种确定的平台适配。

## 独立能力目录

```text
src/openlore/
├── processing/
│   ├── contracts.py          # 处理输入输出、知识条目、文件包
│   ├── normalize.py          # 内容清洗与来源合并
│   ├── service.py            # 按组编排、缓存与结果校验
│   └── renderers/markdown/   # 文章、简报、索引模板
├── delivery/
│   ├── contracts.py          # 文件同步与通知接口
│   └── service.py            # 按组交付、状态与恢复
└── infrastructure/
    ├── models/<provider>/   # 一个模型提供者一个目录
    ├── github_repository/   # Token 解析接入、API、冲突处理、映射
    └── webhook_notification/ # 首期消息平台，后续按平台独立目录
```

凭据解析与持久存储由应用提供。基建适配器不依赖具体用户组业务；模型不直接拿 GitHub Token 操作仓库，仓库适配器只执行经过校验的文件包。

## 验收重点

验证两个组对同一文章的不同筛选、正文与模型失败、文件稳定路径及完整索引；再验证 GitHub 新增/更新/无变化、管理目录隔离、人工修改与并发提交、分支权限错误、提交超时确认，以及通知独立补发。真实写库和消息验证需要用户提供并配置对应目标与凭据。
