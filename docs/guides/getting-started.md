# 新电脑安装与首次使用

本文按从源码运行介绍，命令使用 macOS/Linux shell；Windows 用户可在 WSL 中按此流程准备环境。

## 1. 准备环境

| 工具                    | 要求                            | 用途                         |
| ----------------------- | ------------------------------- | ---------------------------- |
| Node.js                 | 按项目技术选型使用 24           | 运行后端、构建前端和调用 CLI |
| pnpm                    | 当前 `package.json` 指定 12.0.0 | 安装 workspace 依赖          |
| Python                  | 3.12 或更高                     | Feed 解析、网页正文提取      |
| uv                      | 安装后可执行 `uv --version`     | 管理 Python 环境             |
| Git                     | 可执行 `git --version`          | 获取和更新源码               |
| Codex CLI 或 Gemini CLI | 至少安装并登录一个              | 审核、调研、生成汇报         |

先安装 [Node.js](https://nodejs.org/en/download) 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)。安装项目指定的 pnpm：

```sh
npm install -g pnpm@12.0.0
```

获取项目源码并进入 `openlore` 根目录。下文除特别说明外均在根目录执行。

## 2. 安装项目依赖

```sh
pnpm install
uv python install 3.12
uv sync --project workers/python --python 3.12 --locked
pnpm --filter @openlore/contracts build
```

Python 环境会生成在 `workers/python/.venv`，后端优先使用其中的解释器。无需手动激活虚拟环境；依赖安装完成后再启动后端。共享契约必须先构建，因为前后端从 `packages/contracts/dist` 加载它。

验证采集依赖：

```sh
workers/python/.venv/bin/python -c "import feedparser, trafilatura, jsonschema; print('Python dependencies OK')"
```

## 3. 启动网站

```sh
npm run dev
```

| 组件               | 启动方式                                                 |
| ------------------ | -------------------------------------------------------- |
| 前端               | 自动启动，默认 `http://localhost:5173`，占用时自动换端口 |
| 后端               | 自动启动，默认 `http://127.0.0.1:8767`                   |
| SQLite             | 后端自动初始化，无需独立服务                             |
| 定时调度与队列心跳 | 随后端启动                                               |
| Python 解析        | 采集时自动启动子进程，处理完成退出                       |
| AI CLI             | 本机/SSH 模式按任务调用；Worker 模式需额外启动 Worker    |

打开终端打印的前端地址，保持终端运行。关闭网页不会停止后端；按 `Ctrl+C` 停止开发服务。不要为同一份数据同时启动多个后端。

## 4. 配置 AI 执行器

按 [AI 执行器配置](ai-executors.md) 安装并登录 CLI。网站与 AI 都在当前电脑时，在“系统设置 → AI 执行器”添加执行器，连接方式选“服务端本机”，保存并测试连接。

## 5. 跑通第一条流水线

1. **系统设置**：添加 GitHub 仓库连接，填写仓库、目标分支及有目标仓库内容读写权限的 Token，测试连接。首轮建议使用专门的试用仓库。
2. **来源采集**：启用或添加一个来源，手动触发采集，在“内容池”确认文章已入库。
3. **流水线任务**：创建任务，选择来源、AI 执行器、审核 Skill、归档仓库及路径；首次可关闭深度调研、减小选文数量。
4. 点击“立即运行”，在“运行记录”查看流水线和 AI 调用详情。任务会向所选 GitHub 仓库写入归档文件；有文章被选中且归档成功后，可在“每日精选”查看结果。
5. 如需群汇报，在“系统设置”添加通知通道，再到“汇报推送”配置计划、关联任务和通道。手动发送会真实调用 Webhook。

启动成功只代表网站可用；采集、AI 调用、GitHub 归档和通知要分别验证。

## 数据在哪里

默认业务数据位于 `~/.openlore/`，数据库为 `openlore.db`，凭据保存在 `secrets.json`；可用 `OPENLORE_DATA_DIR` 更改业务数据目录。更换目录会使用另一份工作区数据。

AI 任务工作区默认在执行机 `~/.openlore/executor-workspace`，独立于 `OPENLORE_DATA_DIR`，可在执行器设置中修改。备份业务数据时先停止后端，再复制整个数据目录；其中包含凭据，请限制访问。

## 常见问题

| 现象                           | 处理                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 5173 被占用                    | 打开 Vite 实际打印的地址，例如 5174                                                                         |
| 后端报 `EADDRINUSE`            | 检查是否已有后端运行；复用或停止旧进程，不要重复启动                                                        |
| Python 报缺少模块              | 重跑第 2 步的 `uv sync` 和导入验证，再重启后端                                                              |
| `@openlore/contracts` 无法加载 | 在根目录执行 `pnpm --filter @openlore/contracts build`                                                      |
| AI 测试连接通过但任务失败      | 查[执行器排查表](ai-executors.md#排查问题)和“运行记录”的 AI 调用详情                                        |
| 环境自检正常但功能不可用       | 自检目前仅检查数据目录、数据库入口、Python 路径及执行器配置状态；不代表模型、采集依赖和外部服务全部验证通过 |
