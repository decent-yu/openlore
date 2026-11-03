---
name: svg-image-generator
description: 通过 SVG 生成图片：根据文字需求、文章或参考素材设计并绘制 SVG，再渲染为 PNG 图片。适用于文章配图、机制图、流程图、关系图和示意插画，也支持修改或转换已有 SVG；不用于写实照片生成或交互式网页。
metadata:
  type: illustration
  version: 1.2.0
---

# SVG 图片生成

根据文字需求、正文或参考素材设计画面，绘制 SVG，再生成可嵌入和分享的 PNG 图片。保留 SVG 作为可编辑源文件。已有 SVG 时也可直接修改或转换，并保留用户指定的内容与风格。

## 绘图

1. 从当前任务确定图片用途、要解释的关系和读者的阅读尺寸。已有正文、素材、尺寸或品牌要求时直接沿用；缺少的信息不影响表达时自主选择。
2. 需要新绘或改图时，阅读 [图形表达与 SVG 绘制](references/drawing-guide.md)。图型、画布、配色、字体和 SVG 技法由内容决定，不强制卡片布局、固定比例、节点数量或统一画风。事实关系和数值必须与素材一致，假设示意要标明。
3. 保存独立 SVG，设置明确的 `viewBox` 与宽高。使用本地可用字体或显式提供字体文件；外部图片嵌入为 data URI，避免依赖网页 CSS、远程字体或运行时脚本。

## 构图参考与反馈迭代

- 画产品生态、上下文或多组能力关系，或用户连续调整分组、间距和视觉重点时，阅读 [生态构图与反馈迭代](references/ecosystem-composition.md)。先稳定要表达的归属，再调整布局；保留已确认的内容、命名与素材。
- 解释某项功能怎样处理输入、形成产物、供不同角色使用，以及如何更新或处理冲突时，阅读 [功能设计图构图](references/feature-design-composition.md)。按主流程、读取视图和状态变化组织画面，避免直接套用生态图的环绕布局。
- 需要成熟图稿参考时，从 [案例索引](references/examples/index.md)选择相近案例，只加载对应说明并查看 PNG。案例用于借鉴关系表达和设计取舍，不是固定模板；不把某个案例的配色、四模块或星球风格变成默认要求。
- 用户要求沉淀新案例时，按案例索引中的目录约定保存源图、预览和决策说明，区分本例偏好与通用方法。普通绘图任务不自动写入案例库。

## 渲染与检查

以下路径相对于本 skill 目录，执行时先解析实际安装路径；输入、输出路径相对于调用命令的工作目录。

```bash
# 首次准备渲染依赖：Node.js >= 20，依赖只安装到本 skill 的 scripts/
npm ci --prefix <skill-dir>/scripts --no-audit --no-fund

# 检查 XML 与根元素；目录为空、文件格式错误时返回非零状态
python3 <skill-dir>/scripts/audit-svg.py output/assets

# 单图：默认按 SVG 尺寸的 2 倍渲染，保留透明背景
node <skill-dir>/scripts/render-svg.mjs output/assets/mechanism.svg

# 批量：递归处理目录，保留相对目录结构
node <skill-dir>/scripts/render-svg.mjs output/assets --output-dir output/assets
```

- 指定尺寸、背景、中文字体或排查渲染差异时，阅读 [渲染参数与排障](references/rendering-guide.md)。脚本支持 `--width`、`--height`、`--scale`、`--background`、重复 `--font` 和 `--font-family`。
- **实际查看生成的 PNG**，在正常阅读尺寸下检查文字缺字、换行、遮挡、裁切、箭头终点、图例和透明背景效果。XML 校验与导出成功不代表图已正确。修改 SVG 后重新渲染；目标 PNG 已存在时用 `--overwrite` 更新。
- 间距、数量和归属可用几何或结构检查验证：例如等半径与等角分布、每个功能连接所属模块。它们不能代替对标题宽度、留白和视觉层次的目视检查。
- 脚本不会自动更换渲染器或联网取图。缺少依赖、字体或不支持的特性时按参考文档修正；未生成并检查 PNG 就不能声称转换完成。

## 交付

沿用当前任务指定的产物目录；未指定时使用 `output/assets/`，保留同名 `.svg` 与 `.png`。正文默认引用 `![说明](./assets/mechanism.png)`；宿主任务明确要求 SVG 时遵循该要求，同时保留需要的 PNG。引用必须指向真实文件。

本 skill 只负责图形与转换，不规定文章结构、最终回复格式或调研流程。不把临时测试图片、安装依赖目录作为交付物。
