# GitHub Actions / Runner 架构调研

日期：2026-10-17。依据 GitHub 官方文档与 `actions/runner` 设计资料，并对照当前 OpenLore 源码；未部署 GitHub Runner 或调用真实 AI。以下 OpenLore 选择是本项目设计判断。

## 核心分工

GitHub 的 workflow 定义触发条件、jobs 和 steps；action 是可复用步骤，Runner 是执行 job 的进程。对应 OpenLore，应由云端控制服务维护计划与流水线，再把 AI job 交给 Runner，不能把 action 本身当成云端调度器。[Workflows](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows)。

Runner 主动连接 GitHub 获取任务，需要出站 HTTPS；平台决定任务路由。无匹配可用执行机时排队，有领取确认和等待期限。OpenLore 借鉴主动连接、中心状态、资格匹配、有限等待和结果确认，具体时限按 AI 任务特性设计。[Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)。

注册凭证、Runner 身份和任务权限应分开考虑。GitHub Runner 的设计区分注册和运行阶段，并通过监听器领取任务；这说明“安装一次、只运行执行代理”不依赖整站开发环境。[Runner authentication design](https://github.com/actions/runner/blob/main/docs/design/auth.md)。

## 对照与取舍

| 主题     | OpenLore 现状                    | 设计取舍                                                      |
| -------- | -------------------------------- | ------------------------------------------------------------- |
| 云端编排 | 服务端决定审核、调研、归档与汇报 | 保持云端唯一业务状态与交付权限                                |
| 主动领取 | Worker 独立进程，短轮询领取      | 现阶段可用；有规模或响应需求再采用长轮询                      |
| 运行身份 | 每个 AI 配置一个长效令牌         | 后续拆出设备身份与一次性配对；不用管理 Token 连接 Runner      |
| 路由     | 按 `profile_id` 绑定，限制并发   | 先拆设备与模型配置，再做能力/标签匹配，避免虚构现成 Runner 池 |
| 安装     | 从源码构建 `apps/server` 产物    | 独立 Runner 制品应作为下一项交付，不要求电脑运行网站          |
| 故障恢复 | 租约可重领，控制服务重启中断业务 | 优先补持久化阶段与幂等，可靠性不能仅靠“队列表存在”推断        |
| 工作区   | 每任务独立目录、CLI 工具权限     | 继续保留；容器/虚拟机隔离按任务风险和环境选择                 |

本项目是知识工作流，不需要照搬完整 CI 平台、YAML 生态或 Kubernetes。单实例控制服务的 SQLite 可支持多个外部执行进程；独立发布和故障恢复比先换队列中间件更直接。

**结论：采用云端控制服务 + 独立 Runner 为标准架构，`local` / SSH 为辅助路径。**它已有基本运行实现，待实现部分在[系统架构差距表](../architecture/system-architecture.md#当前实现与设计缺口)明确列出。操作状态建议区分在线、空闲、繁忙与离线，不能只展示一个“连接成功”；这是本项目改进方向，参考 [GitHub Runner 监控](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/monitor-and-troubleshoot)。
