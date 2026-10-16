# 产品文档规范

本目录维护 OpenLore 的产品目标、调研与功能定义。只写重点，按需组织。

功能入口：[功能与架构总览](feature/index.md)。前后端技术栈见 [docs/architecture/technology-stack.md](../architecture/technology-stack.md)；功能定义与代码实现统一归拢在 `docs/product/feature/`。

## 目录结构

```text
product/
├── README.md                 # 本规范
├── product-brief.md          # 产品目标、用户与整体范围
├── research/                 # 技术调研与方案依据（按 NN-topic 目录组织）
└── feature/                  # index 总览、NN-topic 功能定义、assets 图示、examples 样例
```

## 命名与组织

- 文件和目录使用小写英文与连字符，名称直接表达主题；正文使用中文。
- 调研与功能文件按递增编号与主题命名（如 `01-xxx.md`）。
- 方案探索与技术依据留在调研中；已确认的需求与行为进入功能文档。

## 维护原则

- **只写重点**：结论先行，描述具体场景和可验证行为，避免套话与冗余背景。
- **无历史包袱**：本项目为全新项目，按当前需求设计，无需保留兼容逻辑。
- **单点维护**：一项事实或规则尽量只维护一处，其他文档通过相对链接引用。
