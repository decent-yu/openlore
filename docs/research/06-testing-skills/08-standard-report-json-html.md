# 标准 JSON 与可视化测试报告

历史归档：包含当时的修复流程；当前版本已收敛为[只测试与报告](09-test-and-report-only.md)。

更新：2026-11-10。Skill 已升级为 1.1.0，报告数据格式为 1.0.0。

**每次运行导出一份 report.json，再从同一份 JSON 生成 HTML 和 Markdown。** 私有 state.json 用于续跑，公共报告字段独立维护。

## 看新 smoke

- [HTML 可视化报告](evidence/raven-pr-dogfood-json-smoke/report.html)
- [标准 JSON 数据](evidence/raven-pr-dogfood-json-smoke/report.json)
- [Markdown 报告](evidence/raven-pr-dogfood-json-smoke/report.md)
- [修复前的 HTML](evidence/raven-pr-dogfood-json-smoke/before/report.html)
- [字段 Schema](../../../skills/pr-dogfood-test/references/report.schema.json) · [字段说明](../../../skills/pr-dogfood-test/references/report-format.md)

HTML 内嵌数据、样式和交互，无 CDN 依赖；截图和视频通过同目录 artifacts/ 加载，分享时携带整个目录。实际页面验证使用本地 HTTP 预览。

## 统一的内容

| 部分 | 对应字段 |
| --- | --- |
| 报告身份与版本 | schema_version、metadata |
| PR、代码版本与环境 | target、environment |
| 结论与计数 | summary |
| 测了哪些改动与操作 | coverage、flows、scenarios |
| 发现的问题和修复 | findings、repairs |
| 实际执行与文件证据 | commands、evidence |
| 历史记录与未验证项 | timeline、checks |

固定字段有类型和枚举约束；工具另外检查计数、引用、旧结果失效和结论一致性。HTML 支持搜索、状态/严重度筛选、详情展开、截图放大、视频播放、命令日志和 JSON 下载。

## 这次真的跑了什么

新建了另一份临时 base/head 代码比较，启动本地订单应用，重新进行真实浏览器操作和接口检查。

| 阶段 | 结果 |
| --- | --- |
| 修复前 | 正常提交、不同购物车通过；重复提交两次均产生多余订单，2 通过 / 1 失败 |
| 修复后 | 同一回归命令成功，浏览器重走后只产生一张订单；3 个场景通过，1 个问题已修复 |
| 最终结论 | READY_WITHIN_SCOPE；修复前的尝试、截图、视频和日志仍保留在报告中 |

28 项自动化测试通过，覆盖标准字段、计数和引用、脚本注入文本、独立 JSON 渲染、修复历史保留及原有工作流。页面实测了筛选、搜索、四个章节、图片放大、视频解码、下载 JSON 一致性，以及 390px 手机宽度无横向溢出。

[桌面截图](evidence/raven-pr-dogfood-json-smoke/ui-desktop.png) · [问题详情截图](evidence/raven-pr-dogfood-json-smoke/ui-finding.png) · [手机截图](evidence/raven-pr-dogfood-json-smoke/ui-mobile.png) · [验证摘要与文件哈希](evidence/raven-pr-dogfood-json-smoke/verification.json)。

这是已知预埋缺陷的本地流程验证，不是实际 GitHub PR 的联网验收，也不能证明对任意项目的缺陷发现率。

## 只给 JSON 也能生成

```bash
python3 skills/pr-dogfood-test/scripts/report_renderer.py \
  --input delivery/report.json --output delivery/report.html \
  --markdown delivery/report.md
```

该步骤不需要仓库、Git 或运行状态；媒体仍按 JSON 中的相对路径读取。字段检查和文件生成成功不等于业务测试通过，最终结论取自 summary.verdict。
