# AI Runner 协议与生命周期

本文记录当前 `worker` 的实现，部署角色统称 Runner。系统拓扑见[整体架构与 SVG](system-architecture.md)，安装配对见[操作指引](../guides/ai-executors.md)。

## 独立启动边界

`cli/index.ts` 仅在 `serve` 分支动态导入控制服务、数据库和调度模块。`worker` 分支运行 `modules/executors/worker.ts`，经 HTTPS 连接已有控制服务；不监听网站端口、不初始化业务数据库、不运行采集器。

当前共享的是源码包和构建依赖，尚无独立 Runner 发行包。`local` 和 `ssh` 调用同一个工作区执行程序，但不经过 Worker 领取协议。

## 配对与身份

云端为 `ai_profiles` 生成随机专用令牌，仅保存 SHA-256 哈希；配对 JSON 保存 `server_url`、`profile_id`、`token`、`name`。可选 `cli_path` 和 `overrides` 覆盖执行机配置。远程 URL 要求 HTTPS，回环地址允许 HTTP。

当前令牌长期有效，直到重新配对或删除配置。重新配对会清除在线时间、替换令牌哈希，并取消该配置排队与运行中的 AI 任务。它还不是“一次性注册码换设备证书”的设备注册协议；管理令牌与 Worker 令牌不能混用。

## HTTP 交互

统一前缀 `/api/v1/worker/:id`，每次校验对应配置的 Bearer 令牌。

| 接口                     | 调用者 | 行为                                                   |
| ------------------------ | ------ | ------------------------------------------------------ |
| `GET /configuration`     | Runner | 获取模型提供方、CLI 路径及执行配置                     |
| `POST /heartbeat`        | Runner | 报告名称和本地 Skill 清单                              |
| `POST /claim`            | Runner | 原子领取该配置队列中的一个任务，受并发上限约束         |
| `POST /jobs/:job/renew`  | Runner | 续租并确认任务仍有效                                   |
| `POST /jobs/:job/result` | Runner | 提交结构化结果、诊断、产物；过期或不匹配的租约返回 409 |

Runner 空闲循环约 2 秒一次，每约 10 秒更新配置和心跳；单请求网络超时为 15 秒。没有任务时返回空结果，当前不是长轮询。页面以最近 45 秒内心跳判断在线；在线仅代表通信及 CLI `--version` 检查通过，不代表模型登录或额度有效。

## 排队、执行与结果

- `ai_jobs` 保存请求、`profile_id`、状态、租约、尝试次数、结果和 deadline。
- 状态为 `queued → running → completed`；`completed` 表示结果已经回传，AI 业务成功与否另看 `ExecutionResult.status`。取消、过期和领取失败还有 `cancelled`、`expired`、`failed` 终态。
- 领取时授予 60 秒租约；执行期间约每 10 秒续租。失去有效租约立即请求终止 AI 进程；续租网络持续失败超过约 40 秒也终止。
- 领取逻辑将过期租约重新入队，达到三次领取尝试后失败。回传时再次核验配置、租约、任务状态和期限，拒收旧执行结果。可能出现重复执行，但不能接受过期结果覆盖有效结果。
- 云端当前以每 500ms 查询结果的内存协程等待；排队上限单独计算，总 deadline 为入队时间加排队上限和执行上限。AI CLI 自身还有执行机上的单次超时。
- 产物和诊断随最终结果 JSON 回传；目前没有增量日志、分块产物上传或本地持久回传队列。网络失败时回传最多尝试五次，耗尽后不能保证产物送达。

## 故障语义

| 场景                     | 当前行为                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Runner 尚未上线          | 云端等待任务被领取，达到排队上限后失败；不回退到浏览器执行                         |
| 执行机断网、休眠或退出   | 停止心跳；租约失效后可重领，仍受尝试次数与 deadline 限制                           |
| 控制服务重启             | `serve` 启动时把在途 AI 任务取消、运行中流水线标记失败，调用日志标记中断；需要重跑 |
| 结果晚到或重复回传       | 无有效租约则拒收，不推进业务                                                       |
| Worker 令牌失效          | 停止连接并提示重新配对                                                             |
| 重新配对或服务端取消租约 | Runner 在下一次续租发现无效后终止，传播不是瞬时完成                                |

当前没有完整的用户取消、跨重启恢复与恰好一次交付协议。改进顺序见[架构差距与验收](system-architecture.md#交付顺序与验收)。

## 工作区与材料

每个 AI 请求独立创建 `<workspace_root>/jobs/job-*/`，包含 `.agents/skills/`、`input/article.md`、`output/`、`prompt.txt`、`manifest.json` 等。Skill 包按哈希和路径校验，不安装到全局目录。

同步模式传入服务器管理的 Skill 版本；本地模式由执行机读取配置目录，并检查已选版本。默认保留完成目录 7 天，清理由后续任务启动时触发；不是独立定时清理服务。

AI CLI 环境移除 `OPENLORE_*`，沿用执行机的模型授权与其他用户环境；这不等于完整环境隔离。任务目录是文件组织边界，不是操作系统隔离。控制服务负责保存校验后的结果与执行日志；执行机不需要 GitHub 或群通知凭据。

## 实现与验证入口

- 入口：`apps/server/src/cli/index.ts`。
- 领取与执行：`modules/executors/worker.ts`、`infrastructure/ai/workspace_runner.ts`。
- 身份与队列：`modules/executors/service.ts`、`queue.ts`、`http/routes/executors.ts`。
- 验证：`apps/server/test/executors.test.ts` 覆盖独立进程、实际 HTTP 领取回传、SSH 入口、鉴权与租约。2026-10-17 核查时 9 项通过，CLI 使用测试替身，未调用付费模型。
