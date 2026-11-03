# Raven Wiki 功能设计图

展示项目资料如何形成按功能组织的 Wiki，以及同一清单如何服务人与 Agent，并说明后续更新发布与冲突重核。适合功能方案说明、设计评审和机制介绍；不是产品全景、部署图或完整 UI 原型。

[SVG 源图](../../assets/examples/raven-wiki-feature/wiki-design.svg) · [PNG 预览](../../assets/examples/raven-wiki-feature/wiki-design.png)

SVG 和认可 PNG 均为 **2560 × 1460**。源图和预览原样收录，未重绘；先看 PNG，修改时再读 SVG。通用方法见 [功能设计图构图](../feature-design-composition.md)。

## 如何组织画面

左侧较宽，右侧较窄，通过一条竖向分隔线区分两条阅读路径：

| 区域 | 表达内容 | 作用 |
| --- | --- | --- |
| 左上主线 | 项目 Git → Agent + Skill → 同一份 Wiki 发布清单 | 把事实来源、整理方式与关键产物串起来 |
| 清单内部 | 项目概览、系统架构、按功能点组织的索引 | 按任务与业务功能理解资料，而非原封不动复制 Git 文件树 |
| 左下两视图 | 云端 Wiki 给人看；`./raven/wiki/` 给 AI | 用不同阅读方式呈现同一份内容与引用 |
| 右侧竖排 | 触发 → 拉取基线 → 增量提交 → 服务端校验 → 发布／冲突 | 把更新机制放在侧栏，不打断主过程 |

清单卡片浅蓝、云端视图浅蓝标题条、AI 视图浅紫标题条，其余多为白色与中性灰。Agent + Skill 用白底与紫色图标／文字强调。颜色服务于对象区分，左上主线和右侧步骤仍靠位置、标题与箭头表达顺序。

## 值得复用的语义细节

- **同一清单、两种视图**：P7 同时出现在清单、云端和本地读取处；两个视图的评审页面都标注 Artifact v4。共享关系通过共同来源、分支线与相同标识一起表达，不只是画两个相似面板。
- **原文与派生资料分开**：Git 保存代码、ADR、Spec 和测试；Agent 按 Skill 整理功能说明。Wiki 清单记录说明页、原文路径与 Artifact 版本，没有把 Wiki 说成另一份原文仓库。
- **人和 Agent 的读取不同**：云端为导航与正文示意；AI 为 `wiki.json`、`INDEX.md`、`content/`、`assets/`。原文在本地按路径读取，例子为 `docs/review/spec.md`，图内明确“不下载原文快照”。
- **发布与来源分开**：P6／P7 是编辑／发布清单，C20／C21 是项目来源提交，Artifact v4 是页面资源版本；这些编号均为示例，不是实际系统当前版本。
- **提交与发布分开**：完整清单与新增／变化文件一起提交，未变化页面复用资源版本；服务端验证基线与来源后，维护者或已配置自动化发布。冲突保留草稿并重核，旧任务不能覆盖新发布。
- **回路落到正确对象**：成功发布返回清单入口；冲突分支拉取新 Wiki 重新核对。右侧侧栏并非一条无条件走到成功的直线。

复用时保留自己功能的真实语义；不强制画成左宽右窄、双视图、文件树或用上述编号。是否需要这些结构，取决于要讲的功能关系。

## 来源与边界

来自 `raven-pro` 仓库提交 `dbb698020ee4c18d9e968e7963a71a519a449dc4` 的以下图稿：

```text
docs/product/main/assets/feature/wiki/raven-wiki-main-design.svg
docs/product/main/assets/feature/wiki/raven-wiki-main-design.png
```

说明依据同仓库 `docs/product/main/wiki-detailed-design.md` 与图稿目录说明。它是含待建设能力的目标方案图，不作为真实环境联调、功能上线或并发测试的证据。本次没有该图绘制时的完整对话，因此不编造反馈历史。

图标复用原项目的 Lucide 并直接内嵌 SVG 节点；[Lucide 许可证](../../assets/examples/licenses/lucide.txt)。Geist WOFF2 已内嵌；[字体许可证](../../assets/examples/licenses/geist-ofl.txt)。中文仍需可用字体回退，不声称在所有机器上逐像素一致。

源图采用 `oklch(...)` 与 `color-mix(...)`。本次使用技能固定版本的 resvg 试渲染时，浅色表面变黑、彩色文字与连线丢失，因此**不能直接用原 SVG 在该后端导出并覆盖认可 PNG**。

另附 [颜色兼容 SVG](../../assets/examples/raven-wiki-feature/wiki-design-compatible.svg)：只将颜色表达式转换为具体 sRGB 十六进制值，布局、文字、版本、图标和字体内容均与原 SVG 一致。OKLCH 经 OKLab／线性 sRGB 转换后编码为 sRGB；`color-mix(in srgb, …, white)` 按给定比例混合。此例转换的颜色在 sRGB 范围内；其他颜色若超出范围，需选定色域映射方法，不能盲目裁切。转换到 8 位颜色会有舍入差异，预览仍以原认可 PNG 为准。相关排障见 [渲染参数与排障](../rendering-guide.md)。

```bash
python3 <skill-dir>/scripts/audit-svg.py <skill-dir>/assets/examples/raven-wiki-feature
node <skill-dir>/scripts/render-svg.mjs \
  <skill-dir>/assets/examples/raven-wiki-feature/wiki-design-compatible.svg \
  --output <temporary-dir>/wiki-design.png --width 2560
```
