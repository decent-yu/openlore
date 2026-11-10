# 当前定位：只测试、复现和报告

日期：2026-11-10。当前 Skill 与公共报告格式均为 2.0.0。

**固定 PR 版本 → 分析影响 → 实际测试 → 复现取证 → JSON / HTML 报告。发现缺陷就保留失败结论，不修改产品代码。**

## 本次删掉的内容

- 删除 repair 模式、修复命令、修复证明和“先失败、改代码、再成功”的开发流程。
- 删除 JSON 中的 mode、repairs、resolved_findings，以及页面上的“已修复”指标。
- 不接受测试过程中的未提交代码编辑；工作区发生改动时，结果无效，需重新取得干净、已提交的目标版本。

保留 cause_hypothesis 和 recommendation，分别给出待确认的排查线索与处理建议。它们不代表已经处理问题。

## 新版本复测

开发者提交新代码后，可以准备新的隔离工作区，重新测试同一 PR。只有提交确实不同、预期与依据一致、实际复测通过，报告才显示“新版复测通过”；旧失败与证据仍保留。这部分是验证，不承担修复。

## 当前 smoke

[打开 HTML 报告](evidence/raven-pr-dogfood-test-only-smoke/report.html) · [标准 JSON](evidence/raven-pr-dogfood-test-only-smoke/report.json) · [字段说明](../../../skills/raven-pr-dogfood/references/report-format.md)。

本次在一份新建的临时 base/head 代码比较上运行正常提交、重复提交、不同购物车三个场景。报告结论是 **2 通过、1 失败，NOT_READY**：重复提交产生两张订单，经两次实际浏览器操作及接口断言确认。测试全过程未修改被测代码，固定提交和代码指纹保持不变。

29 项自动化测试通过，覆盖拒绝代码编辑、不可调用修复命令、原始失败保留、新提交复测、同版本换环境不能冒充新版本通过，以及 JSON/HTML 的一致性与证据校验。浏览器样例使用已知预埋问题，证明测试和报告流程，不代表生产项目或真实在线 PR 的效果基准。

此前 1.0/1.1 的修复演示保留为历史归档，不作为当前 Skill 的使用方式。当前包：[raven-pr-dogfood](../../../skills/raven-pr-dogfood/SKILL.md)。
