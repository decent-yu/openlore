import crypto from "node:crypto";
import { repositoryStudy } from '@openlore/contracts';
import { hasReviewableBody } from "../../infrastructure/content/review-body.js";
import type {
  ContentItem,
  PoolStatus,
  SourceOptions,
} from "@openlore/contracts";

export const QUALITY_VERSION = "collection-quality-v2";
export const reasonLabels: Record<string, string> = {
  ready: "日期、正文和主题初筛通过；工程价值由流水线审核",
  outside_window: "超出采集时间窗",
  previous_year: "非今年首发文章",
  date_unknown: "原文缺少可信首发日期",
  date_conflict: "原文首发日期证据冲突",
  future_date: "首发日期在未来",
  excluded_category: "属于排除的内容分类",
  excluded_keyword: "命中排除关键词",
  keyword_mismatch: "未命中关键词，待人工复核",
  body_missing: "待补抓原文",
  body_invalid: "正文为空、截断或疑似错误页面",
  fetch_failed: "补抓失败，自动重试最多三次",
  queued: "等待日期核验和正文补抓",
};
export function plainText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    // Preserve path case and semantic query parameters.
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}
const concepts: Record<string, string[]> = {
  agent: ["agent", "agents", "agentic"],
  evaluation: [
    "evaluation",
    "evaluations",
    "eval",
    "evals",
    "evaluator",
    "evaluators",
  ],
  llm: ["llm", "llms", "large language model", "large language models"],
  tools: ["tool", "tools", "tool calling", "tool use"],
  "coding agents": [
    "coding agent",
    "coding agents",
    "agent harness",
    "agent harnesses",
    "harness engineering",
    "model router",
    "model routing",
    "open swe",
  ],
};
function containsTerm(text: string, term: string): boolean {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /^[\x00-\x7F]+$/.test(term)
    ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text)
    : text.includes(term.toLowerCase());
}
export function keywordHits(
  item: ContentItem,
  options: SourceOptions,
): string[] {
  const text =
    `${item.title || ""} ${plainText(item.body.value)} ${(item.categories || []).join(" ")}`.toLowerCase();
  return options.keywords.filter((word) => {
    const variants = Object.entries(concepts).find(
      ([key, variants]) =>
        key === word.toLowerCase() || variants.includes(word.toLowerCase()),
    )?.[1] || [word];
    return variants.some((variant) => containsTerm(text, variant));
  });
}
export function matchesSourceKeywords(
  item: ContentItem,
  options: SourceOptions,
): boolean {
  const text =
    `${item.title || ""} ${plainText(item.body.value)}`.toLowerCase();
  if (options.excluded_keywords.some((word) => containsTerm(text, word)))
    return false;
  const hits = keywordHits(item, options);
  return (
    options.keywords.length === 0 ||
    (options.keyword_mode === "all"
      ? hits.length === options.keywords.length
      : hits.length > 0)
  );
}
export function ruleRevision(options: SourceOptions): string {
  return crypto
    .createHash("sha256")
    .update(QUALITY_VERSION + JSON.stringify(options))
    .digest("hex")
    .slice(0, 16);
}
export function publicationIssue(
  published: string | null | undefined,
  options: Pick<SourceOptions, "max_age_days" | "current_year_only">,
  timezone: string,
  now = new Date(),
): string | null {
  if (!published || !Number.isFinite(Date.parse(published)))
    return "date_unknown";
  const date = new Date(published);
  const year = (d: Date) =>
    new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
    }).format(d);
  if (date.getTime() > now.getTime()) return "future_date";
  if (options.current_year_only && year(date) !== year(now))
    return "previous_year";
  if (date.getTime() < now.getTime() - options.max_age_days * 86400000)
    return "outside_window";
  return null;
}
export function evaluateContent(
  item: ContentItem,
  options: SourceOptions,
  timezone: string,
  now = new Date(),
): { status: PoolStatus; reason: string } {
  const done = (status: PoolStatus, reason: string) => ({
    status,
    reason,
  });
  if (item.fetch_method === 'github_repository' && repositoryStudy(item.date_evidence || {}))
    return item.body.completeness === 'full' && item.body.value.trim().length >= 80
      ? done('ready', 'ready') : done('review', 'body_invalid');
  const issue = publicationIssue(item.published_at, options, timezone, now);
  if (issue === "previous_year" || issue === "outside_window")
    return done("history", issue);
  if (issue) return done("review", issue);
  if (item.date_evidence?.conflict) return done("review", "date_conflict");
  if (
    (item.categories || []).some((category) =>
      options.excluded_categories.some(
        (excluded) => excluded.toLowerCase() === category.toLowerCase(),
      ),
    )
  )
    return done("excluded", "excluded_category");
  if (options.verify_publication_date && !item.date_evidence?.verified)
    return done("pending", "queued");
  const text =
    `${item.title || ""} ${plainText(item.body.value)}`.toLowerCase();
  if (options.excluded_keywords.some((word) => containsTerm(text, word)))
    return done("excluded", "excluded_keyword");
  const body = plainText(item.body.value);
  if (!item.title || item.body.completeness !== "full")
    return done("pending", "body_missing");
  if (
    !hasReviewableBody(item.body.value, item.title || "") ||
    body.length < 80 ||
    /^(access denied|just a moment|page not found|sign in to continue|403 forbidden|404 not found)/i.test(
      body,
    )
  )
    return done("review", "body_invalid");
  if (!matchesSourceKeywords(item, options)) {
    if (options.keyword_policy === "strict")
      return done("excluded", "keyword_mismatch");
    // Assist mode rescues concrete engineering subjects; unrelated material stays reviewable.
    const signal =
      /\b(harness|model rout(?:er|ing)|benchmark|observability|tracing|sandbox|orchestration|context engineering|retrieval|evals?|langgraph|mcp)\b/i;
    if (
      !signal.test(
        `${item.title || ""} ${(item.categories || []).join(" ")} ${body.slice(0, 1600)}`,
      )
    )
      return done("review", "keyword_mismatch");
  }
  return done("ready", "ready");
}
