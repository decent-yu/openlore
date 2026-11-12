# 标准报告 JSON 与可视化渲染

`report.json` 是对外交付和渲染的统一输入，版本为 `schema_version: "2.0.0"`。完整字段约束见 [report.schema.json](report.schema.json)，采用 JSON Schema 2020-12；未知字段、错误类型和不支持的版本会被拒绝。

## 标准字段

| 字段 | 内容 |
| --- | --- |
| schema_version | 报告数据格式版本，与 Skill 自身版本分开 |
| metadata | 稳定报告 ID、标题、生成时间 |
| target | 仓库、PR、base/head、实际被测提交、工作区指纹、轮次 |
| summary | 结论、范围、场景各状态数量、问题总数、待处理及新版复测数量、严重度分布 |
| environment | 浏览器、服务地址、身份依据、数据/替身、能力与环境证据；未准备时为 null |
| coverage | 变更文件、排除理由及没有关联测试的文件 |
| flows | 完整用户旅程、步骤与预期终态 |
| scenarios | 场景 ID、优先级、前提、动作、预期/来源、当前状态和每次实际尝试 |
| findings | 稳定/偶发/待复现的问题、原始证据、引入归属，以及 open/retested_pass/historical 状态 |
| retests | 原失败提交、新被测提交、同预期下的实际复测结果及证据 |
| commands | 实际命令参数、起止时间、退出码、代码指纹及日志证据 ID |
| evidence | 截图/视频/日志的相对路径、哈希、大小、场景与步骤、轮次和有效性 |
| timeline | 计划替换、重测、版本和环境变更的追踪记录 |
| checks | 记录完整性错误、未验证项及当前套件执行 ID |

所有字段由运行记录导出；不通过提取 Markdown 标题或解析自然语言拼凑数据。`state.json` 仍是私有恢复文件，不作为公共报告契约，不包含在交付包中。

只支持当前结构，不提供旧报告、旧状态迁移。可选字段在写入记录时统一成明确的 null / 空列表；导出直接读取当前记录，必需字段缺失时报错，不从其他版本的计划或记录中猜测补全。

## 计数和引用规则

- summary.total 等于 scenarios 数量，各状态计数之和必须相同。
- 代码/环境已经变化的旧结果，其当前场景状态为 pending。旧结果和证据保留，但不算当前通过。
- 同一场景、轮次与环境中的累积失败合并成一个 finding。开发者新提交复测通过后，原始失败证据仍在 findings；当前场景可以为 pass，历史问题状态为 retested_pass。
- 只有不同的已提交版本、相同预期及依据、当前实际测试通过，才产生新版复测记录；不提供“已修复”结论。
- attempts、retests、commands、environment 通过 ID 关联证据；没有对应记录的引用会被拒绝。
- 媒体路径必须为 artifacts/ 下的普通相对文件名，不能是绝对路径、外链、脚本地址或 ../ 跳转。
- READY_WITHIN_SCOPE 不能与失败、待测、检查缺口、环境过期或缺失成功套件相冲突。

结构与关联检查不能证明业务预期正确，也不能验证上传 JSON 的事实来源；真实执行仍由本 Skill 的测试与证据流程负责。

## 生成报告

正常任务只需：

```bash
python3 "$SKILL_DIR/scripts/qa_run.py" report --run "$RUN"
```

会先导出并校验 report.json，再由同一 JSON 生成 report.html 和 report.md，同时输出 report.schema.json 与 validation.json。HTML 内嵌数据、样式和交互脚本，不需要 CDN 或开发服务器；打开 HTML 即可查看，媒体证据使用同目录下 artifacts/。

只拿到一份符合契约的 JSON，也能独立渲染，不需要原仓库、Git、run 状态或浏览器自动化工具：

```bash
python3 "$SKILL_DIR/scripts/report_renderer.py" \
  --input delivery/report.json --output delivery/report.html \
  --markdown delivery/report.md
```

返回0表示文件生成成功，不代表测试通过。结论读取 summary.verdict。无效 JSON 返回2并保留已有输出文件。

HTML 提供场景状态和严重度筛选、文本搜索、问题与复测记录、命令日志、覆盖与环境检查、截图放大、视频播放和 JSON 下载。报告中的文本只作为文本展示，不作为 HTML 或脚本执行。

bundle 导出五个文件和 artifacts/：report.json、report.html、report.md、report.schema.json、validation.json。分享时一起携带整个目录，不能只发 HTML 后丢掉证据。
