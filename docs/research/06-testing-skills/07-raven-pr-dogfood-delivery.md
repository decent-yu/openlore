# raven-pr-dogfood 实现与验证

日期：2026-11-10。实现入口：[SKILL.md](../../../skills/raven-pr-dogfood/SKILL.md)。已通过项目内 `.agents/skills/raven-pr-dogfood` 发现入口注册；下轮可使用 `$raven-pr-dogfood` 调用。

## 已实现

- **PR 与隔离工作区：**读取真实 base/head，固定提交；本地 base/head 可离线运行，不切换或清理用户原工作区。
- **旅程与测试清单：**要求预期来源，每个变更文件关联场景或排除理由，覆盖完整用户流程与后续结果。
- **执行与证据：**保存实际命令、退出码、代码指纹和日志；截图/视频复制归档并检查大小、类型、哈希、场景及轮次。
- **修复回归：**授权后处理明确缺陷，关联修复前失败、修复后同一命令成功与实际场景重测；支持说明理由的视觉复查例外。
- **恢复与交付：**代码、清单、环境变化使旧结果失效；保留失败与偶发记录，生成报告和证据包，不把未验证、跳过或套件失败算成成功。

新包独立编写，不包含参考项目的品牌、标识或其他 Skill 调用依赖。原始参考副本保持不变。运行脚本仅依赖 Python 标准库和 Git；在线 PR 需要 gh，浏览器使用宿主工具或可用的 agent-browser。支持 macOS/Linux。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| Skill frontmatter 与结构 | skill-creator 的 quick_validate.py 通过 |
| 21 项行为测试 | 全部通过；使用真实临时 Git 仓库和子进程 |
| 真实浏览器复现 | 独立无头 Chrome 两次重置后提交，均观察到订单数从预期1变成2；保存实际截图、视频和失败日志 |
| 修复后验证 | 重启修复后的隔离服务，浏览器相同操作显示1；完全相同的回归命令由1变为0，最终声明范围结论 READY_WITHIN_SCOPE |
| 反例检查 | 缺证据、证据篡改、过期结果、偶发失败、跳过、套件失败、未完成命令均不能冒充通过；不同命令的修复证明被拒绝 |

行为测试还覆盖了非默认 base 的 PR 元数据、PR 更新、未提交代码保护、计划替换后保留旧发现、并发写锁、超时和常见凭据脱敏。

[实际样例报告](evidence/raven-pr-dogfood-smoke/report.md) · [检查结果](evidence/raven-pr-dogfood-smoke/validation.json) · [源码哈希和验证摘要](evidence/2026-11-10-raven-pr-dogfood-validation.json)。所有媒体证据为临时测试应用生成，没有复用空白截图或伪造视频。

这次浏览器验证使用已知预埋问题，证明执行与记录闭环，不是独立缺陷发现能力的基准。在线 PR 的元数据分支使用夹具响应配合真实 Git 对象测试，未对真实 GitHub PR 执行联网拉取或认证验收，也未测试生产系统。

## 使用

```text
使用 $raven-pr-dogfood 测试这个 PR：具体 PR 链接。
发现范围内明确的小问题后修复，保留前后回归证据。
```

只要求测试时默认 report；要求测试并修复时使用 repair。commit、推送、评论和合并遵循已有用户授权，Skill 不自行发布。

维护检查：`python3 -B -m unittest discover -s skills/raven-pr-dogfood/tests -v`。浏览器夹具生成器为 `tests/browser_fixture.py`，只在新建的临时目录运行；其代码与数据不属于用户产品。
