# 04 首页每日精选推送与用户偏好 (Homepage Daily Feed)

OpenLore 首页为开发者打造了即开即读的每日轻量化学习面板。每天从近 3 天候选池中精选 10 篇高价值文章，自动交付 3 篇深度分析研报，保留 7 篇备选速览，并支持用户交互反馈闭环。

---

## 一、产品功能与交互

### 1. 每日精选架构（3 篇深度 + 7 篇备选）

```
[发现池：近 3 天内容]
         │
         ▼ (AI 依 Skill 综合初选)
[10 篇入选推荐]
         │
         ├─► [Top 3 深度研报] ── 自动生成 research.md ──► 首页置顶学习 + 同步入库
         │
         └─► [7 篇备选扩展] ── 展示文章名、出处、摘要 ──► 提供「发起深度调研」按钮
```

#### 模块 A：今日精选深度研报（Top 3 篇）
- 每天流水线自动从入选文章中优选前 3 篇，通过 `deep-research-expert` 生成详尽的技术调研报告。
- 卡片展示：文章标题、所属流水线任务标签、来源网站、完成研报状态。
- 用户可直接在页面内展开阅读完整的 Markdown 深度研报，深入理解技术架构与选型。

#### 模块 B：今日备选扩展阅读（其余 7 篇）
- 保持信息密度，避免信息过载。展示剩余 7 篇高质量备选文章。
- 每张卡片包含：
  - 文章标题（外链原文）与来源出处
  - 归属流水线任务标签（与流水线任务 ID 严格绑定，支持按组筛选）
  - 2~3 句核心技术摘要与技术标签
  - 操作按钮：`[ 深度调研 ]`

### 2. 用户兴趣（❤️）与偏好闭环
- **全局爱心标记**：每篇文章卡片均支持点击爱心（❤️），用户可随时标记自己感兴趣的内容。
- **一键深度调研联动**：
  - 用户在备选 7 篇中点击“深度调研”时，系统后台即刻启动异步任务进行深挖剖析，生成 `research.md`。
  - **自动判定感兴趣**：点击深度调研即视作明确的正向兴趣表达，系统自动为该文章点亮爱心（`user_interested = true`），底层标记 `selection_source = 'user_interest'`。
  - 沉淀为用户高优先级偏好样本，使 AI 后续批次推送更契合个人关注领域。

### 3. 日期切换与多组视图
- **日期切换**：支持下拉选择历史推送日期（`available_dates`），方便回顾过往每日推荐内容。
- **流水线任务切换**：支持查看“全部流水线任务”聚合视图，或单选某个特定组独立查看其推送动态。

---

## 二、代码与系统实现

### 1. 核心架构与模块对应
- **前端页面**：`apps/web/src/features/feed/DailyFeedPage.tsx`
- **服务端路由**：`apps/server/src/http/routes/feed.ts`
- **每日 Feed 服务**：`apps/server/src/modules/feed/service.ts` (`DailyFeedService`)
- **调研服务**：`apps/server/src/modules/research/service.ts` (`ResearchService`)

### 2. REST API 接口定义

#### `GET /api/v1/feed`
获取指定日期与流水线任务的推送数据。
- **Query 参数**：`group_id`（可选）, `date`（可选，格式 `YYYY-MM-DD`）
- **返回响应结构**：
```ts
{
  group: Group | null,
  groups: Array<{ id: string, name: string }>,
  date: string,
  available_dates: string[],
  stats: {
    pool_count_last_3_days: number,     // 发现池近 3 天未标记篇数
    total_selected_count: number,       // 当日实际入选总篇数 (如 10)
    deep_analyzed_count: number,        // 实际完成深度调研篇数 (如 3)
    candidate_remaining_count: number   // 备选阅读篇数 (如 7)
  },
  deep_articles: DailyFeedArticle[],    // 深度研报文章列表
  candidate_articles: DailyFeedArticle[]// 备选速览文章列表
}
```

#### `POST /api/v1/feed/research`
从首页备选文章直接发起深度调研。
- **请求 Body**：`{ group_id: string, article_id: string, source: 'user_interest' }`
- **业务动作**：创建异步调研任务，标记 `userInterested = true`，标记 `selectionSource = 'user_interest'`。

#### `POST /api/v1/articles/:id/interest`
切换文章的爱心感兴趣状态。
- **请求 Body**：`{ interested?: boolean, group_id?: string }`
- **返回响应**：`{ ok: true, article_id: string, user_interested: boolean }`

### 3. 数据底层标记与字段
- `articles.user_interested` (boolean)：用户是否标心或主动调研该文章。
- `group_items.is_deep_analyzed` (boolean)：该篇是否已完成 `research.md`。
- `group_items.selection_source` (enum)：
  - `ai_daily_auto`：定时任务中由 AI 自动挑中的 Top 3 篇；
  - `user_interest`：用户在备选区主动点击深度调研或标心而入选。

## 内容池准入

`/pool` 直接展示文章表；所有文章在入池前完成准入，不再有特殊保留状态。不提供待补全文、待复核、历史、已排除、抓取失败或全部采集记录的切换；采集过程统计在来源页查看。

“今日发现”“近三天发现”按工作区时区的入池时间统计；“近七天发布”按首发时间筛选。列表按首发日期倒序。未准入的候选不计入任何内容池列表、搜索、分页或标签统计。
