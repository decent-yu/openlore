# 云端控制服务部署

适用于管理网站、采集、调度和业务数据的常驻机器。只接入 AI 的电脑请看[Runner 指引](ai-executors.md)。以下为 macOS/Linux shell 命令，均从仓库根目录执行。

## 1. 准备环境与依赖

准备 Git、项目选型的 Node.js 24、Python ≥3.12，以及 [uv](https://docs.astral.sh/uv/getting-started/installation/)。安装当前项目指定的 pnpm：

```sh
npm install -g pnpm@12.0.0
pnpm install
uv python install 3.12
uv sync --project workers/python --python 3.12 --locked
pnpm build
workers/python/.venv/bin/python -c "import feedparser, trafilatura, jsonschema; print('Python dependencies OK')"
```

服务器通过 Runner 执行 AI 时无需安装或登录 AI CLI。Python 依赖要在启动前准备好；后端按需启动解析子进程，无需手动常驻 Python 服务。

## 2. 配置与启动

先创建运行用户可写的业务数据目录。下列数据目录和域名按实际情况修改，管理令牌替换为独立随机值：

```sh
export OPENLORE_DATA_DIR=/var/lib/openlore
export OPENLORE_PUBLIC_URL=https://knowledge.example.com
export OPENLORE_ADMIN_TOKEN='替换为独立随机管理令牌'
HOST=127.0.0.1 PORT=8767 node apps/server/dist/cli/index.js serve
```

前置 HTTPS 反向代理将网站和 `/api` 一起转发到 `127.0.0.1:8767`，并正确转发认证头、支持 SSE。浏览器 Basic 用户名可填 `openlore`，密码为管理令牌。若需直接监听非回环网卡，必须保持管理令牌配置。

后端同时提供构建后的网页、API、调度与 SQLite，不需要生产 Vite，也不需要 `npm run dev`。仅运行一个控制服务实例，保留仓库目录结构、`apps/web/dist` 和 `workers/python/.venv`。当前不会自动加载 `.env`，由 shell 或进程管理器注入环境变量。

长期运行可自行配置 systemd/launchd 等进程管理器。当前 `service` 命令尚未实现安装功能。控制服务重启会中断在途流水线，维护前避免启动新任务，重启后核查运行记录并按需重跑。

## 3. 接入与验收

1. 打开 HTTPS 网站，检查页面和 API 可访问。
2. 在网站创建 Worker 执行器，按[Runner 指引](ai-executors.md)接入自己的电脑；配对地址填写服务器 HTTPS 地址。
3. 按[首次业务流程](getting-started.md#跑通第一条业务流程)依次验证来源采集、AI 调用、GitHub 归档和汇报。

## 数据、备份与排查

业务数据默认 `~/.openlore`，或使用指定的 `OPENLORE_DATA_DIR`。`openlore.db` 保存业务状态和队列；`secrets.json` 保存外部交付凭据；材料、产物等保存在该目录其他子目录。备份时先停控制服务，再复制整个目录并限制访问。

AI 任务目录在执行机上，默认 `~/.openlore/executor-workspace`，由执行器配置控制，不随服务器 `OPENLORE_DATA_DIR` 改变。

| 现象                     | 处理                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| 8767 被占用              | 检查是否已有控制服务，避免同目录重复运行                           |
| Python 缺少模块          | 重跑 uv 安装和导入验证，再重启控制服务                             |
| 构建后只有 API，没有网页 | 确认 `pnpm build` 成功且 `apps/web/dist` 存在                      |
| 管理页面 401             | 检查 Basic 密码与管理令牌、代理认证头                              |
| Runner 连不上            | 检查 HTTPS、配对 URL、Worker 专用令牌及执行机终端日志              |
| 环境自检正常但业务失败   | 自检只检查部分路径和配置状态；分别验证采集依赖、模型授权与外部交付 |
