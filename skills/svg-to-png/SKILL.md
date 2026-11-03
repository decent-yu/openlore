---
name: svg-to-png
description: 根据内容绘制可编辑的 SVG 配图，并渲染、检查和交付 PNG。适用于文章、研报、演示文稿中的机制图、流程图、关系图、示意插画，以及已有 SVG 的单图或批量转 PNG；不用于写实照片生成或交互式网页。
metadata:
  type: illustration
  version: 1.0.0
---

# SVG 绘图与 PNG 导出

把 SVG 作为可编辑源文件，把 PNG 作为便于嵌入和分享的成品。既可以从需求绘图，也可以直接转换已有 SVG；后者保留用户原有内容与风格。

## 绘图

1. 从当前任务确定图片用途、要解释的关系和读者的阅读尺寸。已有正文、素材、尺寸或品牌要求时直接沿用；缺少的信息不影响表达时自主选择。
2. 需要新绘或改图时，阅读 [图形表达与 SVG 绘制](references/drawing-guide.md)。图型、画布、配色、字体和 SVG 技法由内容决定，不强制卡片布局、固定比例、节点数量或统一画风。事实关系和数值必须与素材一致，假设示意要标明。
3. 保存独立 SVG，设置明确的 `viewBox` 与宽高。使用本地可用字体或显式提供字体文件；外部图片嵌入为 data URI，避免依赖网页 CSS、远程字体或运行时脚本。

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
- 脚本不会自动更换渲染器或联网取图。缺少依赖、字体或不支持的特性时按参考文档修正；未生成并检查 PNG 就不能声称转换完成。

## 交付

沿用当前任务指定的产物目录；未指定时使用 `output/assets/`，保留同名 `.svg` 与 `.png`。正文默认引用 `![说明](./assets/mechanism.png)`；宿主任务明确要求 SVG 时遵循该要求，同时保留需要的 PNG。引用必须指向真实文件。

本 skill 只负责图形与转换，不规定文章结构、最终回复格式或调研流程。不把临时测试图片、安装依赖目录作为交付物。
