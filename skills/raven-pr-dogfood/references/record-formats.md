# 工具与记录格式

所有命令先可加 `--help`。脚本路径以 `SKILL_DIR/scripts` 为准，`RUN` 是工作区之外的任务 run。JSON 文件由 Agent 根据实际任务生成；以下字段示例需要替换成真实场景和工具返回的 ID，不能直接当成完成证据。

## plan

`plan --run "$RUN" --file plan.json`。顶层 flows、scenarios 必填，exclusions 可省略。场景 ID 用字母、数字、下划线或短横线，最长 64 字符。oracle 写可定位的需求、PR 说明或明确推断。

```json
{
  "flows": [{
    "id": "F1",
    "title": "提交订单后查看结果",
    "steps": ["买家打开结算页", "提交订单", "在订单列表重新读取记录"],
    "expected_end": "只产生一张内容正确的订单"
  }],
  "scenarios": [{
    "id": "S1",
    "flow_id": "F1",
    "title": "重复点击提交不会重复创建",
    "priority": "critical",
    "changed_files": ["src/orders.ts"],
    "preconditions": ["使用本轮创建的买家和购物车"],
    "steps": ["打开已填好的结算页", "连续点击两次提交", "查看订单列表和保存的订单"],
    "expected": "只有一张订单，金额与购物车一致",
    "oracle": "PR 验收条件：重复提交保持幂等",
    "surfaces": ["browser", "api"],
    "required_evidence": ["screenshot", "video", "log"]
  }],
  "exclusions": [{"path": "docs/order-copy.md", "reason": "仅更新说明文字，人工核对内容，不影响运行行为"}]
}
```

priority：critical / high / normal。surfaces：browser / api / cli / job；可多选。required_evidence：screenshot / video / log。浏览器场景至少 screenshot，其他场景至少 log。覆盖表必须包含 context.changed_files 的全部路径；共享改动可以关联多个场景，不能引用不存在的变更路径。

## evidence

```bash
python3 "$SKILL_DIR/scripts/qa_run.py" evidence --run "$RUN" \
  --scenario S1 --step 2 --kind screenshot --file "$TASK_DIR/double-click.png" \
  --note "第二次点击后按钮仍可用，页面显示两个订单编号"
```

返回真实 E-ID，后续用该 ID 关联尝试。允许 PNG/JPEG/WebP 图片、WebM/MP4 视频、非空日志；不接收符号链接或空文件。类型检查只识别文件头，不代表图像内容或视频语义已审查。环境启动/版本证据省略 scenario，不能把它当成业务场景证据。

## environment

先注册本轮启动日志/版本响应等证据，再用 `environment --run "$RUN" --file environment.json`：

```json
{
  "browser": "native",
  "url": "http://localhost:3000",
  "identity_proof": "本轮从 context.workspace 启动，日志记录了工作目录、端口和版本响应",
  "dataset": "本轮新建的两个测试账号；邮件使用本地收件箱；没有验证真实投递",
  "capabilities": ["screenshot", "video", "console", "network"],
  "proof": ["E-service-proof-id"]
}
```

browser 取 native / agent-browser / none；后台项目可 none，不强迫打开无关页面。每次 environment 更新都会使原环境的结果、命令失效，即使代码没有变。

## exec

用 `--` 分隔工具参数和真实命令，不经过隐式 shell，也不接受一整串字符串冒充参数列表：

```bash
python3 "$SKILL_DIR/scripts/qa_run.py" exec --run "$RUN" --scenario S1 \
  --phase check --timeout 120 -- npm test -- --run orders
python3 "$SKILL_DIR/scripts/qa_run.py" exec --run "$RUN" --phase suite \
  --timeout 600 -- npm test
```

phase：check / before / after / suite。suite 可不关联场景；其他阶段要指定 scenario。返回的 C-ID 关联执行记录，其 evidence 是自动注册的真实日志 E-ID。返回码沿用被执行命令；超时124、中断130，工具输入错误2；命令运行失败本身也可能返回2，要结合 JSON 的 C-ID 与 exit_code 区分。

## result

`result --run "$RUN" --scenario S1 --file result.json`：

```json
{
  "status": "fail",
  "summary": "相同前提下两次重试均产生重复订单",
  "severity": "high",
  "attribution": "unknown",
  "attempts": [
    {"outcome": "fail", "actual": "第一次提交产生两张订单", "evidence": ["E-first-shot", "E-first-video", "E-first-response"]},
    {"outcome": "fail", "actual": "新购物车复现相同问题", "evidence": ["E-second-shot", "E-second-video", "E-second-response"]}
  ]
}
```

status：pass / fail / flaky / observed / blocked / skipped。每个实际尝试都有 outcome、actual、至少一个对应场景且属于当前轮次/环境的 E-ID。fail 至少两次失败、无成功；flaky 同时有失败与成功；observed 至少一次失败。pass 至少一次成功且不含失败。重新记录同一环境结果必须保留之前尝试的证据 ID。

blocked / skipped 必须有 reason；可无 attempts。severity 在 fail/flaky/observed 时必填。attribution 取 introduced / preexisting / unknown，默认 unknown。没有录屏等能力时可附：

```json
{"evidence_gaps": [{"kind": "video", "reason": "宿主无录屏能力，已保留逐步截图和接口记录"}]}
```

缺口必须解释缺失的 required_evidence，且最终结论不能是无保留的 READY_WITHIN_SCOPE。

## repair

`repair --run "$RUN" --scenario S1 --file repair.json`：

```json
{
  "summary": "为重复提交增加幂等判断",
  "root_cause": "同一购物车提交未关联幂等标识，连续请求分别写入",
  "files": ["src/orders.ts", "tests/orders.test.ts"],
  "before": "C-failing-regression-id",
  "after": "C-passing-regression-id"
}
```

before/after 必须是该场景实际执行的 before/after 命令：同一参数列表、不同代码指纹、前者非零且不是超时/中断、后者为0，命令自身没有修改源代码，且 after 属于当前轮次/环境。同时必须已有当前场景的成功复查结果。新增测试路径先纳入 plan，不能只改生产代码覆盖而漏掉回归。

确实不适合自动化的纯视觉修复可用 visual_reason 替代 before/after，保留 files、根因、实际成功截图与场景复查；报告明确它是人工可读的视觉复查例外。

## status / refresh / interrupt-command

- `status --run "$RUN"`：查看完整计划、当前上下文、结果与检查摘要，不改进度。
- `refresh --run "$RUN"`：repair 模式接受本地代码变动，增加轮次，使旧结果失效；原始改动文件仍须覆盖。
- `refresh --run "$RUN" --context next-context.json`：目标 PR 更新后使用新解析的隔离工作区；身份必须仍为同一 PR/本地比较。
- 修改 plan 也增加轮次，需要重建当前环境并重测。
- 中断的命令由工具保留为未完成。确认进程已终止、检查其修改/数据副作用后，运行 `interrupt-command --run "$RUN" --id C-id --reason "已确认进程退出，已检查本轮测试数据"`；它不能把命令改成成功。

## validate / report / bundle

| verdict | 含义 |
| --- | --- |
| INVALID | 代码不匹配、证据丢失/被改，或记录不合法 |
| NOT_READY | 当前场景有稳定/偶发失败，或自动化套件失败 |
| INCOMPLETE | 有待测/未验证/跳过、证据缺口、修复证明不足，或尚无当前套件结果 |
| READY_WITHIN_SCOPE | 声明范围已测、证据完整、无上述缺口，当前套件成功；范围是否充分仍需审查 |

report 总会保留失败与限制，导出标准 report.json，再生成 report.html、report.md、report.schema.json 与 validation.json。字段与独立渲染见[标准报告格式](report-format.md)。bundle 要求全新的外部目录，复制报告和明确注册的 artifacts，不复制 state、源仓库或默认抓取认证文件。私有 run 是可恢复的完整工作记录；delivery 是便于审阅的交付包。外部发布仍按用户授权处理。
