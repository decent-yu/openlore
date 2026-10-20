import crypto from "node:crypto";
import type { ArtifactBundleFile, Group, Manifest } from "@openlore/contracts";

export type ArchivedArticle = Manifest["article_locations"][string];

export function articleSlug(text: string): string {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  if (words.length <= 80) return words || "article";
  return words
    .slice(0, 81)
    .replace(/-[^-]*$/, "")
    .slice(0, 80)
    .replace(/-$/, "");
}

export function batchLabel(sequence: string): string {
  return sequence.replace(/^(\d{4})(\d{2})(\d{2})-/, "$1-$2-$3-");
}

export function markdownFile(
  filePath: string,
  content: string,
): ArtifactBundleFile {
  return {
    path: filePath,
    content_bytes: Buffer.from(content).toString("base64"),
    encoding: "utf-8",
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    media_type: filePath.endsWith(".json")
      ? "application/json"
      : "text/markdown",
  };
}

const label = (text: string) =>
  text.replace(/[\r\n]+/g, " ").replace(/([\\\[\]])/g, "\\$1");
const href = (filePath: string) =>
  filePath.split("/").map(encodeURIComponent).join("/");

const topics = [
  {
    slug: "evaluation",
    title: "评测与可靠性",
    matches: /eval|benchmark|testing|评测|评估|回归|可靠性/i,
  },
  {
    slug: "cost-optimization",
    title: "成本与性能优化",
    matches: /cost|optimiza|cach|inference|latency|成本|优化|缓存|推理|延迟/i,
  },
  {
    slug: "case-studies",
    title: "实践案例",
    matches: /\bhow\b.+\bbuilt\b|case stud|实践案例|健康辅导|代码审查/i,
  },
];

export function articleOverview(article: ArchivedArticle): string {
  return (
    `# ${article.title}\n\n` +
    `- [阅读原文整理](article.md)\n` +
    (article.has_research ? `- [阅读深度调研](research.md)\n` : "") +
    `- [原文来源](${article.original_url || "#"})\n\n` +
    `收录时间：${article.collected_at}  \n更新时间：${article.updated_at}  \n` +
    `标签：${article.tags.join("、") || "暂无"}\n\n[返回知识首页](../../README.md)\n`
  );
}

export function navigationFiles(
  group: Pick<Group, "name" | "description" | "route">,
  manifest: Manifest,
): ArtifactBundleFile[] {
  const base = group.route.base_path;
  const articles = Object.values(manifest.article_locations).sort(
    (a, b) =>
      b.updated_at.localeCompare(a.updated_at) ||
      a.directory.localeCompare(b.directory),
  );
  const link = (article: ArchivedArticle, prefix = "") =>
    `- [${label(article.title)}](${href(`${prefix}${article.directory}/README.md`)})` +
    (article.has_research
      ? ` · [调研](${href(`${prefix}${article.directory}/research.md`)})`
      : "");
  const sections = topics.map((topic) => ({
    ...topic,
    articles: articles.filter((article) =>
      topic.matches.test(`${article.title} ${article.tags.join(" ")}`),
    ),
  }));
  const other = articles.filter(
    (article) =>
      !sections.some((section) => section.articles.includes(article)),
  );
  sections.push({
    slug: "other",
    title: "其他主题",
    matches: /./,
    articles: other,
  });
  const active = sections.filter((section) => section.articles.length);
  const batches = Object.values(manifest.collection_locations).sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const files = sections
    .filter(
      (section) =>
        section.articles.length ||
        manifest.managed_files[`${base}/topics/${section.slug}.md`],
    )
    .map((section) =>
      markdownFile(
        `${base}/topics/${section.slug}.md`,
        `# ${section.title}\n\n${section.articles.map((article) => link(article, "../")).join("\n") || "暂无文章。"}\n\n[返回知识首页](../README.md)\n`,
      ),
    );
  files.push(
    markdownFile(
      `${base}/README.md`,
      `# ${group.name}\n\n${group.description}\n\n` +
        `## 主题导航\n\n${active.map((section) => `- [${section.title}](topics/${section.slug}.md)（${section.articles.length} 篇）`).join("\n")}\n\n` +
        `## 全部文章（${articles.length} 篇）\n\n${articles.map((article) => link(article)).join("\n")}\n\n` +
        `## 采集批次\n\n${batches.map((batch) => `- [${batchLabel(batch.date_sequence)}](${href(batch.path.slice(base.length + 1))})（${batch.article_ids.length} 篇）`).join("\n")}\n`,
    ),
  );
  return files;
}

export function finalizeManifest(
  basePath: string,
  manifest: Manifest,
  files: ArtifactBundleFile[],
): void {
  for (const file of files)
    manifest.managed_files[file.path] = {
      sha256: file.sha256,
      media_type: file.media_type,
      size: Buffer.from(file.content_bytes || "", "base64").length,
    };
  files.push(
    markdownFile(
      `${basePath}/.openlore/manifest.json`,
      JSON.stringify(manifest, null, 2),
    ),
  );
}
