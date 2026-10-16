# 服务器网站与本机 AI 执行器

网站、来源采集、内容池、流水线编排、GitHub 归档和群推送运行在服务器；AI 阶段可以由服务端本机、常驻 Worker 或 SSH 执行。所有方式复用同一套独立工作区执行程序。

## 服务器

```sh
pnpm install
pnpm -r build
export OPENLORE_DATA_DIR=/var/lib/openlore
export OPENLORE_PUBLIC_URL=https://knowledge.example.com
export OPENLORE_ADMIN_TOKEN='使用独立的随机管理令牌'
HOST=0.0.0.0 PORT=8767 node apps/server/dist/cli/index.js serve
```

通过 HTTPS 反向代理访问。浏览器使用 HTTP Basic 登录，用户名可填 `openlore`，密码为管理令牌。Worker 使用独立的执行器令牌，不使用管理令牌。`/api/v1/worker/:id/*` 只允许对应执行器领取与回传自己的任务。

服务器与执行机应部署相同版本 OpenLore。Worker 不需要启动网站，也不会打开或共享服务器数据库。

## 常驻本机 Worker

1. 系统设置 → AI 执行器，连接方式选“我的电脑 · 常驻 Worker”。
2. 配置本机 CLI 路径、工作区、Skills 来源、执行超时、离线等待、文件保留时间和并发数。
3. 保存后点击“下载配对配置”，将 JSON 保存到电脑上。文件包含专用令牌，请限制文件读取权限。
4. 在电脑安装本项目依赖、完成构建，并运行：

```sh
chmod 600 /path/to/openlore-worker.json
node apps/server/dist/cli/index.js worker /path/to/openlore-worker.json
```

配对文件格式：

```json
{
  "server_url": "https://knowledge.example.com",
  "profile_id": "ai_xxx",
  "token": "界面生成的执行器专用令牌",
  "name": "我的常驻电脑"
}
```

可选 `cli_path` 与 `overrides` 用于固定本机配置（例如 `workspace_root`、`skills_directory`），优先于服务器配置。默认通过服务器配置管理。也可使用 `OPENLORE_WORKER_TOKEN` 环境变量配合 `worker-init <文件> <服务器URL> <执行器ID>` 生成权限为 0600 的文件。

Worker 每 10 秒报告在线状态，主动领取任务；不需要电脑开放入站端口。任务运行中续租，失联后终止本次执行，过期结果不能覆盖新任务结果。执行器离线时任务排队，超过配置的等待期限会明确失败。服务端重启会将中断任务标记失败，需要重新运行，不会一直显示执行中。

常驻运行可交给 macOS launchd 或 Linux systemd。首次接入先在终端确认正常，再按实际可执行路径安装服务。

## SSH

选择 SSH，填写：主机、用户、端口、服务器上的密钥文件路径、远端 Node 路径、远端 `apps/server/dist/cli/index.js` 路径。服务器必须能够连接执行机。

使用 SSH 的非交互密钥认证和严格主机指纹检查；先在服务器完成可信的 known_hosts 配置。测试连接会检查远端 CLI 并刷新远端 Skills 目录。执行通过标准输入传输 JSON，复用 `execute-once` 程序；任务材料不会拼接到 shell 命令中。

## Skills 与工作区

两种来源：

- **同步服务器版本**：从服务器托管的 Skill 包复制本次指定版本。
- **执行机本地目录**：目录下每个子目录包含 `SKILL.md`。Worker 上报目录清单；SSH 点击测试连接刷新清单。执行前校验文件内容哈希，不一致时要求刷新。

每次执行目录：

```text
<workspace_root>/jobs/job-随机标识/
├── .agents/skills/<skill-name>/
├── input/article.md
├── output/
├── prompt.txt
├── manifest.json
└── events.log
```

不安装到全局 Skills 目录。复制完整 Skill 包，校验路径与哈希，不接受路径穿越或包内符号链接。默认保留已完成任务目录 7 天。

实际 Prompt 使用 `$skill-name` 与明确的工作区 Skill 路径，再附任务定位和阶段要求。Codex 使用项目级 Skill 发现；Gemini 使用工作区 Skill/显式路径加载。页面显示同一段任务指令，Skill 文件内容单独展开。

Codex 默认沿用本机用户配置，可选 Profile；Gemini 沿用本机 Gemini CLI 配置。`--version` 检查仅代表 CLI 可执行；AI 登录和实际模型调用仍需真实任务验证。

AI 只负责生成任务结果和 `output/` 文件；服务器校验结果并负责归档、推送。执行工作区是文件组织边界，不等同于操作系统隔离；CLI 的工具权限由对应执行器控制。

## 验证

- `test/executors.test.ts`：独立工作区、完整 Skill 包、目录边界、Worker 鉴权、租约过期、实际 HTTP Worker 回传、SSH 命令转义。
- `scripts/verify-real-executor.mjs`：显式传入真实文章和本机 AI 配置后，使用隔离数据库、独立 Worker、真实 Gemini 完成审核与调研。GitHub 和群发送被模拟，正式业务数据不会修改。

网页路径和 API 角色已具备服务器部署所需配置；真实服务器域名、SSH 主机及系统常驻服务需要按目标环境配置。

## 手动运行与验证

空正文操作（立即运行、同步来源、发送汇报、连接测试）不携带 JSON Content-Type；仅有请求正文时声明 JSON。首页按工作区时区展示成功完成归档的任务结果，每 10 秒刷新；未完成时显示运行状态与进度入口。原始采集文章在内容池查看。

群通知发送会按飞书/Lark 兼容地址转换为原生消息卡片，同时检查平台业务返回码。HTTP 200 但平台拒绝时记录失败，不能当作发送成功。
