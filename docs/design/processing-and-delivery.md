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
| ai_profile_ref/skill_ref/skill_revision/prompt_revision | 可复用 AI 执行配置与提示词版本 |
| budget | candidates_limit、selected_limit、deadline |

| 结果字段 | 语义 |
| --- | --- |
| status | success/partial/failed |
| decisions | article_id、revision、selected/excluded/pending/deferred、reason、matched_source_ids、scores |
| entries | 原文引用、结构化分析、元信息与证据关联 |
| bundle_ref/batch_id | 有有效内容时返回已保存的固定文件包；没有变化时为空 |
| errors | 关联任务与条目、是否可重试及下一动作 |

处理缓存键至少包含文章修订、组规则修订、AIProfile 修订与提示词修订。per-group 已交付记录与处理缓存分开；同一文章可被另一组首次发布。

## 阅读目录与 ArtifactBundle

一个 collection_id 对应一个 `YYYYMMDD-NN` 采集批次；同批文章、图片、简报和后续调研都留在这里。一个 batch_id 对应一次不可变的**交付事件**，文章首次发布、图片修复、调研补齐可以有不同 batch_id，但不会因此创建另一个日期目录。

ArtifactBundle：`group_id, run_id, collection_id, batch_id, snapshot_ref, kind(collection|research|digest|resync|repair), entries, assets, files, base_manifest_ref`。

files 元素：`path, content_ref, encoding(utf-8|binary), sha256, media_type, expected_remote_sha256?`。内容保存在受控 blob store，由 content_ref 引用；文本以 UTF-8 读取，图片按原始字节读取。不可变包与 JSON 元信息不内嵌大块图片 Base64。

- 文章：`<date_seq>/<order>-<slug>/article.md`。
- 逐篇研究：`<date_seq>/<order>-<slug>/research.md`，只能绑定一个主 article_id；补充参考不算第二个主文章。
- 配图：该文章目录的 `assets/<semantic>-<hash12>.<ext>`；同字节复用，不同内容用不同路径，hash12 冲突时扩展完整摘要。
- 批次导航和可选简报：`<date_seq>/README.md`、`<date_seq>/digest.md`。
- 路由导航与管理清单：`README.md`、`.openlore/manifest.json`。

初次归档在事务中固定 group/date_sequence/order/slug/article_id 映射。此后修改标题不改路径；文章更新沿原目录，当前采集批次导航引用已有位置。调研补齐复用原 collection_id，渲染 article.md 的关联入口与导航；文件尚未存在时只显示排队状态，不输出断链。

manifest 保存 group、article_locations、collection_locations、已确认的交付批次及 managed_files（含图片的 SHA-256/类型/大小），不保存自身摘要。阅读目录不生成元信息侧车文件，评分和详细证据状态保存在本地。

同步前校验：路径属于该组、图片引用均为本地存在文件、文本与图片 hash 正确、逐篇研究关联唯一、简报/研究符合配置快照。文档只引用自己的 assets（批次简报只链接文章，不嵌图）；图片获取不全的文章不发布，其他成功文章可组成 partial 包。

用户开启研究后，按每篇入选文章创建独立任务。发布包冻结后不等待研究；完成一个任务派生新的 research 交付事件。digest 同理可稍后补齐；开关关闭不建对应任务。相同事件重试严格复用路径与内容。

本期默认布局在 [04](../product/feature/04-delivery-and-git-archive.md) 唯一维护；skills 输出标题与内容建议，目录分配和增量映射由应用决定。

## GitHub 同步接口

`sync_files({bundle_ref, snapshot_ref, credential_ref}) -> RepositorySyncResult`。

结果：`status=updated/unchanged/blocked/conflict/unknown/failed, commit_sha?, commit_url?, changed_paths[], errors[]`。

1. 按 owner/repo/branch 获取租约，确认连接未撤销，读取实际 head、完整目标目录树及 manifest；API 返回截断时继续获取子树，不能将缺失列表误当作删除。
2. 校验文件路径和归属。只有本组管理文件可更新；新文件路径已被非管理内容占用则冲突。无变化返回 unchanged。
3. 为文本创建 UTF-8 blob、图片创建 Base64 编码的 binary blob，再按 blob SHA 创建 tree，使用最新 `base_tree` 保留无关内容，创建父节点为当前 head 的 commit，再以 `force=false` 更新 ref。
4. ref 因并发前进失败时重新读树并比较；无关改动可重试最多三次，管理文件发生变化返回 conflict。
5. ref 更新超时为 unknown，读取目标分支的 manifest 中的交付 batch_id 与文件摘要核对。文件包已生效则记成功，不重复创建提交；不能确认时保持待核实。
6. 成功后事务性更新本地已交付索引、manifest 和提交标识，再排队通知。若进程在远端成功后崩溃，恢复时通过第 5 步补齐本地状态。

冲突操作：保留远端时将该文件标记为人工管理并从自动更新集合排除，后续渲染尊重该锁定，其他管理文件仍可更新；采用生成版前按用户已查看的远端版本再次检查；指定新路径须重新通过路径与归属校验。显式冲突决策创建新 run/batch，取消原未发布包并保留原证据；不能修改已交付文件包或对变化中的远端执行盲目强推。

官方依据：[Git blobs 与 Base64](https://docs.github.com/en/rest/git/blobs)、[Git trees/base_tree](https://docs.github.com/en/rest/git/trees)、[Git commits](https://docs.github.com/en/rest/git/commits)、[Git references](https://docs.github.com/en/rest/git/refs)。应用所需 Contents 写权限不取代仓库分支规则。

## 通知接口

`notify({event_id, snapshot_ref, summary, counts, commit_url, document_path}) -> NotificationResult`。

输出：`sent/skipped/failed/unknown`、平台响应信息和错误；通用 JSON 协议按 HTTP 2xx 判定，超时保留 unknown。事件类型及 payload 以 [04](../product/feature/04-delivery-and-git-archive.md) 为准。

Delivery 唯一键为 `group_id + batch_id + target_kind`；Git 与通知状态独立。通知失败不阻塞后续组采集或仓库更新，但同一事件不同时启动两个发送任务。无通知连接时记录 skipped。

## 输入输出验证

请求使用严格 schema，未知关键字段报错；模型 JSON 二次解析后验证枚举、数值范围与证据引用。文件包验证路径、摘要和相对链接；manifest 与已交付内容必须一致；快照中不得包含实际 Token/Webhook 值。

契约测试覆盖固定输入的候选与入选计数、两个组的隔离、本地图片完整性、文本/二进制 blob、长文部分失败、AI 非法 JSON、四种产物开关组合、日期批次不撞号、更新/研究沿原文章目录、远端并发/超时和通知单独恢复。
