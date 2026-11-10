# 上游来源

- 仓库：https://github.com/EveryInc/compound-engineering-plugin
- 目录：`skills/ce-dogfood`
- 下载分支：`main`
- 下载日期：2026-11-10
- 许可证：MIT；来源：https://github.com/EveryInc/compound-engineering-plugin
- 获取方式：skill-installer，下载完整 Skill 目录；未改写上游文件。

运行依赖：项目开发服务、Git，以及能覆盖测试矩阵的宿主内置浏览器；否则使用 `agent-browser`。上游还会按场景调用 `ce-worktree`、`ce-debug`、`ce-commit`、`ce-compound`，这些其他 Skills 未随本目录下载。

上游默认包含自动修复与本地提交。调用时以用户授权为准；当前会话要求不提交 commit。本次仅下载，没有执行 QA、修复或提交。

本目录是仓库内源码副本，未注册为全局 Skill。可向 Agent 指定本目录的 `SKILL.md` 调用。
