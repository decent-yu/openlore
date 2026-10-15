# 按组处理、文件包与仓库同步接口

行为以 [03](../product/feature/03-content-processing.md)、[04](../product/feature/04-delivery-and-git-archive.md) 为准；运行环境与 AIAdapter 见[本地服务设计](local-service-and-ai.md)。此文是统一数据与事务约定。

## 配置连接与运行快照

- RepositoryConnection：`id, revision, owner, repo, default_branch, credential_ref, state`；NotificationConnection：`id, revision, url_secret_ref, protocol=generic_json, state`。
- GroupRoute：`repository_connection_id, base_path, notification_connection_id?`；组内不保存仓库地址和 Token。
- RunSnapshot：组配置/规则修订、选中来源、来源关键词、AIProfile 修订、解析完成的仓库 owner/repo/branch/path、通知引用、截止时间、预算。
- 凭据值运行时从秘密存储读取，快照仅保存引用。撤销凭据始终优先于快照；配置改变不让旧任务改投新目标。
- `/docs/agent-leaning` 规范化为 `docs/agent-leaning`；拒绝空根路径、路径穿越、符号链接跳出和 repo/branch 内跨组重叠目录。

## 稳定身份与处理接口

Article 使用持久化 ID，URL别名与多个 SourceItem 指向该 ID。内容 hash 只代表修订；标题变化不更换文件目录。跨来源合并不是文本语义聚类，首期按确认 URL 归并，无法确认则保留独立条目。

`process(ProcessingRequest) -> ProcessingResult`：

| 请求字段 | 语义 |
| --- | --- |
| run_id/group_id/group_revision | 当前运行与冻结的组规则 |
| items | `{article_id, revision, content_ref, source_ids}[]` |
| focus/preferences/source_rules | 组关注描述、偏好及逐来源关键词/排除词/匹配模式 |
| ai_profile_ref/prompt_revision | 可复用 AI 执行配置与提示词版本 |
| budget | candidates_limit、selected_limit、deadline |

| 结果字段 | 语义 |
| --- | --- |
| status | success/partial/failed |
| decisions | article_id、revision、selected/excluded/pending/deferred、reason、matched_source_ids、scores |
| entries | 原文引用、结构化分析、元信息与证据关联 |
| bundle_ref/batch_id | 有有效内容时返回已保存的固定文件包；没有变化时为空 |
| errors | 关联任务与条目、是否可重试及下一动作 |

处理缓存键至少包含文章修订、组规则修订、AIProfile 修订与提示词修订。per-group 已交付记录与处理缓存分开；同一文章可被另一组首次发布。

## ArtifactBundle

字段：`group_id, run_id, batch_id, snapshot_ref, kind(collection|research|resync), entries, files, base_manifest_ref`。

files 元素：`path, content, sha256, media_type, expected_remote_sha256?`。路径相对组路由，内容 UTF-8；文件包渲染后不可变。research 包包含 report 与 sources 清单，collection 包包含文章文件与简报，resync 包只复制已有成果到新路由，不重新调用 AI。

- 文章：`articles/<article_id>/source.md`、`analysis.md`、`metadata.json`。
- 简报：`digests/YYYY/MM/<local_date_time>_<run_id>.md`，时间来自运行创建时并固定。
- 调研：`research/<research_id>-<stable_slug>/report.md`、`sources.json`；slug 在创建时固定。
- 公共产物：`README.md`、`.openlore/manifest.json`。

README 使用本组已归档记录加当前变更生成。manifest 保存 group_id、路由身份、最近批次、所有系统管理文件的内容摘要和实体关联；排除其自身摘要，避免递归。每个文件的 expected_remote_sha256 来自上次已确认同步结果，用于检查人工修改。

没有业务变化时不改元信息的处理时间，不生成新简报或文件包。部分成功一旦发布，失败内容后续成功使用新 run/batch；不改历史简报来伪装当时全部成功。

## GitHub 同步接口

`sync_files({bundle_ref, snapshot_ref, credential_ref}) -> RepositorySyncResult`。

结果：`status=updated/unchanged/blocked/conflict/unknown/failed, commit_sha?, commit_url?, changed_paths[], errors[]`。

1. 按 owner/repo/branch 获取租约，确认连接未撤销，读取实际 head、完整目标目录树及 manifest；API 返回截断时继续获取子树，不能将缺失列表误当作删除。
2. 校验文件路径和归属。只有本组管理文件可更新；新文件路径已被非管理内容占用则冲突。无变化返回 unchanged。
3. 为变化文件创建 blob/tree，使用最新 `base_tree` 保留无关内容，创建父节点为当前 head 的 commit，再以 `force=false` 更新 ref。
4. ref 因并发前进失败时重新读树并比较；无关改动可重试最多三次，管理文件发生变化返回 conflict。
5. ref 更新超时为 unknown，读取目标分支的 manifest.batch_id 与文件摘要核对。文件包已生效则记成功，不重复创建提交；不能确认时保持待核实。
6. 成功后事务性更新本地已交付索引、manifest 和提交标识，再排队通知。若进程在远端成功后崩溃，恢复时通过第 5 步补齐本地状态。

冲突操作：保留远端时将该文件标记为人工管理并从自动更新集合排除，后续渲染尊重该锁定，其他管理文件仍可更新；采用生成版前按用户已查看的远端版本再次检查；指定新路径须重新通过路径与归属校验。显式冲突决策创建新 run/batch，取消原未发布包并保留原证据；不能修改已交付文件包或对变化中的远端执行盲目强推。

官方依据：[Git trees/base_tree](https://docs.github.com/en/rest/git/trees)、[Git commits](https://docs.github.com/en/rest/git/commits)、[Git references](https://docs.github.com/en/rest/git/refs)。应用所需 Contents 写权限不取代仓库分支规则。

## 通知接口

`notify({event_id, snapshot_ref, summary, counts, commit_url, document_path}) -> NotificationResult`。

输出：`sent/skipped/failed/unknown`、平台响应信息和错误；通用 JSON 协议按 HTTP 2xx 判定，超时保留 unknown。事件类型及 payload 以 [04](../product/feature/04-delivery-and-git-archive.md) 为准。

Delivery 唯一键为 `group_id + batch_id + target_kind`；Git 与通知状态独立。通知失败不阻塞后续组采集或仓库更新，但同一事件不同时启动两个发送任务。无通知连接时记录 skipped。

## 输入输出验证

请求使用严格 schema，未知关键字段报错；模型 JSON 二次解析后验证枚举、数值范围与证据引用。文件包验证路径、摘要和相对链接；manifest 与已交付内容必须一致；快照中不得包含实际 Token/Webhook 值。

契约测试覆盖固定输入的候选与入选计数、两个组的隔离、代码/图片引用保留、长文部分失败、AI 非法 JSON、文件 9→0→更新→研究的变化、远端并发/超时和通知单独恢复。
