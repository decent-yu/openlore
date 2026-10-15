# 本地常驻服务与 AI 执行架构

本方案提供可实施默认值；功能行为以 [feature 总览](../product/feature/index.md) 为入口。当前为设计，未运行模型任务或搭建服务。

## 本期技术与运行形态

- Node.js + Fastify 提供本地 API，托管 React + shadcn/ui 静态页面；Python 子进程复用采集解析库。版本与语言边界统一见[技术选型](../架构/技术选型.md)。单用户本机运行，不做多人登录或远程部署。
- 一个服务进程维护调度、后台任务和页面，SQLite 开启 WAL 保存业务状态与持久队列；文件放在 `~/.openlore/`，可用 `OPENLORE_DATA_DIR` 改位置。
- 服务默认监听 `127.0.0.1:8767`，单个 Node 主服务进程。每 30 秒检查到期任务；HTTP 抓取并发默认 4，同一来源串行，Python 解析并发默认 2，AI 子进程并发默认 1，仓库按 repo/branch 串行。
- 启动入口设计为 `openlore serve`；`openlore doctor` 检查目录、数据库、Python 环境、解析协议、CLI 与连接；`openlore service install/start/stop` 管理本机常驻运行。macOS 使用当前用户 launchd，Linux 使用 systemd --user，均不使用 root。
- 默认关闭开机启动，用户在初次设置完成后开启。关闭浏览器不停止服务；电脑休眠时无法采集，唤醒后补跑一次当前计划并处理积压，不重放所有错过的时间点。
- 容器不是首期默认部署方式，避免本机 CLI 登录在容器中不可见。使用同一系统用户及设置时检测到的可执行文件绝对路径，不依赖后台服务继承交互 shell 的 PATH。

## 本地目录

```text
~/.openlore/
├── openlore.db                  # 配置、队列、状态、索引和证据关联
├── secrets.json                 # Token/Webhook；仅当前用户可读写，0600
├── blobs/                       # 原始响应与规范正文，按内容摘要存储
├── jobs/<job_id>/               # AI 输入、schema、受控配置与结果
├── bundles/<batch_id>/          # 固定文件包与目标快照
├── logs/                        # 脱敏运行日志
└── backups/                     # 数据库与配置备份
```

Codex/Gemini 自己管理其登录；OpenLore 不读取或输出其认证文件内容。OpenLore 连接秘密不进入 AI 输入和环境；日志、示例导出与仓库文件均不包含秘密。secrets.json 是受文件权限保护的本地存储，不声称提供加密保险库。

每天用 SQLite backup API 生成一致性备份，保留最近 7 份；blobs 按 02 的保留策略清理，未完成任务引用的对象不清除。数据库恢复后重新核对远端 manifest，避免恢复旧状态产生重复提交。

## 页面与关键操作

| 页面 | 操作 |
| --- | --- |
| 设置 `/settings` | 预配置仓库、通知、AI、时区和默认策略；连接测试；常驻服务状态 |
| 来源 `/sources` | 来源说明、采集入口、预览样例、启停、最近成功时间 |
| 采集组 `/groups` | 创建/编辑/复制/暂停组，选择连接与路由，预览运行计划，立即运行 |
| 运行 `/runs` | 当前阶段、数量漏斗、逐条原因、预算、错误、补抓/AI/同步独立重试 |
| 内容库 `/library` | 来源与组过滤、原文/分析/修订对照、重新抓取、选择种子发起研究 |
| 调研 `/research` | 问题、种子、读取范围、进度、证据清单、报告、取消和更新 |

修改操作使用 POST/PATCH，前端校验和服务端校验一致；本地 UI 使用会话/CSRF 校验，跨域请求默认拒绝。通过 SSE 展示运行变化，刷新页面仍可从持久记录恢复。

## 核心实体与唯一性

| 实体 | 关键约束 |
| --- | --- |
| Connection / AIProfile | ID、配置修订、凭据引用、健康状态；不把秘密复制到组 |
| Source / SourceState | 配置修订 + 能力 + 凭据范围隔离续采位置 |
| Group / GroupSource | 组修订；组内 source_id 唯一；关键词、模式、来源首次 coverage_start、连接引用与路由 |
| SourceItem / Article / ArticleRevision | 来源内稳定身份；Article 持久 ID；同一内容 hash 不重复建修订；保留多来源关系 |
| GroupItem | group_id + article_revision + rules_revision；保存 selected/excluded/pending/deferred 和理由 |
| Run / Job | 运行快照；job_key 唯一；阶段、attempt、available_at、租约和父任务 |
| Research | 组、问题、种子版本、模式、预算、已读证据；更新沿用研究 ID |
| Bundle / Delivery | batch_id 固定；目标快照；group/batch/target 唯一，分别记录 GitHub 与消息结果 |

筛选内容所需的组快照包含成员来源及其关键词；来源在不同组出现不会互相覆盖。正文获取可共享，但 SourceItem 的来源关联不能因此丢失。

## 队列与状态机

任务状态：`queued → running → succeeded`，或 `retry_wait / blocked / failed / cancelled`。blocked 用于缺少授权、额度或人工冲突决策；服务继续处理不受影响的任务。

- 来源任务：`discover → persist`；组任务：`refresh_sources_if_stale → select_candidates → fetch_body → assess → analyze → render → sync_git → notify`；研究任务：`plan → fetch_evidence → synthesize → validate → render → sync_git → notify`。组配置在创建运行时固定，候选截止时间在必要刷新之后一次性固定。
- 每个阶段输出先持久化，再推进下一阶段；worker 每 15 秒续租，租约 90 秒。重启回收过期任务，检查其已存输出后从未完成阶段继续。
- 子进程按任务独立进程组启动，记录 PID 与启动身份；取消/超时只终止本服务启动且身份匹配的进程，不杀用户其他 CLI 会话。
- 同组同时点击“运行”或定时器与手动重复触发，返回同一在途运行；不会并行生成两份索引。同一来源扫描和同仓库分支同步也有互斥租约。
- 网络重试依 02；AI 结构修复最多一次，仍失败保留 pending。额度不足按照提供者重试时间暂停，无明确时间则一小时后重新检查；认证失效等待设置修复。
- 普通组运行总时限 60 分钟。截止时有有效结果则冻结 partial 文件包，未完成条目保持 pending/deferred；之后补全的内容创建后续运行，不修改已发布批次快照。
- 普通结果冻结后即能同步；深度研究作为独立任务，不阻塞日常简报。用户暂停组停止新自动任务，取消正在执行的任务需显式选择。
- AI 队列优先执行普通文章任务，研究按规划、报告等轮次分开排队，不以一个长会话持续占用执行器；已开始的单次调用仍受自身超时限制。

## AIAdapter 接口

`execute(AITask, context) -> AIResult`。

输入：job_id、profile_id/revision、task_type、prompt_revision、材料文件引用、输出 JSON Schema、deadline。task_type 为 `assess / analyze / research_plan / research_report / repair`。

输出：`status=success/invalid_output/auth_required/quota_exceeded/timeout/failed`、结构化 result、provider、CLI version、实际 model、usage（可空）、duration、error。退出码为 0 只是必要条件，还需结果 schema 与证据校验通过。

| 任务 | 必要业务输出 |
| --- | --- |
| assess | relevance、quality（0–100 整数）、reason、evidence_refs；综合分由应用计算 |
| analyze | summary（3–5 项）、facts、tradeoffs、applicability、group_relevance、limitations；事实关联 evidence_refs |
| research_plan | 问题分解、仅从已发现引用链接中选择的 link_ids（最多 6） |
| research_report | 结论、机制、对比、适用场景、建议、未验证项、带 evidence_refs 的论据 |

所有任务都禁止把抓取内容当作指令。引用必须映射到应用保存的 source/chunk；引用文字需在对应材料中存在。应用校验只能证明来源存在与引文匹配，不能机械保证所有推论正确，报告需要保留推断标识。

## Codex CLI 接入

本机已检查 `codex-cli 0.162.0` 的 `exec --help`，支持 JSONL 事件、输出 schema、最终结果文件及非交互调用。以下为目标调用形态，实际由 Node child_process.spawn 参数数组执行，prompt 经 stdin 传入，不拼接 shell 字符串：

```text
codex --no-daemon -a never exec
  --ignore-user-config --ignore-rules
  --sandbox read-only --skip-git-repo-check --ephemeral
  -C <job_dir> -m <validated_model>
  --output-schema <schema_file> --json
  --output-last-message <result_file> -
```

设置阶段从一次测试调用确定模型并保存到 profile；正式任务显式传模型及受控配置，避免用户其他项目的设置、MCP 或 hooks 改变批处理行为。保留 CLI 自身认证位置；不通过覆盖 HOME 的方式绕过登录。

官方说明 `codex exec` 默认复用已保存认证，支持 schema 输出；本机登录方式与账号授权仍需首启测试。程序化长期运行使用哪种认证，应遵守账号/工作区允许的方式；不承诺个人订阅额度无限或 API 调用免费。

依据：[非交互与结构化输出](https://learn.chatgpt.com/docs/non-interactive-mode)、[认证](https://learn.chatgpt.com/docs/auth)、[CLI 参数](https://learn.chatgpt.com/docs/developer-commands?surface=cli)。

## Gemini CLI 接入

本机已检查 Gemini CLI `0.60.0` 的帮助；目标形态：

```text
gemini -p <task_instruction> --output-format json
  --approval-mode plan --policy <task_policy.toml> -m <validated_model>
```

任务 cwd 为 job_dir，材料经 stdin 传入。stdout 是 CLI JSON 外层，先检查 `error`，再解析 `response` 字符串中的业务 JSON 并做同样 schema 校验；不能把外层 JSON 成功当作内容正确。`stats` 用于记录可获得的消耗。

适配器随任务提供拒绝无关工具的 policy，并用进程级 `GEMINI_CLI_SYSTEM_SETTINGS_PATH` 注入受控设置，禁用扩展和 MCP；不修改用户全局设置。所有采集与外链扩展由 OpenLore 执行，Gemini 任务不依赖工具授权。预检须证明该版本的策略与无交互输出可用，否则 AIProfile 不可设为 ready。

官方说明无头模式可复用已缓存认证；没有缓存时需配置 API Key 或 Vertex AI。首次登录应由用户在同一 OS 账户下完成；任务遇到认证对话应立即转 blocked，不等待终端输入。

依据：[无头模式](https://geminicli.com/docs/cli/headless/)、[认证](https://geminicli.com/docs/get-started/authentication/)、[配置优先级](https://geminicli.com/docs/reference/configuration/)、[策略引擎](https://geminicli.com/docs/reference/policy-engine/)。

## AI 与研究预算的落实

- 并发 1，job/文章/研究三级 deadline；超时终止该任务进程组并保留证据与失败原因，不无限 retry。
- 输入分块规则在 03；research_report 只使用与问题相关的证据片段，材料预算默认 80,000 字符，并在来源清单记录哪些片段实际进入模型。
- 研究 URL 来自种子正文中的真实链接；应用校验公开 HTTP(S)、域名和预算后获取，默认一次扩展 6 页、深度 1。遇到内网/本机地址、登录页或不支持媒体返回不可读，不将运行权限交给页面内容。
- 完成 1–3 篇种子阅读后，最多 1 次规划、1 次报告、1 次修复；预算耗尽返回带 gaps 的部分报告。通用全网搜索不在本期实现范围，不影响基于原文引用的深度研究。
- 普通任务无任何模型可用时保留正文，等待 profile 恢复；不切换到未知供应商或产生新的付费订阅。

## 独立目录

```text
apps/server/src/
├── http/                        # API、SSE、请求校验与静态页面托管
├── modules/settings/            # 仓库/通知/AI 连接与凭据引用
├── modules/scheduler/           # 到期计划与去重调度
├── modules/jobs/                # SQLite 队列、租约、恢复与取消
├── modules/collection/          # 统一采集协议和编排
├── modules/processing/          # 分组筛选、AI 任务、文件渲染
├── modules/research/            # 问题规划、引用扩展和证据核验
├── modules/delivery/            # 文件包、路由与同步状态
└── infrastructure/
    ├── collectors/web_feed/     # Node 适配器，调用 Python 解析
    ├── collectors/web_page/     # Node 适配器，调用 Python 提取
    ├── python/                  # 子进程协议与生命周期
    ├── ai/codex_cli/
    ├── ai/gemini_cli/
    ├── repositories/github/
    ├── notifications/generic_webhook/
    ├── persistence/sqlite/
    └── secrets/local_file/
```

前端位于 `apps/web/`，Python 解析位于 `workers/python/`，共享契约位于 `packages/contracts/`。同一种能力的新供应商增加目录和注册项，不修改处理/交付业务协议。初期只有单机持久队列；现有协议仍允许以后把 worker 独立部署。
