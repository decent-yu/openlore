# Better Harness 评审架构与协作图

解释指标标准如何经 Web、API 和本地 Skill 形成可追溯的项目评审。适合技术方案说明、架构评审与跨系统责任讨论；它同时包含分层架构、任务产物和动态协作，并非纯系统上下文图，也不是已上线功能的证明。

[SVG 源图](../../assets/examples/raven-harness-assessment/assessment-flow.svg) · [PNG 预览](../../assets/examples/raven-harness-assessment/assessment-flow.png)

SVG 与原配套 PNG 均为 **3600 × 1920**。原样收录，未重绘。先看 PNG，需要修改时再读 SVG。方法见 [系统上下文与架构协作构图](../system-architecture-composition.md) 和 [反馈迭代与经验提炼](../feedback-iteration.md)。

## 画面怎样组织

| 区域 | 表达内容 | 设计作用 |
| --- | --- | --- |
| 左上静态分层 | 事实层 → 抽象事实层 → AI 层，逐层向上支撑 | 梯形上窄下宽，说明依据关系，不表达数量比例 |
| 左中职责摘要 | Web 配置与展示；API 保存标准、任务和产物；Skill 编排与校验 | 为右侧协作提供相同命名与颜色线索 |
| 左下完整目录 | 同一 taskId 下的标准快照、原始事实、抽象证据、分析结果和可选预览 | 两列共用根路径，保留目录内容而降低纵向高度 |
| 右侧三泳道 | Web、API、Skill／插件，时间自上而下 | 动作归属与请求／返回方向同时可读 |
| 用户 Prompt 气泡 | 人在编码工具中发起评审 | 将人的意图与 Skill 的后续编排分开 |
| 辅助摘要与底部关联 | 三阶段对应三类产物，taskId／groupVersion／indicatorId／evidenceIds | 将流程与证据链关联，不用跨越左右视图的连线 |

Web 使用蓝色，API 使用绿色，Skill／AI 使用紫色；色彩在标题、图标、箭头和产物中复用。正文与背景降低饱和度，角色与步骤仍可通过位置、名称和编号识别。这些色值、比例、三泳道和七个编号是本例选择，不是统一模板。

## 值得复用的语义

- **标准与结果分开**：Web 配置指标组、判断 Prompt 和判断标准；API 发布版本。Skill 首先获取已发布标准并固定 groupVersion，保存 list/ 与 task.json，再执行采集与分析。
- **事实、抽象与判断分开**：raw/ 保留来源，facts/ 整理语义证据；AI 依 Prompt 判断并引用证据，脚本维护结构和校验引用。没有把结构校验画成模型替人决定结论。
- **请求与返回分开**：获取标准与返回 JSON、同步结果与回执、Web 查询与 API 返回各自有方向与标签。阶段状态用带标签的虚线表示，与最终结果提交区分。
- **本地保存与线上展示分开**：评审产物保留本地 JSON，通过 API 同步；Web 经 API 查询状态、结论和证据。index.html 只作可选本地预览。
- **关联标识各司其职**：taskId 贯穿任务，groupVersion 固定口径，indicatorId 关联标准与结果，evidenceIds 指向证据与来源；不能合并为一个模糊“版本”。
- **未定方案可见**：顶部标明方案状态，report 命名、index.json 形式、API 路由与同步范围仍待确认。目录名和接口动作是设计讨论材料，复用时不当成真实协议。

## 可核实的演进

以下依据 BetterHarness 的提交说明及对应 SVG 差异整理，不是原始对话逐句复现。完整绘图会话未取得；未记录的反馈或动机不补写为用户原话。

| 提交 | 可见调整 | 可复用判断 |
| --- | --- | --- |
| `3c9c4fc` | 将手绘方案整理为事实／抽象证据／AI 结论、三阶段与工作区产物，加入 Web/API 和指标管理 | 先把原始素材中的对象、依据与产物整理出来，再设计画面 |
| `86bd3d2` | 提交说明明确按请求拆成独立左右视图：左侧分层，右侧发起和阶段顺序，移除跨区连接 | 静态层级与时间顺序有不同读法；分开可减少关系混淆 |
| `47b3ed9` | 补齐 Web 指标组配置、已发布标准快照、插件触发、API 状态与结果同步、完整 JSON 目录，并标记未定内容 | 跨系统方案要画责任与往返内容，不能只画几个系统方框和“同步” |
| `d99ef30` | 分层改为梯形金字塔，目录两列；增加角色图标、Prompt 气泡和一致的请求／返回线，改为 3600 × 1920 并导出 PNG | 改宽版时重排阅读结构，保留真实内容和待定标记，不压扁整张图 |

四次变化展示了从语义整理到阅读路径、再到协作细节和视觉重排的过程，不代表每个新图必须依次走四轮。图稿中同步失败可重试等内容是方案表达，不作为实际重试机制的验证证据。

## 来源与资源边界

来自 `raven-ai-labs/BetterHarness` 仓库提交 `d99ef30` 的以下文件；收录时本地原图与该提交一致：

```text
docs-raven/architecture/raven-harness-assessment-flow.svg
docs-raven/architecture/raven-harness-assessment-flow.png
```

只收录用户指定主图与同名 PNG，不收录同目录的 simple 变体、历史草稿或完整会话日志。历史版本通过上表提交定位，避免复制每一轮大图。

源图的通用图标是内联 SVG 路径，没有嵌入外部图片或字体文件，也没有附第三方图标来源声明；不据此宣称为某品牌官方标志或确定的图标库作品。复用这些图形前沿用原项目的资源许可要求；需要确定出处的图标时改用目标项目已有且可追溯的素材。

字体栈含 PingFang SC、Microsoft YaHei、Noto Sans CJK SC 等系统字体，字面标识另有等宽回退。原 PNG 是本例的参考预览；仅声明字体栈不能保证跨机器字重、字宽与像素完全一致。

另附 [箭头兼容 SVG](../../assets/examples/raven-harness-assessment/assessment-flow-compatible.svg)。本次用固定版本 resvg 2.6.2 试渲染原 SVG 时，部分向上、向下和向左的箭头未按线段方向旋转，原 PNG 无此问题。因此原 SVG 的直接导出不能覆盖原预览。

本例四个 marker 都只用于 `marker-end`，兼容副本仅将它们的 `orient="auto-start-reverse"` 改为 `orient="auto"`，其余内容保留；解析后的树已核对除这四个属性外一致，试渲染已目视确认箭头方向恢复。这一替换只适合本例的终点标记用法，含起点标记的图不能直接照搬。排障见 [渲染参数与排障](../rendering-guide.md)。

## 验收与使用限制

原预览已查看：左右阅读区清楚，梯形逐层变宽，目录共用一个根路径，请求与返回箭头分开，Web 经 API 展示，方案／暂定标记保留。完整图适合放大查看；在文章或幻灯片中缩到小宽度会使目录和次级说明过小，应按任务另出概览或局部图，不仅增加 PNG 像素。

使用现有脚本在临时目录试渲染兼容副本，查看中文、字重、箭头朝向、连线端点和阴影；不要直接覆盖原配套 PNG：

```bash
python3 <skill-dir>/scripts/audit-svg.py <skill-dir>/assets/examples/raven-harness-assessment
node <skill-dir>/scripts/render-svg.mjs \
  <skill-dir>/assets/examples/raven-harness-assessment/assessment-flow-compatible.svg \
  --output <temporary-dir>/assessment-flow.png --width 3600
```

此案例验证图形表达与可渲染性，不验证评审系统的运行、接口或实现状态。
