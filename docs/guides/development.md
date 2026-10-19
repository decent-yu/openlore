# 开发者指引

本指南用于修改代码与整站调试。只运行 AI 的用户按[Runner 接入](ai-executors.md)操作，服务器管理员按[部署指引](server-deployment.md)操作。整体边界见[系统架构](../architecture/system-architecture.md)。以下命令从仓库根目录执行，Python 测试除外。

环境分工和后续 `.env` 约定见[本地开发与云端正式运行](collaboration.md)：成员各自本地开发，验收后发布云端正式环境，不另设测试环境。

## 开发启动

准备 Git、Node.js（项目选型为 24）、Python ≥3.12 和 uv；pnpm 版本以根 `package.json` 为准，当前可用 `npm install -g pnpm@12.0.0` 安装。

```sh
pnpm install
uv sync --project workers/python --python 3.12 --locked
pnpm --filter @openlore/contracts build
pnpm dev
```

`npm run dev` 与 `pnpm dev` 调用相同脚本：并行启动 Fastify 后端和 Vite 前端。后端使用 `tsx watch`，前端使用 Vite 热更新。共享契约从 `dist` 导入，修改 `packages/contracts/src` 后需重跑契约构建；需要时重启开发服务。

整站开发命令不会自动启动独立 Runner。要按正式拓扑联调，先构建后在另一终端运行 `node apps/server/dist/cli/index.js worker <配对文件>`，其 `server_url` 指向 `http://127.0.0.1:8767`；只调试模型适配时也可选择 `local`。

分别启动可用 `pnpm dev:server`、`pnpm dev:web`。前端默认 5173，`/api` 固定代理至后端 8767；后端使用 `PORT` 改端口时，也要修改 `apps/web/vite.config.ts` 的代理目标。

开发时如需隔离个人业务数据，在启动前设置：

```sh
export OPENLORE_DATA_DIR="$PWD/.openlore/dev"
pnpm dev
```

该目录不影响 AI 执行工作区；需要隔离 AI 文件时，在执行器设置中另设工作区根目录。真实来源采集和启用的定时计划会随后端运行，调试请使用独立工作区和试用仓库。

## 代码位置与调用边界

| 目录                                                            | 职责                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/web/src/app`                                              | 路由、布局、全局 Provider                                       |
| `apps/web/src/features`                                         | 来源、内容池、流水线、汇报、运行记录和设置页面                  |
| `apps/web/src/lib/api.ts`                                       | 前端 API 客户端                                                 |
| `apps/server/src/cli/index.ts`                                  | `serve`、`doctor`、`worker`、`worker-init`、`execute-once` 入口 |
| `apps/server/src/http`                                          | Fastify、REST、SSE、认证和静态文件托管                          |
| `apps/server/src/modules`                                       | 采集、调度、处理、调研、交付等业务逻辑                          |
| `apps/server/src/infrastructure`                                | SQLite、HTTP、Python、AI CLI、GitHub 等适配                     |
| `packages/contracts/src`                                        | 前后端共享 DTO、Zod 校验及执行协议                              |
| `workers/python/src/openlore_collectors`                        | Feed 解析和正文提取，stdin/stdout JSON 子进程协议               |
| `skills`                                                        | 服务端管理的业务 Skill 包                                       |
| `apps/server/test`、`apps/web/src/test`、`workers/python/tests` | 各端测试                                                        |

主链路：来源采集 → Python 解析 → SQLite 内容池 → 流水线审核/调研 → GitHub 归档 → 研报与汇报。AI 经 `executor_adapter.ts` 分派到本机、Worker 队列或 SSH，执行工作区由 `workspace_runner.ts` 管理。

修改 API 时同步调整契约、服务端路由与前端客户端；外部能力通过适配层接入。Python 负责解析，不直接写业务数据库。

## 数据库与配置

SQLite 使用 `better-sqlite3` 和 Drizzle ORM，开启 WAL、外键及 5 秒锁等待。表定义在 `infrastructure/persistence/sqlite/schema.ts`；**当前实际建表和迁移在 `db.ts` 的 `initDatabase()` 中执行**，不能只改 Drizzle 表定义。启动调度器前先初始化数据库。

| 配置                    | 当前行为                                                          |
| ----------------------- | ----------------------------------------------------------------- |
| `OPENLORE_DATA_DIR`     | 默认 `~/.openlore`，保存数据库、凭据、材料、日志等                |
| `HOST` / `PORT`         | 默认 `127.0.0.1:8767`；非回环监听要求管理令牌                     |
| `OPENLORE_ADMIN_TOKEN`  | 管理端认证；浏览器 Basic 密码使用此值，用户名可填 `openlore`      |
| `OPENLORE_PUBLIC_URL`   | 对外网页地址，用于允许对应跨域来源                                |
| `LOG_LEVEL`             | 默认 `info`                                                       |
| `OPENLORE_WORKER_TOKEN` | 仅 `worker-init` 生成配置时读取；常规 Worker 从配对 JSON 读取令牌 |

当前入口未自动加载 `.env`，需在启动 shell 或进程管理器中传入环境变量。不要提交凭据、配对配置和运行数据。完整备份应停服后复制数据目录，避免遗漏 WAL 中的写入。

## 验证改动

按改动范围运行检查；下列常规测试无需真实 AI 账号或外部写入：

```sh
pnpm --filter @openlore/contracts build
pnpm typecheck
pnpm test
pnpm build
```

只验证单个服务端模块，例如执行器：

```sh
pnpm --filter @openlore/server exec vitest run test/executors.test.ts
```

Python 测试：

```sh
cd workers/python
uv run --locked pytest
```

根目录虽有 `lint` 脚本，当前各包尚未定义对应的 lint 任务，不能把 `pnpm lint` 无报错视为已完成静态规则检查。`test:e2e` 当前按测试名中的 `e2e` 筛选 Vitest 用例，不是浏览器端到端验收命令。

真实 AI 验证需单独进行，会使用账号额度：先构建，阅读 `apps/server/scripts/verify-real-executor.mjs`，再按其要求准备 `OPENLORE_REAL_AI_PROFILE` 与 `OPENLORE_REAL_AI_ARTICLES` 文件。该脚本使用真实 Gemini Worker 和隔离数据库，模拟 GitHub/Webhook；普通测试通过不代表真实 CLI 已接入成功。

## 构建后运行

```sh
pnpm build
node apps/server/dist/cli/index.js serve
```

打开 `http://127.0.0.1:8767`，后端同时托管 `apps/web/dist` 页面，无需再启动 Vite。保留仓库目录结构和 `workers/python/.venv`，运行中的 Python 解析仍依赖这些文件。

`node apps/server/dist/cli/index.js doctor` 可执行基础自检，但会初始化所选数据目录及数据库，且不验证真实模型调用。`service` 尚未实现服务安装，长期运行请自行配置进程管理器。

服务器部署见[管理员指引](server-deployment.md)，Runner 协议见[生命周期](../architecture/local-ai-executors.md)。业务规则见[功能总览](../product/feature/index.md)，技术事实见[技术栈](../architecture/technology-stack.md)。
