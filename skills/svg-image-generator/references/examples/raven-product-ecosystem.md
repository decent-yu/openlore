# Raven 产品生态图

用一个共同核心解释产品形态与能力归属。适合“桌面产品 + 多种入口 + 多组功能／插件”的产品介绍；不是部署架构或请求流程图，不从节点位置推断执行主机、调用路径和上线状态。

[SVG 源图](../../assets/examples/raven-product-ecosystem/ecosystem.svg) · [PNG 预览](../../assets/examples/raven-product-ecosystem/ecosystem.png)

SVG：**3000 × 1600**；PNG：**6000 × 3200**。先查看预览，只有修改时才读取 SVG；源图中含较长的内嵌字体与品牌图像。

## 读者应理解的内容

Raven Desktop 是协同开发主场；Web、CLI、Mobile 是围绕共同核心的入口。外围按用户认知组织为四个模块，功能小球与所属模块之间的细线表示归属。

| 位置 | 模块 | 示例成员 |
| --- | --- | --- |
| 左上 | Plugin 集成 | Better Harness、Code Review、自动化测试、Meego、i讯飞、CI/CD、更多 Plugin |
| 右上 | 团队协作 | 产物共享、产物评审、任务交接、统一收件箱、缺陷处理 |
| 左下 | Harness 建设 | Skills／规则、协作流程、基线分发、Wiki／Memory |
| 右下 | 研发工具 | Git／Diff、文件、终端、Worktree、Claude Code、Codex、Gemini |

Plugin 集成是本图的产品能力分类；把 Meego 等放入这一组，不表示这些外部软件属于 Raven 的部署边界。AI 工具合并在研发工具中，是用户在本次介绍里选择的分组口径。

## 关键视觉决策

- 核心最大；入口和模块球同尺寸，模块为白球，入口为深色球；功能节点更小。名称与短描述放在球下，避免为容纳长标题扩大球体。
- Desktop 的圆心为 `(1500, 880)`。三个入口半径均为 `310`，角度 `-90° / 30° / 150°`，任意两入口球心间距约 `536.94`，避免只看“都在一个圈上”便认为等距。
- 四模块圆心为 `(940, 620)`、`(2060, 620)`、`(940, 1140)`、`(2060, 1140)`，与核心距离一致。功能小球在所属模块周边不等角、不等距散布，保持自然疏密。
- 入口和模块的可见半径为 `54`，普通功能球为 `32`，Better Harness 为 `40`，Desktop 为 `165`。这些数字用于理解本例尺度，不是通用模板参数。
- 保留唯一一条围绕产品入口的轨道；模块没有自己的轨道。23 条约 `0.9` 逻辑像素宽的线连接功能球与所属模块，线条终止在边缘，用遮罩避开标签。
- 横版通过重新布置坐标得到，球和图标始终等比。标题、正文、细线和光晕依次降低视觉权重，品牌图标保留原色。

## 从反馈中形成的取舍

这是设计决策摘要，不是全部聊天记录；前面的方案反映了探索过程，不是其他任务必须经历的步骤。

| 反馈／现象 | 调整 | 可复用判断 |
| --- | --- | --- |
| 原始 L1／L2／L3 资料太复杂，听众难理解 | 先简化成系统负责什么、解决什么问题；生态图另讲能力归属 | 一张图只承担一个主要解释目标 |
| 希望有品牌图标、像行星生态 | 搜索视觉参考，优先复用仓库图标 | 借鉴构图，不把参考图的品牌与关系搬进来 |
| 单一外圈把所有插件和能力混在一起 | 分清协作、Harness、AI、研发工具、插件与外部软件 | 先稳定分类，装饰不能替代信息结构 |
| 每组都有中心和圈，各组离得太远 | 去掉局部轨道，靠近共同核心散布 | 局部分组不能削弱整体核心 |
| 标题放大、加粗后过于抢眼，六组太分散 | 插件与外部软件合并；AI 与研发工具合并，改四角布局 | 合并相近类别，保留成员；字重不等于巨型字号 |
| 希望模块本身是球，后来觉得主球过大 | 采用 Web 同尺寸白色图标球，名称和说明移到球下 | 复用相邻节点的尺度，让文字位置释放球体空间 |
| 红色标记要求功能聚合与连接 | 收拢节点，添加细归属线，线条避让文字 | 把空间反馈变成坐标与归属变更 |
| 主球过近，三个产品入口看起来不等距 | 模块向外展开，三个入口按同半径、120° 排列 | 平移分组；用几何验证等距 |
| 希望图更宽、更矮 | 从竖向布局重排为 3000 × 1600 | 改坐标和画布，不压扁圆与字体 |
| 飞书协作换为 i讯飞；缺陷处理移到协作左下；主标题改为产品生态 | 定点替换素材与名称、移动成员并更新线条及遮罩 | 累积保留已确认的调整，不重置整图 |

本例保留了暗色星空、圆形图标、四角布局与精简描述，这是用户认可的表达选择；其他图可以采用白底、矩形、分层、横向或无轨道布局。可复用的方法见 [生态构图](../ecosystem-composition.md) 和 [反馈迭代与经验提炼](../feedback-iteration.md)。

## 来源与资源

原样收录自 `raven-pro` 仓库提交 `a38b520072`：

```text
docs/product/main/assets/ecosystem/raven-ecosystem-four-modules.svg
docs/product/main/assets/ecosystem/raven-ecosystem-four-modules.png
```

本案例对外名称为“Raven 产品生态图”，目录与文件不再用“四模块”作为身份。源图、预览未修改内容；没有收录黑盒系统上下文图。

源图中的品牌只用于识别案例对象，复用于其他项目时替换为其自己的名称、图标与语义。来源沿用原项目 `docs/product/main/assets/system-context-icons/README.md`：

| 内容 | 来源／说明 |
| --- | --- |
| Raven 标志 | 原项目 `resources/logo.svg` |
| Meego 图形 | [飞书项目官网](https://project.feishu.cn/)提供的完整 PNG 标志中的图形部分，保持比例 |
| i讯飞 | 用户在本次对话中提供的应用图标，裁去外围留白；未另行核验为官方分发资源 |
| Claude | [Claude 官网](https://claude.com/)声明的图标资源，表示 Claude Code 所属品牌 |
| Codex | 原项目沿用 OpenAI 标志，表示提供方，不是另行找到的 Codex 专用标志 |
| Gemini | [Google 官方图标](https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg)，为兼容导出先渲染为 PNG 后内嵌 |
| 通用图标 | 原项目已安装的 Lucide；Better Harness 盾牌是能力示意符号；[许可证](../../assets/examples/licenses/lucide.txt) |
| Geist | 源图已内嵌 WOFF2；[字体项目](https://github.com/vercel/geist-font)、[许可文本](../../assets/examples/licenses/geist-ofl.txt) |

本例使用的轨道视觉参考为 [Zight 集成图](https://zight.com/screenshot-app/)和 [Palantir AIP 中心构图](https://inspiration.vasa.works/item/slide-decks/palantir-q1-update-2023--slide-06)；实际图稿按 Raven 内容重新绘制。

## 渲染与验收

原预览已检查：四类保留 23 个功能节点，23 条连接线对应所属模块；三个入口等半径且两两距离相等；缺陷处理位于团队协作左下；主球大小与 Web 一致；所有图片内嵌。

PNG 为认可预览。SVG 内嵌拉丁字体和品牌图像，中文仍需本机字体回退，不能据此声称跨机器像素一致。试渲染到临时目录，避免覆盖认可图稿；需要时按 [渲染说明](../rendering-guide.md)传入本机中文字体与匹配的 family name。

```bash
python3 <skill-dir>/scripts/audit-svg.py <skill-dir>/assets/examples/raven-product-ecosystem
node <skill-dir>/scripts/render-svg.mjs \
  <skill-dir>/assets/examples/raven-product-ecosystem/ecosystem.svg \
  --output <temporary-dir>/ecosystem.png --width 3000
```
