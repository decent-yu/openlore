# AI Runner 接入与其他执行方式

OpenLore 调用执行机器上的 Codex CLI 或 Gemini CLI。需要在该机器、运行 OpenLore 执行进程的同一系统用户下安装并登录 CLI；只登录网页或安装桌面应用不能代替 CLI 配置。

## 默认流程：电脑只作为 Runner

已有云端网站时，直接按“安装并登录 CLI → 构建 Worker → 下载配对配置 → 独立启动”的顺序操作。**执行机不运行 `npm run dev`、网站、Python 采集器或数据库。**

当前可用 Runner 命令仍叫 `worker`，还没有独立发布包，需要从源码构建。云端部署请看[管理员指引](server-deployment.md)，整体边界见[系统架构](../architecture/system-architecture.md)。

## 1. 在执行机安装并登录 CLI

任选一个即可。以下安装与登录步骤依据 [Codex 官方文档](https://developers.openai.com/codex/cli/)、[Codex 身份验证](https://developers.openai.com/codex/auth/)和 [Gemini CLI 官方入门](https://geminicli.com/docs/get-started/)。

### Codex CLI

```sh
npm install -g @openai/codex
codex --version
codex login
codex login status
command -v codex
```

按终端提示完成浏览器登录。运行 `codex`，发一条简单请求，确认模型可以返回结果，然后退出。已有模型服务或 Profile 的用户可沿用本机配置；账号和模型权限以实际调用结果为准。

### Gemini CLI

```sh
npm install -g @google/gemini-cli
gemini --version
gemini
```

按提示选择登录方式并完成授权，发一条简单请求，确认有结果后退出。用以下命令查看 CLI 路径：

```sh
command -v gemini
```

建议在页面填写上述命令返回的绝对路径，避免后台进程的 `PATH` 与终端不同。机器换用户、Node 版本或 CLI 安装位置后，应重新核对路径和登录。

## 2. 配对并独立启动 Runner

服务器负责采集、数据库、调度与归档；自己电脑只运行 AI Worker，不需要启动第二个后端，也不需要安装 Python 采集环境。两端使用相同版本的 OpenLore。当前没有协议版本协商，升级时同步更新两端。

1. 在自己电脑准备 Node.js（项目选型为 24）、Git 和项目源码，以及已登录的 AI CLI。
2. 在源码根目录安装项目指定的 pnpm 并准备 Worker 程序：

   ```sh
   npm install -g pnpm@12.0.0
   pnpm install
   pnpm --filter @openlore/server... build
   ```

3. 在网站“系统设置 → AI 执行器”添加执行器，连接方式选“我的电脑 · 常驻 Worker”。CLI、工作区和 Skills 路径均填写**自己电脑**上的路径，保存。
4. 点击“下载配对配置”，在自己电脑保存 JSON。核对 `server_url`：正式部署填写服务器的 HTTPS 地址；本机调试填写 `http://127.0.0.1:8767`。下载时默认使用当前网页地址，开发端口 5173/5174 依赖 Vite 代理，不宜作为长期连接地址。Worker 在另一台电脑时，不能用 `localhost` 指代服务器。
5. 在自己电脑的源码根目录另开终端启动，下面路径替换为实际下载文件：

   ```sh
   chmod 600 /absolute/path/to/openlore-worker.json
   node apps/server/dist/cli/index.js worker /absolute/path/to/openlore-worker.json
   ```

6. 保持终端运行，约 10–15 秒后刷新页面，确认“Worker 在线”，点击“测试连接”，再运行一次流水线。

启动后应能看到 Worker 连接日志；进程持续运行即可，前后端开发服务无需在这台电脑启动。

配对文件包含专用令牌，不要提交到仓库。重新下载配对配置会作废旧令牌并取消该执行器排队或运行中的 AI 任务；需要替换文件并重启旧 Worker。

Worker 主动连接服务器，无需电脑开放入站端口。远程连接要求 HTTPS；本机回环地址允许 HTTP。电脑休眠、断网或关闭 Worker 后会离线，任务可能等待到排队上限后失败。首次跑通后可按操作系统配置 launchd/systemd 常驻；当前 `service` 命令仅是占位，不会自动安装服务。

## 辅助方式：服务端本机执行

仅用于服务端已有 AI CLI，或在同一电脑快速开发调试。完整本机开发步骤见[开发者指引](development.md)。它不经过 Runner 领取流程。

进入“系统设置 → AI 执行器 → 添加执行器”：

| 配置项          | 首次使用建议                                         |
| --------------- | ---------------------------------------------------- |
| 名称            | 如“本机 Codex”                                       |
| Provider        | 与已安装的 CLI 一致                                  |
| CLI 路径        | `command -v codex` 或 `command -v gemini` 的输出     |
| 模型            | 先留空，沿用 CLI 默认模型                            |
| 连接方式        | 服务端本机                                           |
| 工作区根目录    | 留空使用默认目录；自定义时填写执行机可写的绝对路径   |
| Skills 来源     | 同步服务器管理的 Skill 版本                          |
| Codex 配置      | 保持“沿用本机用户配置和模型服务”；Profile 有需要再填 |
| AI 单次执行时限 | 默认 15 分钟；较长调研可调整为 30 分钟               |
| AI 并发数       | 先设为 1                                             |
| 主执行器        | 第一个执行器勾选                                     |

保存后点击“测试连接”。本机模式主要执行 CLI 的 `--version`，通过后仍需跑一次流水线，确认登录、模型和任务输出均正常。在此模式下无需额外启动 Runner。

## 辅助方式：SSH 执行

1. 在远端准备 Node.js、项目依赖与构建产物，并以目标 SSH 用户安装、登录 AI CLI。
2. 在后端机器配置 SSH 密钥认证，先核对远端主机指纹并建立可信的 `known_hosts`，确认无交互 SSH 登录可用。
3. 添加 SSH 执行器，填写主机、用户、端口、**后端机器上的**密钥路径，以及**远端机器上的** Node、`apps/server/dist/cli/index.js`、AI CLI 绝对路径。
4. 保存并测试连接，再运行实际任务。后端通过 SSH 按需执行 `execute-once`，远端无需启动 Worker 或网站。

## Skills 与首次业务验证

首次建议选“同步服务器管理的 Skill 版本”，无需手动安装全局 Skills。项目 `skills/` 和业务数据目录下的 `skills/` 提供服务端 Skill；每次任务复制所需包到独立执行工作区。

如选“读取执行机器上的 Skills 目录”，填写绝对路径，每个 Skill 子目录须含 `SKILL.md`。Worker 上线后上报目录，SSH 通过“测试连接”刷新；在流水线中选择与执行器匹配的审核/调研 Skill。更新文件后刷新目录再运行。

按[首次流水线步骤](getting-started.md#跑通第一条业务流程)验证。在“运行记录”中检查 AI 调用状态、错误、执行目录与产物，不能只以在线状态判断可用性。可添加备用执行器，主执行器调用异常时系统按兜底策略尝试其他可用执行器。

## 排查问题

调用详情默认打开“执行与实时日志”，可在运行中查看工具调用、错误输出和最近输出时间。本机与 SSH 实时回传，Worker 约每 10 秒随续租回传；页面每 2 秒刷新。默认所有阶段统一使用执行器的 15 分钟时限。

若出现 `gemini_policy_unavailable`，表示 Gemini CLI 内部策略检查服务返回 429，不等于你的主模型或整个账号额度耗尽。系统会保留文件读取流程和安全检查，结束本次失败尝试并切换备用执行器；详细原因见每次尝试的 stderr。`invalid_json_schema` 则是结构化输出请求格式问题，不是 CLI 登录问题。

| 现象                           | 处理                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| CLI 找不到或 `ENOENT`          | 在实际执行机检查绝对路径；确认启动进程的系统用户可执行                                                |
| 要求登录、额度不足或模型不可用 | 用同一系统用户直接运行 CLI，完成授权、检查额度及模型配置，再重试                                      |
| 测试连接成功，运行时报未知参数 | CLI 版本与项目调用参数不匹配；核对 CLI 版本、`--help` 和运行记录中的 stderr，调整版本或适配代码后重试 |
| Worker 离线                    | 确认终端仍运行、电脑未休眠、地址可达、CLI 路径有效；查看 Worker 终端错误                              |
| `Worker API 401`               | 令牌失效或配置不匹配；重新配对并替换配置、重启 Worker                                                 |
| Worker API 404 或连到前端      | 检查 `server_url`；本机调试优先直接指向后端 8767                                                      |
| SSH 连接失败                   | 从后端机器检查免交互认证、主机指纹、远端 Node 与 CLI 路径                                             |
| Skill 未就绪或版本不一致       | 检查 Skills 来源；让 Worker 重新上报，或重新测试 SSH，再刷新页面选择 Skill                            |
| 超时或长时间排队               | 区分单次执行时限和排队上限；确认 Worker 在线、CLI 可调用，再调整对应设置                              |
| 后端重启后任务中断             | 重启会将中断流水线标记失败并取消在途 AI 队列任务；在页面重新运行                                      |
