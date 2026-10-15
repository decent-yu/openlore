# 内容 Skills 与文章资源设计

对应：[内容处理](../product/feature/03-content-processing.md)。本文件定义实现方案，不表示 skills 或下载器已经开发、安装或实际运行。

## Skill 是可版本化的处理规则

```text
src/openlore/skills/
├── article-organizer/SKILL.md    # 标签、导读、正文结构与图片占位
├── article-research/SKILL.md     # 一篇文章的深入分析、补充引用与证据
└── batch-digest/SKILL.md         # 可选批次简报
```

每个包还可携带固定模板、schema 和测试材料。首期由 OpenLore 提供内置包，工作区管理员可选择经过验证的版本；普通组引用既定版本，不根据抓取页面下载并执行第三方 skill。

官方说明：[Codex Skills](https://learn.chatgpt.com/docs/build-skills)、[Gemini CLI Skills](https://geminicli.com/docs/cli/skills/)。两者支持 Skill 工作流，但批处理不能依赖隐式匹配。OpenLore 默认显式读取 SKILL.md 和允许的模板，装载进任务指令，由本地 CLI 执行；未来原生激活路径须单独通过非交互验证。

SkillRequest 包含 task_id、skill_id/revision/hash、group_revision、output_options、primary_article_id（文章/研究必填且只有一个）、evidence_refs、asset_inventory、固定文档目标及 schema。

SkillResult 包含结构化文档区块、标签与标题建议、证据引用、asset_refs、缺口与状态。模型只能引用给定资源 ID；输出 Markdown 路径由应用映射，不能让模型任意写文件或自行决定移动目录。

文章整理保留原意，AI 导读有明显标识。研究以单篇为主体，可以交叉查验引用资料；简报只做本批阅读概览。关闭开关则不调对应 skill，也不生成空的 research.md/digest.md。

## 图片输入、输出与发现

`archive_assets(AssetRequest) -> AssetResult`。

- 输入：group_id、article_id、内容修订、已固定 article_directory、原始文档 URL、从正文发现的配图清单、单图/总字节预算。
- 输出：每张图的原始 URL 或内联来源、实际下载 URL、字节摘要、MIME、大小、blob_ref、文章内相对路径、成功/失败/超限状态；同时返回 Markdown 占位到本地路径的映射。
- 从原 HTML 的 img/srcset/picture、lazy-load 属性以及正文 Markdown 扫描资源；内联 SVG 保存为独立资源。资源发现必须在通用正文提取可能删掉 SVG 前完成，并保持正文位置关联。
- 抽取文章相关配图，保留图注、alt 和出处；只排除已识别的导航装饰、追踪像素、响应式同图重复项。无法判断是否正文配图时保留并标记，不能为了凑预算删图。

## 下载、复用与发布

1. 解析相对地址与重定向；仅访问合法 HTTP(S) 图片地址，data URI 解码入本地；拒绝内网目标及非图片可执行载荷。
2. 每张图片流式下载，校验实际 MIME/格式和字节上限，完整落盘后计算 SHA-256。GIF/WebP 等保留原格式；SVG 移除脚本、事件处理器和远端执行引用，不执行 SVG；仍需保留的嵌套图片依赖也归档并改为本地引用。若清理会导致图示不可用且无法安全还原，记录资源待处理，不发布损坏图。
3. 文件名为简短语义名 + hash12；同一文章同字节复用，遇到摘要前缀冲突使用更长摘要。两篇文章各自的 assets 独立，即使本地 blob store 底层去重。
4. 原图失败时可用页面展示版本并记录实际来源；所有选定配图尚未齐全时，文章为 pending_assets，禁止把远程 URL 当作已经归档。图片本地归档是本期固定策略，配置中的 archive_images 必须为 true，不提供仅保留外链的模式。单篇图默认 20 MiB、总 100 MiB，可调整，超限明确保留任务。
5. 重写 article.md/research.md 的图片引用为 `assets/...`。基于研究补充资料产生的配图也归该篇；未实际使用的参考页面装饰图片不下载。
6. 下载器和渲染器验证本地文件存在、格式正确、摘要匹配、无越界链接；图片与引用它的 Markdown 在同一提交中交付。

只包含 SVG 可视元素不意味着需要重新用 AI 绘图；默认保存实际原图。无法获得真实图片时不合成替代品，也不声称理解其内容。

## 身份与更新

CollectionIdentity 为 group_id + 日期序号；ArticleLocation 固定文章在首次采集批次中的位置。ResearchJob 唯一性至少为 group_id + article_id + content_revision + research_instruction_revision + skill_revision，不接受主文章数组。

普通原文变更更新原 article.md 与必要的新图片；旧 research.md 标注基于旧修订，启用研究时排队重算，成功后更新同一文件。研究关闭时保留原报告并显示其适用修订，不以旧报告冒充新结论。

改变开关仅影响新任务；对已归档某篇可显式补做研究。编号、路径与已生成文件包不会因开关或标题变更被重排。首期不自动删除旧图片，后续清理必须确认无当前引用。

## 验证矩阵

- 简报/研究四种开关组合：只在开启时产生文件；两篇文章的研究互不合并。
- 普通图片、相对图片、懒加载、srcset、内联 SVG、重复资源均正确归档；有图片必有本地 assets。
- 403、超时、损坏、单图/总量超限分别可见；另一篇完整文章继续交付。
- 模型返回不存在的图片/引用 ID、改写不当路径、混入原文的推断时校验失败并单次修复。
- Codex/Gemini 加载同版本 skill 均符合契约；更换 skill 修订只重跑受影响任务。
