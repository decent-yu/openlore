# OpenLore 文档

OpenLore 的标准部署是 **云端控制服务 + 独立 AI Runner**。使用已有网站的人只需接入 Runner；`npm run dev` 用于开发整站。

| 目的                             | 入口                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 新电脑接入、部署服务器、日常使用 | [操作指引](guides/README.md)                                                                                 |
| 查看整体架构图与部署边界         | [系统架构](architecture/system-architecture.md) · [SVG 原图](product/feature/assets/system-architecture.svg) |
| 了解执行协议、租约和当前限制     | [Runner 协议与生命周期](architecture/local-ai-executors.md)                                                  |
| 了解实际依赖与代码边界           | [技术栈](architecture/technology-stack.md)                                                                   |
| 修改代码与运行验证               | [开发者指引](guides/development.md)                                                                          |
| 查看业务规则                     | [功能总览](product/feature/index.md)                                                                         |
| 查看架构决策依据与本次文档核查   | [Actions/Runner 调研](research/04-actions-runner.md) · [文档核查记录](architecture/documentation-audit.md)   |

全部调研见[调研目录](research/README.md)，包含开源参考、AI 采集、原型与 Runner 方案。

## 文档职责

- `guides/`：按使用者、服务器管理员、开发者组织可执行步骤。
- `architecture/`：维护部署边界、协议、技术事实和明确标注的待实现设计。
- `product/feature/`：维护用户可见的业务规则，不重复环境安装与协议细节。
- `research/`：保留带日期的调研依据，历史提议不作为当前功能承诺。
- `product/feature/examples/`：人工构造的阅读样例，不是配置导入文件或真实运行验收。

行为变动时同步更新对应功能文档；协议、部署和命令变动时同步更新架构与指南。已实现、待实现、历史快照必须明确区分，同一规则尽量维护一处。
