# PR、版本与运行环境

## 固定比较范围

`pr_workspace.py` 接受明确 PR，或者本地 base/head。在线 PR 使用 `gh` 读取真实 base/head oid，按不可变版本取得对象，再创建 detached worktree；本地比较也解析成提交，按 merge-base 到 head 列出改动。删除、重命名按路径变化纳入覆盖，不忽略被删除的入口。

- 源工作区不会被 checkout、stash 或清理。目标 worktree 必须是不存在、且位于源工作区之外的新路径。
- 浅克隆缺少历史、取不到准确提交或 PR 在取元数据后更新时，不用其他版本冒充；补齐历史或重新解析本轮目标。
- fork PR 保留所属仓库和编号，不能只根据同名分支推断版本。拉取只使用元数据中固定的提交；失败就报告实际错误，不切到可移动的 PR 分支重试。
- 离线命令：`python3 "$SKILL_DIR/scripts/pr_workspace.py" --repo "$SOURCE" --base release --head feature --worktree "$TASK_DIR/worktree" --output "$TASK_DIR/context.json"`。
- 不自动初始化 submodule 或 LFS。需要它们的项目按项目规范准备后再开始；脚本要求子模块初始化且干净，不声称指纹能代表未捕获的子模块改动。

PR 描述、issue 验收条件和产品资料用于建立预期。记录来源及不确定之处；避免以“改动后的代码就是这么写的”证明行为正确。

## 环境核对

1. 读取项目约定的安装、启动和测试命令；使用该项目的锁文件与既有配置。缺少用户独有凭据时仅阻塞有关场景，继续其他检查。
2. 从 context 指定的 workspace 启动服务。记录启动命令、端口、进程/工作目录以及启动日志；已有服务要通过版本端点、构建标识或工作目录等实际依据确认身份。
3. 对远程预览地址，要求可验证的部署提交或构建标识；无法证明对应本轮版本就记为未验证，不能用可访问代替版本正确。
4. 记录测试身份、角色、数据版本及替身：例如本地邮件箱代替真实邮件，测试支付代替真实扣费；说明无法证明的真实服务腿。
5. 将服务身份日志或构建信息先通过 `evidence` 注册，随后写 environment。认证令牌不要放进命令参数、证据或报告；使用既有会话和环境注入。

指纹覆盖 HEAD、相对于 HEAD 的二进制 diff、未忽略的非跟踪文件及干净的子模块状态。它**不覆盖被 Git 忽略的 .env、数据库、外部服务数据或远程部署**，这些由 environment 的 identity_proof、dataset 和实际证据补足。依赖和数据准备完成后再确认环境；变更它们时重新记录环境使旧结论失效。

## 浏览器选择

优先宿主内置浏览器：确认能访问目标、读页面、交互、截图并检查控制台；多用户、视口、录屏、网络故障等能力按清单需求检查。否则使用 PATH 中可用的 `agent-browser`，先运行 `agent-browser --help` 和 `agent-browser skills get core`，以当前版本指引为准。

常用命令形状如下；用实际 session 和路径，不把这些例子当成替代当前 CLI 帮助：

```bash
agent-browser --session qa-author open "http://localhost:3000"
agent-browser --session qa-author snapshot -i
agent-browser --session qa-author screenshot --annotate "$TASK_DIR/step-1.png"
agent-browser --session qa-author console
agent-browser --session qa-author errors
agent-browser --session qa-author record start "$TASK_DIR/repro.webm"
agent-browser --session qa-author record stop
```

每个测试身份独立 session。一次导航后重新取元素引用；定位用交互快照，检查页面内容时用完整快照与截图。录屏时操作节奏应可读，不为拍视频额外制造未经授权的操作。

## 服务与状态的归属

停止本轮启动且仍属于本轮的服务，清理本轮测试数据；不结束用户原有服务。浏览器运行中若缺能力，先记录阻塞；需要切换工具时重建并重新确认环境，旧结果不计为当前通过。

默认保留隔离工作区供复核。确认无需保留且工作区干净后才移除；不使用 force 丢弃改动。不修改被测代码，不创建修复提交，也不推送、评论或合并 PR。开发者提交新版本后，通过新的 context 开始复测，报告产物保持在被测工作区外。
