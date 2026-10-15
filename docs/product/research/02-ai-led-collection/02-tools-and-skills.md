# 采集工具与 skills 核查

日期：2026-10-15。返回：[方案总览](01-overview.md)。

Skill 告诉 AI 如何使用工具；CLI/API 执行读取；MCP 将工具暴露给 Agent。三者可以组合，安装 skill 本身不会自动获得账号权限、完整数据或定时运行能力。

## 候选方案

| 工具 / skill | 核查到的能力 | 关键依赖与边界 | 建议用途 |
| --- | --- | --- | --- |
| **x-reader** | 按 URL 读取 X、公众号、RSS、网页等；统一 JSON；给出 PASS/PARTIAL/FAIL/UNKNOWN 与内容缺口 | Python；浏览器回退需 Playwright；部分平台需登录或额外工具。不是公众号账号历史列表服务 | 首选验证跨平台正文读取 |
| **Agent-Reach** | 为 Agent 组织平台工具、安装配置、诊断与路由；网页走 Jina、RSS 走 feedparser、GitHub 走 gh、X 有平台 CLI/浏览器候选 | 依赖上游工具与环境；当前注册表没有专用微信渠道。X doctor 的配置检查不等于真实读取成功 | 多来源工具选择与故障处理参考 |
| **Firecrawl skills** | Search 找页面、Scrape 提取正文、Crawl 批量遍历、Agent 自主导航与结构化提取、Monitor 持续检查变化 | CLI + 服务；Crawl 要认证。Monitor 的范围取决于页面、站点遍历或搜索结果；不代表社交账号完整覆盖 | 托管网页采集与变化监测候选 |
| **baoyu-url-to-markdown** | 用 Chrome CDP 和站点适配器读取 URL，输出 Markdown/JSON，按需保存媒体；可等待人工处理登录或验证 | Bun、Chrome；已核查适配器包括 X、YouTube、HN 和通用网页。单篇读取不提供账号增量游标 | 交互式阅读、复杂页面和素材保存 |
| **agent-browser** | 通过 CDP、可访问性快照及元素引用控制浏览器；支持会话与状态保存 | Chrome/Chromium；分页、停止条件和结果校验由上层定义 | 浏览器采集兜底；是执行工具，不是完整订阅系统 |
| **Browser Use skill** | 通过浏览器控制处理交互、已登录页面和 JS 内容 | 浏览器/运行环境，云端模式另有服务依赖；官方 skill 明确建议公开可直读内容先用 HTTP | 与 agent-browser 二选一评估 |
| **Crawl4AI** | 自托管网页抓取、Markdown、CSS/XPath/正则提取、LLM 辅助 schema 生成 | Python/浏览器；LLM 提取可选，生成规则后可不逐页调用模型；此处作为库核查，不声称必须安装某个社区 skill | 批量固定站点与规则固化 |
| **last30days** | 多平台近期主题搜索、证据汇总、去重，支持存储与 watchlist | Python/Node；不同数据源有各自凭据和服务依赖。主题监测不是指定账号全量同步 | 补充发现与专题调研 |

## 最值得细看的实现

**x-reader：分平台读取 + 完整度报告。**微信先尝试 Jina，识别验证页后回退到 Playwright；统一模型区分 RSS 摘要与正文，证据逻辑识别登录墙、付费摘要和缺失媒体。注意 skill 首次引导安装固定 CLI 提交，因此 skill 版本、CLI 版本与仓库 HEAD 要分别记录，本表不保证安装后立即得到 HEAD 的全部能力。

依据：[skill](https://github.com/runesleo/x-reader/blob/c359a0ff68af8afa3305a27ed635060b87be09cc/skills/x-reader/SKILL.md)、[微信读取](https://github.com/runesleo/x-reader/blob/c359a0ff68af8afa3305a27ed635060b87be09cc/x_reader/fetchers/wechat.py)、[内容模型](https://github.com/runesleo/x-reader/blob/c359a0ff68af8afa3305a27ed635060b87be09cc/x_reader/schema.py)、[完整度判断](https://github.com/runesleo/x-reader/blob/c359a0ff68af8afa3305a27ed635060b87be09cc/x_reader/evidence.py)。

**Agent-Reach：主要价值在工具路由。**当前实现由 Agent 直接调用上游工具。Twitter 检查代码在凭据存在时仍可返回 warn，明确表示未做实时验证；不能把 doctor 当作采集成功验收。旧介绍或其他 fork 的平台清单，不应直接套到本次版本。

依据：[设计与当前选型](https://github.com/Panniantong/Agent-Reach/blob/94f06c1969dfc1834001269d79d3ad0972d9dee6/README.md)、[渠道注册表](https://github.com/Panniantong/Agent-Reach/blob/94f06c1969dfc1834001269d79d3ad0972d9dee6/agent_reach/channels/__init__.py)、[X 检查逻辑](https://github.com/Panniantong/Agent-Reach/blob/94f06c1969dfc1834001269d79d3ad0972d9dee6/agent_reach/channels/twitter.py)、[skill](https://github.com/Panniantong/Agent-Reach/blob/94f06c1969dfc1834001269d79d3ad0972d9dee6/agent_reach/skill/SKILL.md)。

**Firecrawl：区分普通抓取、自主探索与监测。**单页用 Scrape，明确站点范围用 Crawl，确实需要自主跨页导航再用 Agent。Monitor 可按页面、URL 集合、站点或搜索查询检查，输出 same/new/changed/removed/error；监测消耗底层抓取或搜索资源。托管功能需要单独核实，不能由“开源可自托管”推断全部云端功能都可本地运行。

依据：[Scrape](https://github.com/firecrawl/cli/blob/9edeb3c506326211a24a7642a31659b3a0a2cf5c/skills/firecrawl-scrape/SKILL.md)、[Crawl](https://github.com/firecrawl/cli/blob/9edeb3c506326211a24a7642a31659b3a0a2cf5c/skills/firecrawl-crawl/SKILL.md)、[Agent](https://github.com/firecrawl/cli/blob/9edeb3c506326211a24a7642a31659b3a0a2cf5c/skills/firecrawl-agent/SKILL.md)、[Monitor](https://github.com/firecrawl/cli/blob/9edeb3c506326211a24a7642a31659b3a0a2cf5c/skills/firecrawl-monitor/SKILL.md)。

**浏览器与规则提取：让 AI 处理复杂性，把稳定路径留下来。**baoyu 要求检查无头抓取结果；Browser Use 建议直接读取失败或确需交互时才升级到浏览器；Crawl4AI 提供用 LLM 生成 schema、随后通过 CSS/XPath 执行的方式。这些做法支持“首次探索，后续复用”，但自动修复效果仍需实际样本验证。

依据：[baoyu skill](https://github.com/JimLiu/baoyu-skills/blob/1567581c26ec29f4216c6e6835415bf30343b0e3/skills/baoyu-url-to-markdown/SKILL.md)、[agent-browser skill](https://github.com/vercel-labs/agent-browser/blob/dac13bb87468fe9d74a040d862720f6cc17a9565/skills/agent-browser/SKILL.md)、[Browser Use skill](https://github.com/browser-use/browser-use/blob/c75e8476e26d18b7617643bc2ae082fae8eae431/skills/browser-use/SKILL.md)、[Crawl4AI 提取与 schema 生成](https://docs.crawl4ai.com/extraction/no-llm-strategies/)。

**last30days：搜索与持续关注主题。**当前仓库提供多来源搜索、源内近重复处理，以及 `--store` + SQLite + watchlist。可以补充发现，但主题检索可能遗漏未被索引或不匹配关键词的条目。它与账号时间线采集应分开评估。

依据：[项目说明](https://github.com/mvanhorn/last30days-skill/blob/f4dff26b3b14d3c55c5a9dedfc4c7c8c5df2f84a/README.md)、[skill](https://github.com/mvanhorn/last30days-skill/blob/f4dff26b3b14d3c55c5a9dedfc4c7c8c5df2f84a/skills/last30days/SKILL.md)、[去重实现](https://github.com/mvanhorn/last30days-skill/blob/f4dff26b3b14d3c55c5a9dedfc4c7c8c5df2f84a/skills/last30days/scripts/lib/dedupe.py)、[watchlist](https://github.com/mvanhorn/last30days-skill/blob/f4dff26b3b14d3c55c5a9dedfc4c7c8c5df2f84a/skills/last30days/scripts/watchlist.py)。

## Skill 获取入口

本次运行 `npx skills find` 检索了 web scraping、agent-reach、firecrawl、baoyu-url-to-markdown、last30days、x-reader、daily digest，并回查作者仓库。以下为按需选用的安装命令，本轮没有执行安装：

```bash
npx skills add runesleo/x-reader --skill x-reader
npx skills add Panniantong/Agent-Reach --skill agent-reach
npx skills add firecrawl/skills --skill firecrawl-scrape
npx skills add JimLiu/baoyu-skills --skill baoyu-url-to-markdown
npx skills add vercel-labs/agent-browser --skill agent-browser
npx skills add browser-use/browser-use --skill browser-use
npx skills add mvanhorn/last30days-skill --skill last30days
```

可查阅 [x-reader 目录项](https://skills.sh/runesleo/x-reader/x-reader)、[Agent-Reach 目录项](https://skills.sh/panniantong/agent-reach/agent-reach)、[Firecrawl 官方安装目录](https://github.com/firecrawl/skills)、[baoyu 目录项](https://skills.sh/jimliu/baoyu-skills/baoyu-url-to-markdown)。目录收录和安装量仅用于发现候选，不作为采集质量证明。
