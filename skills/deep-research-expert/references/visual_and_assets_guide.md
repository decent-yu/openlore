# 视觉图表与结构化交付物设计指南 (Visual & Assets Guide)

在高级技术文章中，**图表不是文字的陪衬，而是认知降载的主力武器**。读者在扫读文章时，往往先通过图表和交付物决定是否精读全文。

## 1. 核心红线：全量独立 SVG 原生化规范

> [!IMPORTANT]
> **【强制硬性要求】所有图表一律采用独立原生 SVG 呈现**\
> 严禁在最终交付的技术文章中保留原始内联 Mermaid 代码块或 ASCII 文本字符图。所有架构拓扑图、时序图、状态机、对比图必须设计并渲染为独立的 `.svg` 矢量文件，统一部署在当前文章同级的 `assets/` 目录下，并通过 Markdown 纯净语法 `![](./assets/xxx.svg)` 引用。

### 1.1 纯净渲染与去除冗余注释
- **图片**：直接使用 `![](./assets/xxx.svg)` 渲染。**严禁在图片下方附加“图 1：xxx —— xxx \n 来源：xxx”等冗长的学术注脚或来源说明**。SVG 图像本身应当具备完整的自解释性（包括标题、图例与说明）。
- **表格**：直接渲染清晰的 Markdown 表格，**严禁在表格上方附加生硬的“表 1：xxx”文本行**。
- **【强制红线】SVG 标题规范（统一水平居中 + 严禁英文小标签）**：
  - **水平居中**：SVG 顶部主标题与副标题必须一律采用水平居中对齐（`text-anchor="middle"`，`x` 设置为画布宽度中轴 `W/2`），确保全幅画面对称平稳；
  - **零英文标签**：主标题上方**严禁放置任何英文分类标签或小胶囊**（例如 `PARADIGM SHIFT`、`DELIVERY PIPELINE`、`EFFICIENCY PARADOX` 等）。标题区必须干净、直白，直接展示中文主标题与副标题，视觉焦点坚决聚焦于核心业务拓扑与工程流转本身。

### 1.2 配图数量与结构化分布
- **多图矩阵（生成 2～4 张互补 SVG）**：深度研报必须根据论述脉络生成 **2～4 张原生独立 SVG 矢量图**，放置于 `assets/` 目录。图表必须分工明确、互为补充：
  - **图 1 · 架构拓扑 / 全链路流转**：勾勒宏观分层架构、核心组件与流转边界；
  - **图 2 · 多方案对比矩阵 / 选型雷达**：横向并列对比 2～3 种对标方案的核心机制、吞吐与运维代价；
  - **图 3 · 状态机 / 容灾自愈 / 时序流**：展示关键状态生命周期、故障降级路径或模块调用时序；
  - **图 4（可选）· 决策排障树 / 性能度量**：生产选型决策流或关键参数量化关系。
- **先叙述后引图**：正文必须先阐明问题、推论或数据，再自然引出配图，严禁无前兆突兀插入。
- **避免堆叠**：图表应均匀分布在关键论点推导处（如架构剖析节、方案对比节、容灾分析节各一张），严禁在前两节集中堆放。

## 2. 现代工程级 SVG 设计美学与绘制指南

如何让手绘或生成的 SVG 具备顶尖大厂（Stripe, GitHub, Cloudflare, Linear）的工程高级感？必须遵循以下五大视觉设计系统：

### 2.1 画布基底与视口系统 (Canvas & ViewBox)
- **统一黄金画幅**：标准采用 16:9 宽屏视口 `viewBox="0 0 1600 900"`（可根据纵向内容自适应为 `1600 800` 或 `1600 1000`），保证在大屏与移动端等比例缩放不失真。
- **呼吸感边距**：画布四周必须保留至少 **60px ~ 80px** 的安全内边距（Padding），绝对禁止图形元素贴边。
- **高级底色微渐变**：画布底色使用中性极浅的微渐变，替代刺眼的纯白底：
  ```xml
  <linearGradient id="bg-canvas" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#f8fafc"/>
    <stop offset="100%" stop-color="#f1f5f9"/>
  </linearGradient>
  <rect width="1600" height="900" fill="url(#bg-canvas)"/>
  ```

### 2.2 现代化调色盘系统 (Color Palette)
严禁使用高饱和度的大红大绿，采用低饱和、高辨识度的现代工程师色盘（以 Slate 中性灰为底）：

| 语义层级 | 背景填充 (Fill) | 细边框描边 (Stroke) | 强调文本/标题 (Text) | 典型工程场景 |
| :--- | :--- | :--- | :--- | :--- |
| **画布基底** | `#f8fafc` (Slate-50) | `#e2e8f0` (Slate-200) | `#0f172a` (Slate-900) | 全局视口底色、大容器外框 |
| **输入/人类端** | `#eff6ff` (Blue-50) | `#bfdbfe` (Blue-200) | `#1d4ed8` (Blue-700) | 需求定义、Issue 合同、人类操作 |
| **执行/引擎端** | `#f5f3ff` (Violet-50) | `#c4b5fd` (Violet-300) | `#6d28d9` (Violet-700) | AI Agent 运行时、调度器、沙箱 |
| **阻断/收件箱** | `#fff7ed` (Orange-50) | `#fdba74` (Orange-300) | `#ea580c` (Orange-600) | 异常挂起、方案决策卡、待办审批 |
| **成功/验证门禁** | `#f0fdf4` (Emerald-50) | `#86efac` (Emerald-300) | `#166534` (Emerald-800) | 测试通过、部署上线、合入主干 |
| **硬拦截/高危** | `#fef2f2` (Red-50) | `#fca5a5` (Red-300) | `#dc2626` (Red-600) | 删库拦截、越权警告、故障回滚 |

### 2.3 视觉纵深感与层次结构 (Depth & Geometry)
1. **轻量双层弥散阴影**：通过 SVG Filter 赋予卡片悬浮质感，严禁生硬浓黑的投影：
   ```xml
   <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="125%">
     <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.06"/>
     <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.04"/>
   </filter>
   ```
2. **多层圆角与线宽层次**：
   - 外层大卡片：`rx="16"` 到 `rx="20"`，`stroke-width="1.5"`；
   - 内层功能模块：`rx="10"` 到 `rx="12"`，`stroke-width="1"`；
   - 状态药丸徽章（Badges）：`rx="6"` 到 `rx="8"`；
3. **卡片嵌套结构（Card-in-Card）**：采用大容器包裹子模块（如：`阶段外框` -> `步骤卡` -> `状态徽章`），杜绝散落凌乱的浮动元素。

### 2.4 字体阶梯与排线系统 (Typography & Connectors)
- **字体栈**：优先调用跨平台原生平滑字体：
  `font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"`
- **字阶规范**：
  - SVG 主标题：`font-size="32"` ~ `36`，`font-weight="800"`，`fill="#0f172a"`
  - 副标题/说明：`font-size="15"` ~ `16`，`font-weight="400"`，`fill="#64748b"`
  - 模块大标题：`font-size="20"` ~ `22`，`font-weight="700"`，`fill="#0f172a"`
  - 子卡片正文：`font-size="12"` ~ `13`，`font-weight="500"`，`fill="#475569"`
- **箭头与连线**：
  - 定义色彩明确的 `<marker id="arrow-..." refX="7" refY="3.5">`；
  - 正向推进采用实线 `stroke-width="2.5"`；异步通知与回流反哺采用虚线 `stroke-dasharray="6,6"`。

## 3. 生产级 SVG 模板示例与组件库

### 3.1 三阶段流转标准卡片式 SVG 骨架范式

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-labelledby="t d">
  <title id="t">架构流转拓扑</title>
  <desc id="d">展示现代化卡片式架构设计范式</desc>
  <defs>
    <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.06"/>
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.04"/>
    </filter>
    <marker id="arrow-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <polygon points="0 0, 7 3, 0 6" fill="#3b82f6"/>
    </marker>
    <marker id="arrow-violet" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <polygon points="0 0, 7 3, 0 6" fill="#8b5cf6"/>
    </marker>
    <linearGradient id="bg-canvas" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#f1f5f9"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#bg-canvas)"/>

  <!-- 居中主标题区 -->
  <g font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <text x="800" y="80" text-anchor="middle" font-size="34" font-weight="800" fill="#0f172a">系统核心架构与分阶段流转拓扑</text>
    <text x="800" y="115" text-anchor="middle" font-size="16" fill="#64748b">从需求标准化定义、无人值守批处理执行到异常阻断与生产交付闭环</text>
  </g>

  <!-- 阶段 1 卡片 (x: 80, width: 440) -->
  <g filter="url(#card-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="80" y="160" width="440" height="660" rx="20" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5"/>
    <rect x="80" y="160" width="440" height="8" rx="4" fill="#3b82f6"/>
    <rect x="110" y="195" width="200" height="32" rx="8" fill="#eff6ff" stroke="#bfdbfe"/>
    <text x="210" y="216" text-anchor="middle" font-size="13" font-weight="700" fill="#1d4ed8">阶段一 · 契约输入</text>
    <text x="110" y="260" font-size="20" font-weight="700" fill="#0f172a">标准化需求与环境对齐</text>
    <text x="110" y="285" font-size="14" fill="#64748b">消除歧义，固化机器可断言的测试规格</text>

    <!-- 内部卡片 -->
    <rect x="110" y="320" width="380" height="130" rx="12" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="135" y="355" font-size="16" font-weight="700" fill="#1e293b">1. 契约标准化解耦</text>
    <text x="135" y="385" font-size="13" fill="#475569">• 将上游异构输入转化为不可变上下文</text>
    <text x="135" y="410" font-size="13" fill="#475569">• 明确边界条件与验收不变量 (Invariants)</text>
  </g>

  <!-- 阶段 2 卡片 (x: 580, width: 440) -->
  <g filter="url(#card-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="580" y="160" width="440" height="660" rx="20" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5"/>
    <rect x="580" y="160" width="440" height="8" rx="4" fill="#8b5cf6"/>
    <rect x="610" y="195" width="200" height="32" rx="8" fill="#f5f3ff" stroke="#c4b5fd"/>
    <text x="710" y="216" text-anchor="middle" font-size="13" font-weight="700" fill="#6d28d9">阶段二 · 调度引擎</text>
    <text x="610" y="260" font-size="20" font-weight="700" fill="#0f172a">异步沙箱批量跑批</text>
    <text x="610" y="285" font-size="14" fill="#64748b">基于租约状态机驱动的无缝离线流转</text>

    <!-- 内部卡片 -->
    <rect x="610" y="320" width="380" height="130" rx="12" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="635" y="355" font-size="16" font-weight="700" fill="#1e293b">2. 故障自愈与断点重放</text>
    <text x="635" y="385" font-size="13" fill="#475569">• WAL 状态机保证节点宕机零丢数据</text>
    <text x="635" y="410" font-size="13" fill="#475569">• 超时自动重试与退避限流机制</text>
  </g>

  <!-- 阶段 3 卡片 (x: 1080, width: 440) -->
  <g filter="url(#card-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="1080" y="160" width="440" height="660" rx="20" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5"/>
    <rect x="1080" y="160" width="440" height="8" rx="4" fill="#10b981"/>
    <rect x="1110" y="195" width="200" height="32" rx="8" fill="#f0fdf4" stroke="#86efac"/>
    <text x="1210" y="216" text-anchor="middle" font-size="13" font-weight="700" fill="#166534">阶段三 · 交付门禁</text>
    <text x="1110" y="260" font-size="20" font-weight="700" fill="#0f172a">生产级质量断言</text>
    <text x="1110" y="285" font-size="14" fill="#64748b">全量自动化测试通过后直接挂入交付队列</text>

    <!-- 内部卡片 -->
    <rect x="1110" y="320" width="380" height="130" rx="12" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="1135" y="355" font-size="16" font-weight="700" fill="#1e293b">3. 产物不可变发布</text>
    <text x="1135" y="385" font-size="13" fill="#475569">• 严格哈希校验保障版本幂等</text>
    <text x="1135" y="410" font-size="13" fill="#475569">• 零污染直接沉淀为团队知识资产</text>
  </g>

  <!-- 连接线：阶段 1 -> 阶段 2 (独立 <line>，防断裂) -->
  <line x1="520" y1="490" x2="574" y2="490" stroke="#3b82f6" stroke-width="2.5" marker-end="url(#arrow-blue)"/>

  <!-- 连接线：阶段 2 -> 阶段 3 (独立 <line>，防断裂) -->
  <line x1="1020" y1="490" x2="1074" y2="490" stroke="#8b5cf6" stroke-width="2.5" marker-end="url(#arrow-violet)"/>
</svg>
```

### 3.2 多方案架构横向对比卡片范式 (Side-by-Side Comparison Matrix)

当深度调研涉及方案选型或代际演进对比时，采用双栏/三栏并列对比卡片，从机制、吞吐与运维成本等维度直观呈现差异：

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-labelledby="t-cmp d-cmp">
  <title id="t-cmp">技术方案核心机制与权衡对比</title>
  <desc id="d-cmp">并列展示方案A与方案B在架构拓扑、吞吐性能与心智成本维度的对比</desc>
  <defs>
    <filter id="cmp-shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.05"/>
      <feDropShadow dx="0" dy="1" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.03"/>
    </filter>
    <linearGradient id="cmp-bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#f1f5f9"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#cmp-bg)"/>

  <!-- 居中标题 -->
  <g font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <text x="800" y="75" text-anchor="middle" font-size="34" font-weight="800" fill="#0f172a">核心架构方案横向多维对比</text>
    <text x="800" y="110" text-anchor="middle" font-size="16" fill="#64748b">从调度机制、吞吐能力、故障边界到运维心智负担的客观权衡</text>
  </g>

  <!-- 方案 A 卡片 (左栏: x: 80, width: 690) -->
  <g filter="url(#cmp-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="80" y="150" width="690" height="680" rx="18" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
    <rect x="80" y="150" width="690" height="6" rx="3" fill="#3b82f6"/>
    <rect x="110" y="180" width="160" height="30" rx="8" fill="#eff6ff" stroke="#bfdbfe"/>
    <text x="190" y="200" text-anchor="middle" font-size="13" font-weight="700" fill="#1d4ed8">方案 A · 传统轮询</text>
    <text x="110" y="245" font-size="22" font-weight="700" fill="#0f172a">单体数据库轮询架构</text>
    <text x="110" y="270" font-size="14" fill="#64748b">简单易维护，但受制于数据库连接与锁竞争瓶颈</text>

    <!-- 维度行 1 -->
    <rect x="110" y="300" width="630" height="95" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="135" y="330" font-size="15" font-weight="700" fill="#334155">吞吐量与调度延迟</text>
    <text x="135" y="358" font-size="13" fill="#475569">• 极限吞吐约为 500 QPS，秒级轮询间隔存在天然调度延迟</text>
    <text x="135" y="380" font-size="13" fill="#dc2626">• 高并发场景下数据库 CPU 占用容易被空轮询打满</text>

    <!-- 维度行 2 -->
    <rect x="110" y="410" width="630" height="95" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="135" y="440" font-size="15" font-weight="700" fill="#334155">一致性与容灾恢复</text>
    <text x="135" y="468" font-size="13" fill="#475569">• 基于事务状态天然幂等，节点宕机重启后自动认领断点任务</text>
    <text x="135" y="490" font-size="13" fill="#166534">• 零额外中间件依赖，数据库主从切换即为最高容灾保障</text>

    <!-- 维度行 3 -->
    <rect x="110" y="520" width="630" height="95" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="135" y="550" font-size="15" font-weight="700" fill="#334155">团队落地心智成本</text>
    <text x="135" y="578" font-size="13" fill="#166534">• 极低：普通工程师半天内即可看懂完整状态流转</text>
    <text x="135" y="600" font-size="13" fill="#475569">• 调试仅需查看单表记录，排障与回溯成本趋近于零</text>

    <!-- 选型判定徽章 -->
    <rect x="110" y="640" width="630" height="60" rx="10" fill="#eff6ff" stroke="#bfdbfe"/>
    <text x="135" y="675" font-size="14" font-weight="700" fill="#1d4ed8">适用结论：适合任务量低于 100 QPS、更关注运维极简的中小团队日常业务</text>
  </g>

  <!-- 方案 B 卡片 (右栏: x: 830, width: 690) -->
  <g filter="url(#cmp-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="830" y="150" width="690" height="680" rx="18" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
    <rect x="830" y="150" width="690" height="6" rx="3" fill="#10b981"/>
    <rect x="860" y="180" width="160" height="30" rx="8" fill="#f0fdf4" stroke="#86efac"/>
    <text x="940" y="200" text-anchor="middle" font-size="13" font-weight="700" fill="#166534">方案 B · 事件驱动</text>
    <text x="860" y="245" font-size="22" font-weight="700" fill="#0f172a">分布式事件总线架构</text>
    <text x="860" y="270" font-size="14" fill="#64748b">高吞吐低延迟，但对中间件高可用与幂等治理要求严格</text>

    <!-- 维度行 1 -->
    <rect x="860" y="300" width="630" height="95" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="885" y="330" font-size="15" font-weight="700" fill="#334155">吞吐量与调度延迟</text>
    <text x="885" y="358" font-size="13" fill="#166534">• 支持 50,000+ QPS 峰值突增，端到端延迟缩短至 5ms 以内</text>
    <text x="885" y="380" font-size="13" fill="#475569">• 事件推送彻底杜绝空轮询对系统计算资源的浪费</text>

    <!-- 维度行 2 -->
    <rect x="860" y="410" width="630" height="95" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="885" y="440" font-size="15" font-weight="700" fill="#334155">一致性与容灾恢复</text>
    <text x="885" y="468" font-size="13" fill="#475569">• 需建立严苛的消费者 ACK、死信队列与重复消息去重表</text>
    <text x="885" y="490" font-size="13" fill="#dc2626">• 跨服务事件链路追踪需要引入全局 TraceId 与 OpenTelemetry</text>

    <!-- 维度行 3 -->
    <rect x="860" y="520" width="630" height="95" rx="10" fill="#f8fafc" stroke="#e2e8f0"/>
    <text x="885" y="550" font-size="15" font-weight="700" fill="#334155">团队落地心智成本</text>
    <text x="885" y="578" font-size="13" fill="#dc2626">• 较高：必须掌握分区再均衡、消息堆积告警与脑裂排查能力</text>
    <text x="885" y="600" font-size="13" fill="#475569">• 基础设施多出 MQ 集群，需要配置专属监控大盘与告警通道</text>

    <!-- 选型判定徽章 -->
    <rect x="860" y="640" width="630" height="60" rx="10" fill="#f0fdf4" stroke="#86efac"/>
    <text x="885" y="675" font-size="14" font-weight="700" fill="#166534">适用结论：适合超大规模分布式链路、高频异步解耦与对毫秒级响应苛刻的场景</text>
  </g>
</svg>
```

### 3.3 核心状态转移与异常自愈流转范式 (State Machine & Fallback Cycle)

当调研涵盖任务调度、长事务、工作流引擎或 AI Agent 执行生命周期时，采用清晰的状态流转图展示正向流程、异常挂起与回滚重试机制：

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-labelledby="t-sm d-sm">
  <title id="t-sm">核心状态机与异常自愈机制</title>
  <desc id="d-sm">展示任务全生命周期的状态转换、租约续期、超时熔断与自愈回滚闭环</desc>
  <defs>
    <filter id="sm-shadow" x="-8%" y="-8%" width="116%" height="120%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.06"/>
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.04"/>
    </filter>
    <marker id="arr-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <polygon points="0 0, 7 3, 0 6" fill="#3b82f6"/>
    </marker>
    <marker id="arr-green" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <polygon points="0 0, 7 3, 0 6" fill="#10b981"/>
    </marker>
    <marker id="arr-orange" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <polygon points="0 0, 7 3, 0 6" fill="#f97316"/>
    </marker>
    <marker id="arr-red" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <polygon points="0 0, 7 3, 0 6" fill="#ef4444"/>
    </marker>
    <linearGradient id="sm-bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#f1f5f9"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#sm-bg)"/>

  <!-- 居中标题 -->
  <g font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <text x="800" y="75" text-anchor="middle" font-size="34" font-weight="800" fill="#0f172a">核心状态转移与异常熔断自愈闭环</text>
    <text x="800" y="110" text-anchor="middle" font-size="16" fill="#64748b">基于排他租约与重试退避的状态机生命周期演进模型</text>
  </g>

  <!-- 状态 1: QUEUED (就绪排队) -->
  <g filter="url(#sm-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="100" y="240" width="280" height="220" rx="16" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
    <rect x="100" y="240" width="280" height="6" rx="3" fill="#64748b"/>
    <rect x="125" y="265" width="130" height="28" rx="6" fill="#f1f5f9" stroke="#cbd5e1"/>
    <text x="190" y="284" text-anchor="middle" font-size="12" font-weight="700" fill="#475569">状态 01 · 初始入队</text>
    <text x="125" y="325" font-size="22" font-weight="800" fill="#0f172a">QUEUED</text>
    <text x="125" y="355" font-size="13" fill="#64748b">• 校验请求签名与参数</text>
    <text x="125" y="380" font-size="13" fill="#64748b">• 写入持久化 WAL 队列</text>
    <text x="125" y="405" font-size="13" fill="#64748b">• 等待 Worker 抢占租约</text>
  </g>

  <!-- 状态 2: RUNNING (执行中) -->
  <g filter="url(#sm-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="480" y="240" width="300" height="220" rx="16" fill="#ffffff" stroke="#93c5fd" stroke-width="2"/>
    <rect x="480" y="240" width="300" height="6" rx="3" fill="#3b82f6"/>
    <rect x="505" y="265" width="130" height="28" rx="6" fill="#eff6ff" stroke="#bfdbfe"/>
    <text x="570" y="284" text-anchor="middle" font-size="12" font-weight="700" fill="#1d4ed8">状态 02 · 独占执行</text>
    <text x="505" y="325" font-size="22" font-weight="800" fill="#0f172a">RUNNING</text>
    <text x="505" y="355" font-size="13" fill="#64748b">• 锁定排他租约 (Lease)</text>
    <text x="505" y="380" font-size="13" fill="#64748b">• 周期性心跳保活 (Heartbeat)</text>
    <text x="505" y="405" font-size="13" fill="#64748b">• 沙箱内执行任务与产物写入</text>
  </g>

  <!-- 状态 3: SUCCESS (成功归档) -->
  <g filter="url(#sm-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="880" y="240" width="280" height="220" rx="16" fill="#ffffff" stroke="#86efac" stroke-width="1.5"/>
    <rect x="880" y="240" width="280" height="6" rx="3" fill="#10b981"/>
    <rect x="905" y="265" width="130" height="28" rx="6" fill="#f0fdf4" stroke="#86efac"/>
    <text x="970" y="284" text-anchor="middle" font-size="12" font-weight="700" fill="#166534">状态 03 · 验证通过</text>
    <text x="905" y="325" font-size="22" font-weight="800" fill="#0f172a">SUCCEEDED</text>
    <text x="905" y="355" font-size="13" fill="#64748b">• 产物哈希比对与不可变固化</text>
    <text x="905" y="380" font-size="13" fill="#64748b">• 释放 Worker 资源与租约</text>
    <text x="905" y="405" font-size="13" fill="#64748b">• 触发下游通知与知识归档</text>
  </g>

  <!-- 状态 4: RETRY / BACKOFF (异常退避重试) -->
  <g filter="url(#sm-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="480" y="560" width="300" height="200" rx="16" fill="#ffffff" stroke="#fed7aa" stroke-width="1.5"/>
    <rect x="480" y="560" width="300" height="6" rx="3" fill="#f97316"/>
    <rect x="505" y="585" width="140" height="28" rx="6" fill="#fff7ed" stroke="#fed7aa"/>
    <text x="575" y="604" text-anchor="middle" font-size="12" font-weight="700" fill="#c2410c">自愈分支 · 优雅退避</text>
    <text x="505" y="640" font-size="22" font-weight="800" fill="#0f172a">RETRYING</text>
    <text x="505" y="670" font-size="13" fill="#64748b">• 指数退避加随机抖动 (Jitter)</text>
    <text x="505" y="695" font-size="13" fill="#64748b">• 重置执行环境并清理孤儿文件</text>
    <text x="505" y="720" font-size="13" fill="#64748b">• 重试计数器判定 (Count &lt; 3)</text>
  </g>

  <!-- 状态 5: FAILED / DEAD_LETTER (最终失败/死信) -->
  <g filter="url(#sm-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="1220" y="240" width="280" height="220" rx="16" fill="#ffffff" stroke="#fca5a5" stroke-width="1.5"/>
    <rect x="1220" y="240" width="280" height="6" rx="3" fill="#ef4444"/>
    <rect x="1245" y="265" width="130" height="28" rx="6" fill="#fef2f2" stroke="#fca5a5"/>
    <text x="1310" y="284" text-anchor="middle" font-size="12" font-weight="700" fill="#991b1b">终态异常 · 熔断隔离</text>
    <text x="1245" y="325" font-size="22" font-weight="800" fill="#0f172a">FAILED</text>
    <text x="1245" y="355" font-size="13" fill="#64748b">• 记录现场堆栈与诊断信息</text>
    <text x="1245" y="380" font-size="13" fill="#64748b">• 移入死信队列防止毒药丸</text>
    <text x="1245" y="405" font-size="13" fill="#64748b">• 触发值班告警卡片等待人工介入</text>
  </g>

  <!-- 连线：QUEUED -> RUNNING (抢占成功) -->
  <line x1="380" y1="350" x2="474" y2="350" stroke="#3b82f6" stroke-width="2.5" marker-end="url(#arr-blue)"/>
  <text x="430" y="338" text-anchor="middle" font-size="12" font-weight="700" fill="#1d4ed8">抢占租约</text>

  <!-- 连线：RUNNING -> SUCCEEDED (正常完结) -->
  <line x1="780" y1="350" x2="874" y2="350" stroke="#10b981" stroke-width="2.5" marker-end="url(#arr-green)"/>
  <text x="830" y="338" text-anchor="middle" font-size="12" font-weight="700" fill="#166534">校验通过</text>

  <!-- 连线：RUNNING -> RETRY (异常触发重试) -->
  <line x1="630" y1="460" x2="630" y2="554" stroke="#f97316" stroke-width="2.5" marker-end="url(#arr-orange)"/>
  <text x="670" y="515" font-size="12" font-weight="700" fill="#c2410c">临时超时/可恢复错误</text>

  <!-- 连线：RETRY -> RUNNING (重新认领) -->
  <path d="M 480 660 H 420 V 410 H 474" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="6,6" marker-end="url(#arr-blue)"/>
  <text x="375" y="540" text-anchor="middle" font-size="12" font-weight="700" fill="#1d4ed8">退避完毕重新认领</text>

  <!-- 连线：RETRY -> FAILED (超过最大重试次数) -->
  <path d="M 780 660 H 1360 V 466" fill="none" stroke="#ef4444" stroke-width="2.5" marker-end="url(#arr-red)"/>
  <text x="1070" y="650" text-anchor="middle" font-size="12" font-weight="700" fill="#dc2626">重试耗尽 (Count ≥ 3) 移入死信</text>
</svg>
```

### 3.4 模块时序交互与数据流转范式 (Sequence & Data Flow)

当分析分布式协议、RPC 调用链路、事件总线流转或人机交互时，采用优雅的时序卡片流转图：

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-labelledby="t-seq d-seq">
  <title id="t-seq">核心模块交互与时序数据流</title>
  <desc id="d-seq">展示客户端、网关调度器、执行引擎与存储归档之间的全链路交互时序</desc>
  <defs>
    <filter id="seq-shadow" x="-6%" y="-6%" width="112%" height="115%">
      <feDropShadow dx="0" dy="5" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.05"/>
    </filter>
    <marker id="seq-arr-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <polygon points="0 0, 7 3, 0 6" fill="#3b82f6"/>
    </marker>
    <marker id="seq-arr-green" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <polygon points="0 0, 7 3, 0 6" fill="#10b981"/>
    </marker>
    <marker id="seq-arr-violet" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <polygon points="0 0, 7 3, 0 6" fill="#8b5cf6"/>
    </marker>
    <linearGradient id="seq-bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#f1f5f9"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#seq-bg)"/>

  <!-- 居中标题 -->
  <g font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <text x="800" y="75" text-anchor="middle" font-size="34" font-weight="800" fill="#0f172a">核心模块交互时序与数据流转</text>
    <text x="800" y="110" text-anchor="middle" font-size="16" fill="#64748b">端到端请求校验、异步任务派发、流式结果回传与持久化闭环</text>
  </g>

  <!-- 4 个角色生命线 (Lifelines) -->
  <line x1="220" y1="210" x2="220" y2="820" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="6,6"/>
  <line x1="600" y1="210" x2="600" y2="820" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="6,6"/>
  <line x1="980" y1="210" x2="980" y2="820" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="6,6"/>
  <line x1="1360" y1="210" x2="1360" y2="820" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="6,6"/>

  <!-- 角色卡片 1: 客户端 / 调用方 -->
  <g filter="url(#seq-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="120" y="150" width="200" height="60" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
    <text x="220" y="185" text-anchor="middle" font-size="16" font-weight="700" fill="#0f172a">发起方 / 触发端</text>
  </g>

  <!-- 角色卡片 2: 网关与调度器 -->
  <g filter="url(#seq-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="500" y="150" width="200" height="60" rx="12" fill="#ffffff" stroke="#93c5fd" stroke-width="1.5"/>
    <text x="600" y="185" text-anchor="middle" font-size="16" font-weight="700" fill="#1d4ed8">网关与调度核心</text>
  </g>

  <!-- 角色卡片 3: 执行沙箱 / Worker -->
  <g filter="url(#seq-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="880" y="150" width="200" height="60" rx="12" fill="#ffffff" stroke="#c4b5fd" stroke-width="1.5"/>
    <text x="980" y="185" text-anchor="middle" font-size="16" font-weight="700" fill="#6d28d9">执行沙箱 / Worker</text>
  </g>

  <!-- 角色卡片 4: 存储与知识库 -->
  <g filter="url(#seq-shadow)" font-family="Inter, -apple-system, 'PingFang SC', sans-serif">
    <rect x="1260" y="150" width="200" height="60" rx="12" fill="#ffffff" stroke="#86efac" stroke-width="1.5"/>
    <text x="1360" y="185" text-anchor="middle" font-size="16" font-weight="700" fill="#166534">存储与产物归档</text>
  </g>

  <!-- 步骤 1: 提交任务 (220 -> 600) -->
  <line x1="220" y1="260" x2="594" y2="260" stroke="#3b82f6" stroke-width="2" marker-end="url(#seq-arr-blue)"/>
  <text x="410" y="250" text-anchor="middle" font-size="13" font-weight="600" fill="#1e293b">1. 提交任务请求与入参参数 (POST /jobs)</text>

  <!-- 步骤 2: 租约入库 (600 -> 1360) -->
  <line x1="600" y1="320" x2="1354" y2="320" stroke="#10b981" stroke-width="2" marker-end="url(#seq-arr-green)"/>
  <text x="980" y="310" text-anchor="middle" font-size="13" font-weight="600" fill="#166534">2. 写入任务 WAL 与分配租约 (QUEUED)</text>

  <!-- 步骤 3: 立即返回 TaskId (600 -> 220) -->
  <line x1="600" y1="380" x2="226" y2="380" stroke="#64748b" stroke-width="1.8" stroke-dasharray="5,5" marker-end="url(#seq-arr-blue)"/>
  <text x="410" y="370" text-anchor="middle" font-size="13" font-weight="500" fill="#64748b">3. 响应 202 Accepted 并返回 task_id</text>

  <!-- 步骤 4: Worker 抢占租约 (600 -> 980) -->
  <line x1="600" y1="440" x2="974" y2="440" stroke="#8b5cf6" stroke-width="2" marker-end="url(#seq-arr-violet)"/>
  <text x="790" y="430" text-anchor="middle" font-size="13" font-weight="600" fill="#6d28d9">4. 派发执行任务包并锁定 Worker 租约</text>

  <!-- 步骤 5: 沙箱执行与产物生成 (980 -> 980 自回环) -->
  <rect x="980" y="480" width="16" height="130" fill="#c4b5fd" rx="4"/>
  <text x="1010" y="530" font-size="13" font-weight="600" fill="#6d28d9">5. 沙箱隔离运行、深潜调研、生成研报与 SVG 资产</text>

  <!-- 步骤 6: 写入最终成果 (980 -> 1360) -->
  <line x1="996" y1="640" x2="1354" y2="640" stroke="#10b981" stroke-width="2" marker-end="url(#seq-arr-green)"/>
  <text x="1175" y="630" text-anchor="middle" font-size="13" font-weight="600" fill="#166534">6. 持久化 research.md 与 assets/ 矢量文件</text>

  <!-- 步骤 7: 变更通知回传 (1360 -> 600) -->
  <line x1="1360" y1="710" x2="606" y2="710" stroke="#64748b" stroke-width="1.8" stroke-dasharray="5,5" marker-end="url(#seq-arr-blue)"/>
  <text x="980" y="700" text-anchor="middle" font-size="13" font-weight="500" fill="#64748b">7. 更新任务终态为 SUCCEEDED 并释放租约</text>

  <!-- 步骤 8: 交付确认与通知 (600 -> 220) -->
  <line x1="600" y1="770" x2="226" y2="770" stroke="#10b981" stroke-width="2" marker-end="url(#seq-arr-green)"/>
  <text x="410" y="760" text-anchor="middle" font-size="13" font-weight="600" fill="#166534">8. 推送飞书研报通知卡片并完成归档</text>
</svg>
```

### 3.5 SVG 视觉工程与样式防御硬约束 (SVG Styling, Arrow & Distortion Defenses)

为了防止在不同终端、浏览器及 Markdown 渲染器（GitHub, VS Code, 掘金, 微信等）中出现连线断裂、箭头丢失、文字溢出或非等比形变，SVG 编写必须严格遵守以下**四大视觉防御硬约束**：

#### 1. 箭头与连接线防断裂铁律 (Arrowhead & Connector Defense)
- **严禁多子路径合并连线 (Anti-Path-Concat Bug)**：
  - **致命缺陷**：禁止在单个 `<path>` 中用多个 `M...` 串联多条连线（例如 `<path d="M100 200H200 M300 200H400" marker-end="url(#arr)"/>`）。在标准 SVG 1.1 渲染引擎（如 Chrome, Safari, VS Code 预览器）中，**`marker-end` 只会渲染在最后一个子路径的末端**，前序所有连接线都会丢失箭头，沦为“秃头直线”！
  - **强制规范**：每一个具备指向意义的步骤转换或流转连线，必须使用**独立的 `<line>` 或 `<path>`** 元素进行声明并挂载 `marker-end`。
- **严格色彩一致性 (Color Parity)**：
  - 箭头的 Marker `fill` 必须与连接线的 `stroke` 颜色 100% 严格对应。严禁绿色、橙色或紫色的连线挂载一个通用的蓝色默认箭头。
  - 若图中有不同语义的连接线（如绿色表示正常流转、橙色表示异常挂起、紫色表示回环水合），必须在 `<defs>` 中定义对应颜色的专属 marker（如 `#arr-green`, `#arr-orange`, `#arr-purple`）。
- **端点停靠与穿刺防御 (RefX & Gap Spacing)**：
  - 连线终点绝对不能直接刺入卡片文字或遮挡文字，也不能穿透到卡片内部核心区域。
  - 连线端点应距离目标卡片外框边界预留 2~4px 的接触缓冲，结合 `marker` 的 `refX` 属性（推荐 `refX="6~8"`, `markerWidth="8~10"`），确保箭头尖端精准触碰目标卡片外边框。

#### 2. 画布宽高比与防形变契约 (Anti-Distortion Contract)
- **严格等比视口与自适应**：
  - 根元素必须统一声明标准视口：`viewBox="0 0 W H"`，并显式指定自适应缩放策略：`preserveAspectRatio="xMidYMid meet"`。
  - 宽屏拓扑图统一采用 16:9 标准比例（推荐 `viewBox="0 0 1600 900"`；纵向高密度图可适度扩展至 `1600 1040` 或 `1600 1220`，但基准宽度统一锁定为 `1600`）。
- **严禁非等比形变 (Non-uniform Scaling)**：
  - 严禁在 `<g>` 或元素上使用 `transform="scale(sx, sy)"` 且 $sx \ne sy$ 的缩放，这会导致圆形变成椭圆、圆角矩形变形或字体扭曲。
  - 根元素推荐同时携带 `width="1600"` 和 `height="900"`（或 `width="100%"`），严禁外层父容器设置与 `viewBox` 冲突的强制像素 CSS 样式。

#### 3. 卡片间距、内边距与文字物理宽度防溢出 (Text Clamping & Spacing)
- **卡片内边距红线**：
  - 任何容器卡片内部的文本，左/右内边距不得小于 20px，距卡片底部不得小于 15px，严禁文字贴边或顶头。
- **胶囊/状态徽章宽度定律 (Capsule Badge Width Law)**：
  - 胶囊徽章（如 `<rect rx="12~15">`）由于两侧半圆弧度会压缩有效平直区域，其实际宽度必须计入弧度冗余：
    $$\text{BadgeWidth} \ge \text{EstTextWidth} + 2 \times rx + 16\text{px}$$
- **编号/图标徽章与下方文字垂直安全间距 (Vertical Clearance Law)**：
  - 卡片内的步骤编号圆圈（`circle`）直径应精巧克制（推荐 $r=13\sim 15\text{px}$，直径 26~30px），严禁使用 $r \ge 20\text{px}$ 的笨重圆圈占用过半卡片高度。
  - 下方说明文本的 baseline 距离圆心 $y$ 坐标必须 $\ge r + 28\text{px}$，严禁圆圈下边缘与下方文本行高发生碰撞重叠。
- **文字物理宽度防溢出计算**：
  - SVG 中的 `<text>` 默认不会自动折行，必须确保：$\text{CardWidth} \ge \text{EstWidth} + 40\text{px}$。若一行超过 18 个汉字，严禁单行死撑，必须显式拆分为“粗体主标题 + 细体副标题”的双行层级结构。

#### 4. 跨平台字体族降级链 (Font Fallback Stack)
- 统一强制使用跨平台优雅字体降级栈：
  ```xml
  font-family="Inter, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
  ```

## 4. 高密度结构化交付物模板

### 4.1 决策与选型权衡矩阵 (Trade-off Decision Matrix)

避免主观打分（如“好/中/差”），必须使用具体场景、量化参数与客观特征：

| 评估维度 | 方案 A (如：轻量 Agent 轮询) | 方案 B (如：中心化 DAG 调度) | 方案 C (如：事件驱动 Mesh) |
| :--- | :--- | :--- | :--- |
| **典型吞吐量极限** | ~500 QPS (受限于轮询频率与DB锁) | ~10,000 QPS (内存调度树) | 100,000+ QPS (流式管道) |
| **单任务调度延迟** | 较高 (100ms ~ 2s 轮询周期) | 极低 (< 5ms 内存分发) | 极低 (< 2ms 事件传递) |
| **故障容灾机制** | 天然幂等，重启后自动拉取 | 需依赖 Raft 选主与 WAL 回放 | 依赖消息队列持久化与 ACK 机制 |
| **团队运维心智负担** | **极低** (仅依赖单体 MySQL) | **中等** (需维护 Leader 选主集群) | **高** (需维护 Kafka/Mesh 基础设施) |
| **反向适用场景 (不建议)** | 毫秒级实时人机交互系统 | 资源极度受限的边缘单机环境 | 逻辑简单的线性 CRUD 项目 |

### 4.2 生产排障诊断决策卡 (Troubleshooting Tree / Checklist)

```text
[线上突发告警：任务处理延迟飙升至 P99 > 5s]
  ├── 步骤 1：检查执行队列深度 (Queue Depth)
  │     ├── 深度 < 100 且稳定 -> 排查下游资源死锁（转步骤 2）
  │     └── 深度持续攀升 -> 说明 Worker 算力耗尽或消费堵塞（转步骤 3）
  ├── 步骤 2：检查下游数据库与外部依赖响应
  │     ├── 慢查询日志暴增 -> 临时开启读写分离降级，限制大批量任务并行
  │     └── 连接池耗尽 (Connection Timeout) -> 检查是否有未释放连接的泄漏点
  └── 步骤 3：动态弹性伸缩与流控处置
        ├── 检查沙箱节点 CPU/内存压频现象
        └── 触发紧急限流策略：拒绝 Tier 3 低优先级批处理，保核心 Issue 链路
```

### 4.3 公式与度量指标卡 (Formula & Metrics Standard)

当文章涉及提效计算、算法推导或性能量化时，必须遵循以下规则：
1. **公式独立编号与变量全量注解**。
2. **禁止虚空提效**：公式仅作为建模参考，实际提效必须附带真实测量数据。

$$
ROI_{delivery} = \frac{\sum_{i=1}^{N} (T_{manual}^{(i)} \times C_{engineer}) - (T_{review}^{(i)} \times C_{engineer} + Cost_{token}^{(i)})}{\sum_{i=1}^{N} (T_{manual}^{(i)} \times C_{engineer})} \times 100\%
$$

- **变量解释**：
  - $T_{manual}^{(i)}$：第 $i$ 个任务纯人工完成所需标准工时（小时）；
  - $T_{review}^{(i)}$：第 $i$ 个任务人工介入、审查与调优消耗工时（小时）；
  - $C_{engineer}$：团队综合工时成本单价（元/小时）；
  - $Cost_{token}^{(i)}$：AI Agent 运行过程中产生的推理计算成本（元）；
  - **统计约束口径**：该公式仅适用于已建立标准化单测与 Lint 拦截机制的中低复杂度任务（样本量 $N \ge 30$），不可外推至从 0 到 1 的全新架构设计。
