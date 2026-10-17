# 技术栈与实现边界

核对日期：2026-10-17。本文描述当前源码；整体部署和待实现设计以[系统架构](system-architecture.md)为准，命令见[开发者指引](../guides/development.md)。

## 实际依赖

| 层         | 当前选型                                                         | 职责                                             |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| Web        | React 19、Vite 6、TypeScript、React Router 7                     | 云端网站与开发期页面服务                         |
| UI         | Radix 组件、Tailwind CSS 4、Lucide                               | 仓库维护 `components/ui` 源码                    |
| 数据与表单 | TanStack Query 5、React Hook Form、Zod 3                         | 服务端数据缓存、表单和共享校验                   |
| 控制服务   | Node.js、Fastify 5、TypeScript                                   | API、调度、任务编排、结果和交付                  |
| 状态存储   | SQLite WAL、better-sqlite3 11、Drizzle ORM 0.40                  | 单个控制实例的业务状态与 AI 队列                 |
| 采集解析   | Python ≥3.12、uv、feedparser、Trafilatura                        | 仅控制服务需要的解析子进程                       |
| AI Runner  | Node.js、独立 Worker 循环、Codex/Gemini CLI                      | 执行机主动领任务，调用模型并回传                 |
| 通信       | REST JSON、SSE、子进程 stdin/stdout JSON                         | Runner 使用出站 HTTP(S)；SSE 服务于网页状态通知  |
| 工程与验证 | pnpm workspace、ESM、TypeScript strict、Prettier、Vitest、pytest | ESLint、浏览器端到端测试及 CI 流水线尚未配置完成 |

版本以各包 `package.json`、`pnpm-workspace.yaml` 和 `workers/python/pyproject.toml` 为准。技术选型采用 Node 24；仓库尚未通过 `engines` 或版本文件强制固定 Node 版本。当前 Runner 与服务端共用同仓构建产物，独立运行已经可用，独立发布制品待实现。

## 控制服务

- `apps/server/src/cli/index.ts serve` 初始化数据库、默认来源、队列心跳和调度器，再监听 API。生产构建同时托管 `apps/web/dist`。
- `http/routes` 做协议转换；`modules` 负责来源、流水线、报告和交付；`infrastructure` 适配存储、网络、Python、AI CLI 和外部服务。
- `schema.ts` 声明 Drizzle 表，**`db.ts/initDatabase()` 实际执行建表与迁移**。已有 drizzle-kit 依赖，但当前没有由它执行的版本化迁移工作流。
- SQLite 启用 WAL、外键及 5000ms 锁等待。Runner 只调用 API，不读取或写入这份数据库。当前不支持多个控制服务共享数据目录并发运行。
- 流水线以后台异步函数推进并保存运行结果，AI Worker 请求保存在 `ai_jobs`。持久保存队列不等于业务执行可跨重启自动恢复，重启行为见[生命周期](local-ai-executors.md)。

## Runner 与其他执行方式

- `worker` 分支只加载执行循环、工作区程序与共享契约；不启动 Fastify、调度器或业务数据库。配置和程序仍位于 `apps/server`，这是分发耦合，不是必须运行服务端。
- `workspace_runner.ts` 准备任务目录、Skill 包、输入和输出约束；执行 Codex/Gemini 子进程，收集结果与产物。
- `local` 直接在控制服务机器调用 CLI；`ssh` 从控制服务发起远端执行。两者是辅助拓扑，用户电脑接入主线为常驻 Runner。
- Skill 与产物有路径、哈希和体积校验。工作区不等于操作系统沙箱，模型工具权限取决于 CLI；不要把执行机的无关敏感文件当成隔离区内数据。

## Python 边界

控制服务先抓取 Feed/HTML，再以 `shell: false` 启动 `python -m openlore_collectors`。stdin 传请求 JSON，stdout 返回结果 JSON，日志走 stderr；解析完成退出。优先使用仓库 `workers/python/.venv/bin/python`，否则回退 `python3`。

当前解析超时默认 30 秒，stdout 上限 16MiB；Python 协议使用项目自有数据结构，Node 检查响应 JSON 与协议版本。尚未实现从 Zod 自动生成 JSON Schema 并分发给 Python 的契约流水线。当前 Python 子进程继承控制服务环境；环境白名单、完整响应校验和统一进程组取消需要补齐，不能写成已完成。

## API、认证与通知

- API 前缀 `/api/v1`；共享契约在 `packages/contracts/src`。部分接口使用 Zod 校验，尚不能宣称所有请求/响应都经过统一边界校验。
- 设置 `OPENLORE_ADMIN_TOKEN` 时，管理端接受 Bearer 或 HTTP Basic；网页 Basic 密码为该令牌。当前没有基于 Cookie 的管理会话、CSRF token 或完整 Host 白名单机制。
- Worker API 使用对应执行器的专用 Bearer 令牌。公网部署要求 HTTPS；控制服务非回环监听时要求管理令牌。
- CORS 允许本机来源及 `OPENLORE_PUBLIC_URL`。SSE 通知网页，部分页面轮询刷新；数据库记录是查询依据，SSE 不负责 Runner 的可靠任务投递。
- 来源下载由 `SafeHttpClient` 检查地址和重定向。GitHub 与 Webhook 写入均在控制服务；平台业务返回码和失败信息进入交付记录。

## 工程与验证状态

`packages/contracts` 通过 `dist` 导入，首次启动与修改契约后需构建。根目录 `lint` 尚无包级任务；`test:e2e` 只按名称筛选 Vitest 用例；真实 AI 必须单独验收。测试命令与构建运行只维护在[开发者指引](../guides/development.md)。
