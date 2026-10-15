# 采集能力统一接入设计

对应：[采集能力](../product/feature/02-content-collection.md)。状态：接口与目录约定，尚未实现。

## 调用与职责

统一入口：`collect(request, context) -> CollectionResult`。

- `discover`：根据来源目标发现一批条目，可带上 Feed 已提供的正文。
- `fetch`：获取单条内容的正文，服务于文章导入或补抓。
- 适配器声明支持的操作；不支持的组合返回 `unsupported_operation`，不静默切换工具。
- `context` 由应用提供 HTTP 客户端、凭据解析器、原始响应存储和日志；适配器不直接操作业务数据库、不执行组内筛选或通知。

## 输入：CollectionRequest

| 字段 | 类型 / 必填 | 语义 |
| --- | --- | --- |
| `run_id` | string / 是 | 本次调度标识，用于追踪，不作为内容身份 |
| `source_id` | string / 是 | 管理员维护的来源标识 |
| `source_revision` | string / 是 | 本次来源配置修订，用于隔离续采状态与追踪配置 |
| `capability_id` | string / 是 | 注册的能力，如 `web_feed`、`web_page` |
| `operation` | enum / 是 | `discover` 或 `fetch` |
| `target` | object / 是 | 本期为 `{url}`；补抓另带 `source_item_id`，保持原条目身份 |
| `scope` | object / 是 | `since`、`until` 可空，使用 UTC ISO 8601；`limit` 为正整数，限制本批输出数量 |
| `state` | object/null / 是 | 上次已提交状态；只有对应适配器解释其内容 |
| `credential_ref` | string/null / 是 | 凭据引用；值由 context 解析，不携带明文 Token |
| `options` | object / 是 | 能力专用配置，按该能力的 schema 校验 |
| `budget` | object / 是 | `timeout_seconds` 与 `max_requests`，限制一次调用 |

公共 Feed 轮询的 since/until 默认均为空，先保存可见元信息；组首次时间窗与候选数量在应用层按 feature 02 执行，不能过滤掉其他组需要的条目。显式能力请求的时间窗采用 `[since, until)`。发布日期缺失时保留条目并记录 `date_unknown`，不能伪造日期或静默判为窗外。`fetch` 的指定目标不按发布时间过滤。

## 输出：CollectionResult

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `run_id/source_id/capability_id` | string | 回显调用身份 |
| `status` | enum | `success`、`partial`、`failed`、`not_modified` |
| `items` | ContentItem[] | 本次取得的可用条目；可能只有摘要 |
| `next_state` | object/null | 候选续采状态，只有应用确认持久化成功后才生效 |
| `scan` | enum | `complete`、`more`、`limited`、`unknown` |
| `errors` | Error[] | 本批或单条错误、警告，允许与有效条目共存 |
| `observed_at` | datetime | 本次获取时间，UTC ISO 8601 |
| `stats` | object | 请求数、实际观察条目数、返回条目数；不能将返回数冒充上游总量 |

`status` 表示操作结果，正文是否完整由条目字段表达：发现了摘要可以是 `success`。`partial` 表示解析、访问或预算等问题导致本次结果不完整；`failed` 无可用结果；HTTP 304 映射为 `not_modified`，不当作失败。

`scan=complete` 仅表示读完本次可见范围，不保证 Feed 包含全部历史。`more` 必须带可继续读取的 `next_state`；达到预算且不能续读返回 `limited`；无法判断覆盖情况返回 `unknown`。304 返回空条目和 `scan=unknown`。

## 内容：ContentItem

| 字段 | 类型 / 约束 |
| --- | --- |
| `source_item_id` | string，稳定来源内身份；优先由来源标识 + 上游 ID 确定，无上游 ID 时使用来源标识 + 规范 URL |
| `source_id/native_id` | 来源标识必填；上游 ID 可空 |
| `original_url/final_url/canonical_url` | string/null；分别保存入口、跳转目标和确认的规范地址，不盲信不相关的 canonical |
| `title/author/published_at/updated_at` | 元信息，可空；时间统一为 UTC ISO 8601，缺失不推测 |
| `body` | `{value, format, completeness}`；format 为 `html/text/markdown`，completeness 为 `full/summary/empty/unknown` |
| `attachments` | `{url, kind, fetched}[]`，表示图片/视频等附件与是否实际获取 |
| `fetched_at/fetch_method` | 获取时间与实际使用的能力/后端 |
| `raw_ref` | 原始响应在受控存储中的引用，供复查；剔除认证头等秘密 |
| `issues` | string[]，如 `date_unknown`、`media_unread`、`possibly_truncated` |

补抓沿用 `source_item_id`，即使 URL 重定向也不新建来源条目。上游 ID 与可用 URL 都缺失时返回 `invalid_item`。跨来源合并使用持久化文章标识，保留多条来源关联；内容 hash 用于修订检测，不作为会随正文变化的文章身份。

`full` 仅描述已取得的文本正文，不证明图像、SVG 或视频已被理解；不确定时使用 `unknown`。Feed 中存在 `content` 字段不自动等于全文。

## 错误与状态提交

错误统一为 `{code, message, source_item_id, retryable, retry_after_seconds}`；后两项分别为 bool 和可空秒数。常用 code：`invalid_config`、`unsupported_operation`、`auth_required`、`rate_limited`、`timeout`、`parse_error`、`content_unavailable`、`invalid_item`。message 不包含凭据。

1. 应用先保存条目、原始响应引用及需要补抓/重试的目标，再提交 `next_state`；失败重放依靠稳定身份去重。
2. 状态按来源、能力、配置修订与凭据范围隔离。切换适配器或实质更改来源配置时重新建立状态，不解释其他能力的私有状态。
3. Feed 读取后因 `limit` 分批时，应先保存完整响应快照，用快照引用和偏移续读；未返回条目仍有可靠恢复路径，才能保存新 ETag。不能裁掉尾部后直接用 304 跳过。
4. 畸形 Feed 可以保留可解析条目并返回 `partial`；未确定完整性时不推进远端检查点。失败条目与正文补抓任务独立持久化。
5. 同一个状态范围内串行推进采集位置。不同组复用内容，不共享组内筛选和交付状态。

## 调用示例

```json
{
  "run_id": "run-001",
  "source_id": "cloudflare",
  "source_revision": "source-rev-001",
  "capability_id": "web_feed",
  "operation": "discover",
  "target": {"url": "https://blog.cloudflare.com/rss/"},
  "scope": {"since": null, "until": null, "limit": 100},
  "state": null,
  "credential_ref": null,
  "options": {},
  "budget": {"timeout_seconds": 30, "max_requests": 10}
}
```

正文不足时，应用对对应条目发出 `web_page/fetch` 请求，target 同时携带文章 URL 与原 `source_item_id`；不在 `web_feed` 内硬编码对其他适配器的调用。

## 目录与注册

以下是编码时的目录约定，当前不创建空实现：

```text
src/openlore/
├── collection/
│   ├── contracts.py          # 统一请求、条目、结果、错误
│   ├── registry.py           # 能力清单与工厂注册
│   └── service.py            # 编排、补抓、持久化和状态推进
└── infrastructure/
    ├── http/                 # 共享超时、限流与请求基础设施
    └── collectors/
        ├── web_feed/         # feedparser，RSS + Atom 共用
        │   ├── adapter.py
        │   ├── mapping.py
        │   ├── tests/
        │   └── README.md
        └── web_page/         # HTTP + Trafilatura，目录结构同上
```

每项能力注册 `id`、支持操作、目标类型、配置 schema 和工厂。注册冲突启动失败；未知参数在调用前报错。新能力增加自己的目录与注册项，满足统一契约即可接入；特定厂商 SDK 不进入 contracts 或业务编排层。本期采用 Python，整体运行与目录见[本地服务设计](local-service-and-ai.md)；接口语义不绑定第三方库。

## 本期复用与检查

- `web_feed`：共享 HTTP 层获取字节与缓存头，交给 [feedparser](https://feedparser.readthedocs.io/en/latest/) 解析；参考 [304 行为](https://feedparser.readthedocs.io/en/latest/http-etag/) 和 [bozo 解析异常](https://feedparser.readthedocs.io/en/latest/bozo/)。
- `web_page`：共享 HTTP 层处理跳转，使用 [Trafilatura](https://trafilatura.readthedocs.io/en/latest/) 提取正文/元信息，再映射为 ContentItem。
- 契约验证覆盖 RSS/Atom、缺 ID/日期、摘要、畸形 XML、304、分批续读、重放、重定向、超时与正文缺失；用 Cloudflare 与 Simon 验证真实来源，网页补抓使用固定样本。
- 后续能力与阶段统一维护在 [feature 02 接入清单](../product/feature/02-content-collection.md)，不在这里重复建一套清单。
