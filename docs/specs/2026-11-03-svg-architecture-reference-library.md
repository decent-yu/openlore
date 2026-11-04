# SVG 架构案例与可复用绘图方法

## Traceability

- Spec ID: svg-architecture-reference-library
- Status: Implemented
- Request: 将 BetterHarness 评审架构 SVG 及其调整经验纳入现有 svg-image-generator skill，并为后续优秀 SVG 保留清晰目录结构。

## Intent

在现有案例库中加入架构与跨系统协作图，帮助后续绘图任务选择系统上下文、静态分层或协作流程的合适表达。将可核实的演进决策与通用方法分开维护，避免把某张图的样式或未定方案变成默认规则。

## Acceptance Scenarios

- AC-1: 指定的 SVG 及配套 PNG 原样收录为独立案例，记录来源提交、尺寸、方案边界与字体限制；不收录未请求的 simple 草稿。
- AC-2: 案例说明按可见的四次提交解释从分层和阶段到独立阅读区、三泳道与宽版的变化；不虚构逐句对话或未核实的用户偏好。
- AC-3: SKILL.md 可按需路由到系统上下文／架构协作构图和反馈迭代方法，明确上下文边界、职责与时间顺序、请求响应及来源引用的画法；不要求所有图采用金字塔或三泳道。
- AC-4: 案例索引保留方法、说明、图稿与许可的单一职责，明确后续案例的收录、更新与证据约定；所有本地链接可解析，技能包仍在既有体积限制内。
- AC-5: 新源图通过 XML 校验，临时试渲染可打开并经目视核验；保留原 PNG 不以本机试渲染覆盖。若发现渲染语义差异，记录问题并提供有范围说明的最小兼容副本。skill 结构校验及差异检查通过。

## Non-goals

不修改 BetterHarness 运行代码或原图，不重绘、不引入新渲染器、不收录原始会话日志、不增加宿主打包限制，不推送或创建 PR。

## Plan and Tasks

- [x] 保留现有案例目录布局，新增 assessment 架构案例 SVG／PNG 与说明。
- [x] 新增系统上下文／架构协作及反馈迭代参考，调整入口和现有文档路由，避免重复维护。
- [x] 校验原件一致性、文档链接、技能元数据、包体积和 PNG 呈现，完成本地差异审查。

## Test and Review Evidence

AC-1/2：比对源文件哈希与提交 3c9c4fc、86bd3d2、47b3ed9、d99ef30；原始完整对话未取得，提交说明与实际图稿是本次决策摘要的证据。

AC-3/4：检查路由与新增相对链接，按去除 node_modules 的分发范围统计文件和字节，核对不重复和不误路由。

AC-5：执行现有 audit-svg.py、render-svg.mjs 和 skill-creator quick_validate.py；临时预览目视检查文字、泳道、请求响应和金字塔，检查 git diff 与 staged/unstaged 范围。

风险：中文使用系统字体回退，试渲染不保证跨机器逐像素一致；方案图不代表当前实现状态。AI 参与由本次 Codex 会话与提交 co-author 标记记录。没有用户提供的 Story／issue，不推断编号。

### 已执行验证

- AC-1/2：原 SVG 和 PNG 的 SHA-256 与 BetterHarness 本地原件一致；已打开四次提交说明与图稿差异，案例明确不是原始对话复现。
- AC-3/4：用 markdown-it-py 解析 Markdown 链接，46 个本地引用全部存在，10 份 references 文档均从 SKILL.md 可达。排除 node_modules 后共 27 文件、3,902,102 字节（3.72 MiB），小于已有 8 MiB／500 文件边界。
- AC-5：`python3 scripts/audit-svg.py assets/examples` 在 skill 目录检查 5 个 SVG，通过；解析后的新增源图 ID 唯一，内部引用均存在。
- AC-5：`render-svg.mjs --width 3600` 对原图和兼容图分别生成临时 PNG，均解码为 3600 × 1920；已查看原配套 PNG 与两次试渲染。原图的 auto-start-reverse 标记在 resvg 2.6.2 中朝向错误；仅用于 marker-end 的四个 orient 属性改为 auto 后方向恢复。兼容副本解析树除这四个属性外与原图一致，原配套 PNG 保留。
- AC-5：系统 Python 缺少 PyYAML，改用 `uv run --with pyyaml --with markdown-it-py --with pillow` 的临时环境执行 quick_validate.py，输出 `Skill is valid!`；未修改项目依赖。`git diff --check` 通过。

### Review Readiness Check

- 范围：skill 入口、方法／案例参考、原样资产与最小兼容副本，以及本 spec；没有运行代码、发布元数据或依赖改动。BetterHarness 源仓库的 simple 未跟踪文件保持原有状态。
- 证据：用户本次请求、四次来源提交、本 spec 的 AC-1 至 AC-5 和上述本地验证相互对应；未推断 Story 或远端 CI 状态。
- 风险：已记录字体回退、方案与实现的区别、完整对话不可用和渲染后端朝向差异。自动结构校验不能替代语义和目视检查，本次两者均已执行。
