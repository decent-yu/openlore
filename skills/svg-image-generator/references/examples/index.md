# 案例索引与收录约定

根据表达目标选案例，先读说明，再查看对应 PNG。不要批量加载 SVG 中的字体或图标 base64，也不必每次读取整个案例库。

| 案例 | 适合参考 | 说明 | 图稿 |
| --- | --- | --- | --- |
| Raven 产品生态图 | 单一产品核心、多端入口、按模块聚合的能力、自然散布的功能节点 | [设计取舍与调整过程](raven-product-ecosystem.md) | [SVG](../../assets/examples/raven-product-ecosystem/ecosystem.svg) · [PNG](../../assets/examples/raven-product-ecosystem/ecosystem.png) |
| Raven Wiki 功能设计图 | 资料加工、功能索引、同一数据的两种读取视图、更新发布与冲突分支 | [功能表达与构图取舍](raven-wiki-feature.md) | [SVG](../../assets/examples/raven-wiki-feature/wiki-design.svg) · [PNG](../../assets/examples/raven-wiki-feature/wiki-design.png) |
| Better Harness 评审架构与协作图 | 静态分层与动态流程分区、Web/API/Skill 三泳道、标准快照与证据链、完整目录分栏 | [架构表达与可核实演进](raven-harness-assessment.md) | [SVG](../../assets/examples/raven-harness-assessment/assessment-flow.svg) · [PNG](../../assets/examples/raven-harness-assessment/assessment-flow.png) |

按要解释的关系选例，不按配色选模板。系统上下文先读 [系统上下文与架构协作构图](../system-architecture-composition.md)；当前架构案例展示的是组合方案图，不冒充纯上下文范例。

## 目录分工

```text
SKILL.md                               工作入口与按需路由
references/ecosystem-composition.md     可复用方法
references/feature-design-composition.md 功能主线、视图与状态表达
references/system-architecture-composition.md 系统边界、分层与协作流程
references/feedback-iteration.md        跨图型的反馈处理与经验提炼
references/examples/index.md           案例选择与收录约定
references/examples/<case-id>.md        单案例的语义、取舍和来源
assets/examples/<case-id>/              与说明配套的实际图稿
assets/examples/licenses/               多案例共用的第三方许可文本
scripts/                               现有渲染和 XML 检查工具
```

每个案例采用简短、稳定、描述用途的目录名；图稿用具体名称，如 `ecosystem.svg` 与 `ecosystem.png`。不把“第七版”“四模块”“最终最终版”当作案例身份。不同用途的图单独建案例，不把所有大图放入同一目录。

说明应记录以下有用内容，结构可按案例裁剪：

- **适用场景与阅读目标**：读者应该理解什么，哪些任务不宜照搬。
- **源图与预览**：使用相对链接，写出 SVG 逻辑尺寸与 PNG 像素尺寸。
- **设计取舍**：核心、分组、视觉层级、线条含义与有限的几何参数。
- **反馈摘要**：记录改变设计决策的请求及响应，不存逐句对话和重复调整。
- **来源与复用边界**：原项目相对路径、可用的提交标识、品牌／字体／图标来源；说明哪些是本例偏好。
- **验收与限制**：实际渲染情况、字体依赖、是否包含示意图标；有必要才附可复现的命令。

反馈证据分层写清：有对话才摘要请求；仅有 Git 历史则记录提交与图稿变化；仅有最终图则分析画法，不编造迭代史。来源提交描述的是历史图稿，不代表当前系统仍采用该方案。

## 新案例进入时

用户要求收录时，先检查现有案例是否只是同图更新；同一案例通常更新原说明和同名预览，确有学习价值的不同方案才保留额外变体。新用途则新增独立案例目录与索引行。优先收录最终认可的图和少量有教学价值的决策，不复制所有草稿、截图与临时生成脚本。

同图更新时同步来源、尺寸、预览和仍适用的取舍；保留会改变后续判断的旧决策，标明已被替代。已有提交能定位的历史无需复制全部资产。变体在同一案例下用用途命名，并在说明里指出与主图的差异；不同解释目标再拆独立案例。当前平铺索引便于按用途查找，出现实际检索困难再分类，不提前建空目录。

用现有 `scripts/audit-svg.py` 检查新增源图；用 `scripts/render-svg.mjs` 在临时目录试渲染并查看，核对链接和图片尺寸。原样收录用户认可的 SVG／PNG 时保留原文件，试渲染不直接覆盖认可预览；字体环境差异写在案例说明里。

第三方资源内嵌于 SVG 时也记录来源与必要许可。品牌仅用于示例识别，不变成其他产品的默认素材。没有核实的图标记为用户提供或通用示意，不伪称官方标志。

新增通用方法前，检查已有绘图／渲染参考，避免在案例和 `SKILL.md` 重复维护。只有改变选择或执行的经验才提炼到方法文档；单例配色、固定数量和品牌名称保留在案例里。

当前宿主打包实现 `apps/server/src/infrastructure/ai/skill_bundle.ts` 限制单技能包不超过 **8 MiB、500 个文件**，会递归收录此目录并跳过 `node_modules` 等缓存。扩充案例时核对总体积，保留足以判断布局和字形的预览；接近上限时再选择精简、外置历史素材等做法，不为扩充案例直接修改宿主限制。
