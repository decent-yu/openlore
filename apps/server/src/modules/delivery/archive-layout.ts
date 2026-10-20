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

export function archiveDate(
  value: string | Date,
  timezone = "Asia/Shanghai",
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(value))
    .replace(/-/g, "");
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
  text.replace(/[\r\n]+/g, " ").replace(/([\\\[\]|])/g, "\\$1");
const href = (filePath: string) =>
  filePath.split("/").map(encodeURIComponent).join("/");

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
  group: Pick<Group, "name" | "description" | "route" | "timezone">,
  manifest: Manifest,
): ArtifactBundleFile[] {
  const base = group.route.base_path;
  const articles = Object.values(manifest.article_locations);
  const newest = [...articles].sort(
    (a, b) =>
      Date.parse(b.collected_at) - Date.parse(a.collected_at) ||
      a.directory.localeCompare(b.directory),
  );
  const updated = [...articles].sort(
    (a, b) =>
      Date.parse(b.updated_at) - Date.parse(a.updated_at) ||
      a.directory.localeCompare(b.directory),
  );
  const rows = (
    list: ArchivedArticle[],
    field: "collected_at" | "updated_at",
  ) =>
    list
      .map(
        (article) =>
          `| ${archiveDate(article[field], group.timezone)} | [${label(article.title)}](${href(`${article.directory}/README.md`)}) | ` +
          (article.has_research
            ? `[调研](${href(`${article.directory}/research.md`)})`
            : "—") +
          " |",
      )
      .join("\n");
  const batches = Object.values(manifest.collection_locations).sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  return [
    markdownFile(
      `${base}/README.md`,
      `# ${group.name}\n\n${group.description}\n\n` +
        `## 最近收录（${articles.length} 篇）\n\n按首次收录时间从新到旧排列；更新旧文章不改变收录日期和目录。\n\n` +
        `| 收录日期 | 文章 | 深度调研 |\n| --- | --- | --- |\n${rows(newest, "collected_at")}\n\n` +
        `## 最近更新\n\n| 更新日期 | 文章 | 深度调研 |\n| --- | --- | --- |\n${rows(updated, "updated_at")}\n\n` +
        `## 采集批次\n\n${batches.map((batch) => `- [${batch.date_sequence}](${href(batch.path.slice(base.length + 1))})（${batch.article_ids.length} 篇）`).join("\n")}\n`,
    ),
  ];
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
