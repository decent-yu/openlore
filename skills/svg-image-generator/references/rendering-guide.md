# 渲染参数与排障

## 环境与依赖

使用 Node.js >= 20、npm 和固定版本的 `@resvg/resvg-js`。包依赖与锁文件随 `scripts/` 分发，原生二进制由 npm 按运行平台安装，不需要浏览器。不要把某台机器的 `node_modules/` 复制到其他系统。

```bash
npm ci --prefix <skill-dir>/scripts --no-audit --no-fund
node <skill-dir>/scripts/render-svg.mjs --help
```

离线且尚未安装依赖时，说明缺少依赖，使用已有环境或准备离线包；脚本不会自动安装、切换后端或下载素材。依赖安装仅发生在上面的显式准备命令中。

实现依据：[resvg-js 用法](https://github.com/thx/resvg-js#usage)、[渲染与字体选项](https://github.com/thx/resvg-js/blob/v2.6.2/index.d.ts)。resvg 是静态 SVG 渲染器，不是浏览器排版引擎；[支持范围](https://github.com/linebender/resvg#svg-support)以实际版本及生成效果为准。

## 命令与输出规则

命令中的 `<skill-dir>` 是本 skill 的安装目录，不是当前输出目录。输入和输出参数使用当前工作目录解析；依赖从脚本所在目录加载，因此移动或分发整个 skill 后命令仍可用。

```bash
# 同目录生成 figure.png，默认 2 倍尺寸、透明背景
node <skill-dir>/scripts/render-svg.mjs output/assets/figure.svg

# 按宽度重新渲染，自动保持比例，明确指定目标文件
node <skill-dir>/scripts/render-svg.mjs output/assets/figure.svg \
  --output output/assets/figure.png --width 1800 --overwrite

# 批量递归：a/figure.svg → png/a/figure.png，不压平目录
node <skill-dir>/scripts/render-svg.mjs output/assets \
  --output-dir output/png --scale 2

# 加载中文字体；名称应使用字体内部的 family name
node <skill-dir>/scripts/render-svg.mjs output/assets/figure.svg \
  --font /path/to/NotoSansCJKsc-Regular.otf \
  --font /path/to/NotoSansCJKsc-Bold.otf \
  --font-family "Noto Sans CJK SC" --background '#ffffff' --overwrite
```

| 参数 | 行为 |
| --- | --- |
| `--output`, `-o` | 单文件的目标 PNG 路径；不得用于目录输入 |
| `--output-dir` | 批量输出根目录；也可用于单图，默认与源文件同目录 |
| `--width` / `--height` | 指定一个方向的正整数像素，另一个方向等比例计算 |
| `--scale` | 按 SVG 原始尺寸的正数倍数渲染；默认 `2` |
| `--background` | 设置 PNG 底色，如 `#ffffff`；不传则保留源图透明度 |
| `--font` | 加载字体文件，可重复传入；字体文件仍需自己准备 |
| `--font-family` | 设置未显式指定字体的文字及缺失字体的默认回退字体 |
| `--no-system-fonts` | 不加载系统字体；与显式字体文件一起用于跨机器保持一致 |
| `--overwrite` | 允许替换目标 PNG；默认目标已存在时失败 |

`--width`、`--height`、`--scale` 互斥。指定底色不会覆盖 SVG 内已经绘制的不透明背景。批量输入仅查找 `.svg`（扩展名不区分大小写），跳过符号链接和隐藏目录；没有 SVG 时失败。

成功时每个 PNG 输出一行 JSON，包含源文件、输出路径、宽高和字节数，便于记录。失败返回非零状态；如果批量执行在中途失败，已完成的 PNG 保留，修正后可用 `--overwrite` 重跑。`--overwrite` 只影响目标 PNG，不修改 SVG。

## 看图验收与排障

**以实际看图作为主要验收方式。** 下列脚本检查只辅助排查技术问题，不是完整的图片质量检查。

1. `python3 <skill-dir>/scripts/audit-svg.py <文件或目录>`：检查 XML 与 SVG 根元素；不判断图片的表达、布局或美观。
2. 执行渲染，确认产物存在、尺寸符合预期。
3. 用图像查看工具直接读取 PNG，或在真实浏览器中渲染并读取截图，实际识别图片内容。先按正文或幻灯片的正常显示宽度检查整体表达、阅读顺序、层次与留白，再按需放大检查字形、换行、遮挡、裁切、箭头与颜色。需要验证嵌入效果时，在实际目标页面中查看。
4. 发现问题，修改源 SVG，重新渲染并重新看图；逐张检查最终版本。无法查看实际图像时说明尚未完成视觉核验，不能因为命令成功或自动测试通过就认定图片合理。

| 现象 | 处理 |
| --- | --- |
| 提示无法加载渲染依赖 | 按当前平台重新执行 `npm ci --prefix <skill-dir>/scripts`，不要复制其他机器的二进制 |
| 中文缺字、方框、字宽变化 | 加载覆盖对应字符的中文字体，检查 SVG 的 family name，重新排版并查看 PNG |
| 设置粗体后没有变粗，或中英文字重差异明显 | 核对实际加载的 Regular／Bold 字体与 family name；变量字体或字体集合的名称匹配也需试渲染，不只检查 `font-weight` 数值 |
| 阴影、箭头、描边被裁切 | 检查 `viewBox`、留白与 filter 区域，修改源 SVG 后重渲染 |
| 箭头位置正确但方向没有跟随线段 | 对比原预览，检查 marker 的 `orient` 与实际切线。本次 resvg 2.6.2 对 `auto-start-reverse` 出现朝向错误，见 [评审架构案例](examples/raven-harness-assessment.md)。仅用于 `marker-end` 时可另存兼容副本改为 `auto` 并目视核对；若还用于 `marker-start`，需分别定义起点／终点标记并验证反向，不能全局替换后假定等价 |
| 文字挤在一起、超出节点 | 为 SVG 文字显式换行、调整文字位置或节点空间；不要只增加导出像素 |
| 图片缺失或提示外部图片 | 把图片嵌入 data URI；脚本拒绝未解析的外部图像，不主动联网取图 |
| 内嵌 SVG 图标在 PNG 中空白 | 单独渲染该图标，检查其内部的图片、裁剪与渐变；必要时只将这个图标转成 PNG 再内嵌，保留整张图的文字与图形为 SVG |
| 原浅色块变黑，或有颜色的文字／线条消失 | 检查 `oklch`、`color-mix` 等颜色语法是否被当前后端支持；可另存具体 sRGB 色值的兼容副本，保留原图与认可预览，重新渲染核对。命令成功不能证明颜色正确 |
| HTML、动画或网页样式未导出 | 改为静态 SVG 形状、文字和独立样式；PNG 不包含动画和交互 |
| 透明图在深色背景难以辨认 | 按用途设置明确底色或另绘适配深色的版本 |
| 不同机器结果不同 | 固定依赖、字体文件与 family name；必要时加 `--no-system-fonts`，不要仅依赖系统字体 |

## 脚本自检

准备依赖后运行：

```bash
python3 <skill-dir>/scripts/test-render.py
```

测试在临时目录中生成图像，检查单图、缩放、批量路径、透明/不透明像素、覆盖保护与错误输入；不会在产物目录留下测试图片。这些测试只验证脚本行为与有限的像素结果，不评价实际配图是否合理，不能替代逐张读取最终图片的视觉检查。
