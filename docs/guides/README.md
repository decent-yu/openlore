# 操作与开发指引

**已有云端网站时，新电脑只接入 AI Runner，不启动整站。**整体关系见[系统架构与 SVG](../architecture/system-architecture.md)。

| 你的角色或目标             | 阅读顺序                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| 普通使用者 / 新电脑执行 AI | [首次使用](getting-started.md) → [AI Runner 接入](ai-executors.md)                           |
| 网站管理员 / 自行部署      | [控制服务部署](server-deployment.md) → [首次业务流程](getting-started.md#跑通第一条业务流程) |
| 开发者 / 本机调试          | [开发者指引](development.md)                                                                 |

`npm run dev` 仅用于整站开发；Runner 的当前可用命令是 `node apps/server/dist/cli/index.js worker <配对文件>`。独立 Runner 发布包与设备管理仍在[架构待办](../architecture/system-architecture.md#当前实现与设计缺口)中。
