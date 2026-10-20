import { buildWikiUrl } from "@openlore/contracts";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";

export interface PublishedWikiLinks {
  article_url?: string;
  research_url?: string;
}

export const wikiLinkKey = (groupId: string, articleId: string) =>
  `${groupId}:${articleId}`;

/** Resolve saved archive paths, including old batches, against the current repository Wiki settings. */
export function getPublishedWikiLinks(
  articleIds: string[],
  groupId?: string,
): Map<string, PublishedWikiLinks> {
  const links = new Map<string, PublishedWikiLinks>();
  if (!articleIds.length) return links;
  const db = getSqliteDatabase();
  const placeholders = articleIds.map(() => "?").join(",");
  const locations = db
    .prepare(
      `
    SELECT l.article_id, l.group_id, l.collection_id, l.directory,
           r.wiki_base_url, r.wiki_root_path
    FROM article_locations l
    JOIN groups g ON g.id=l.group_id
    JOIN repository_connections r ON r.id=g.repository_connection_id
    WHERE l.article_id IN (${placeholders}) ${groupId ? "AND l.group_id=?" : ""}
      AND r.wiki_base_url<>''
    ORDER BY l.created_at DESC, l.rowid DESC
  `,
    )
    .all(...articleIds, ...(groupId ? [groupId] : [])) as Array<{
    article_id: string;
    group_id: string;
    collection_id: string;
    directory: string;
    wiki_base_url: string;
    wiki_root_path: string;
  }>;
  if (!locations.length) return links;
  const publications = db
    .prepare(
      `
    SELECT d.group_id, d.changed_paths_json, b.bundle_json
    FROM deliveries d
    LEFT JOIN artifact_bundles b ON b.batch_id=d.batch_id AND b.group_id=d.group_id
    LEFT JOIN research_tasks t ON d.batch_id='research_' || t.id AND t.group_id=d.group_id
    WHERE d.target_kind='github' AND d.status IN ('updated','unchanged')
      AND (t.article_id IN (${placeholders}) OR b.collection_id IN (
        SELECT collection_id FROM article_locations WHERE article_id IN (${placeholders})
      ) OR EXISTS (
        SELECT 1 FROM json_each(b.bundle_json,'$.entries') e
        WHERE json_extract(e.value,'$.article_id') IN (${placeholders})
      ))
    ORDER BY d.created_at DESC, d.rowid DESC
  `,
    )
    .all(...articleIds, ...articleIds, ...articleIds) as Array<{
    group_id: string;
    changed_paths_json: string;
    bundle_json: string | null;
  }>;
  const pathsByGroup = new Map<string, Set<string>>();
  const explicitPaths = new Map<string, { article?: string; research?: string }>();
  const reports = db
    .prepare(
      `
    SELECT t.group_id, t.article_id, t.status, t.archived_at, d.status AS publication_status
    FROM research_tasks t
    LEFT JOIN deliveries d ON d.batch_id='research_' || t.id AND d.group_id=t.group_id AND d.target_kind='github'
    WHERE t.article_id IN (${placeholders})
    ORDER BY t.created_at DESC, t.rowid DESC
  `,
    )
    .all(...articleIds) as Array<{
    group_id: string;
    article_id: string;
    status: string;
    archived_at: string | null;
    publication_status: string | null;
  }>;
  const latestReports = new Map<string, (typeof reports)[number]>();
  for (const report of reports) {
    const key = wikiLinkKey(report.group_id, report.article_id);
    if (!latestReports.has(key)) latestReports.set(key, report);
  }
  for (const publication of publications) {
    const paths = pathsByGroup.get(publication.group_id) || new Set<string>();
    // Unchanged uploads can have no changed paths; the acknowledged bundle still proves publication.
    for (const file of JSON.parse(publication.changed_paths_json) as string[])
      paths.add(file);
    if (publication.bundle_json) {
      const bundle = JSON.parse(publication.bundle_json) as {
        files: Array<{ path: string }>;
        entries?: Array<{ article_id: string; article_path?: string; research_path?: string }>;
      };
      for (const file of bundle.files) paths.add(file.path);
      for (const entry of bundle.entries || []) {
        const key = wikiLinkKey(publication.group_id, entry.article_id);
        if (!explicitPaths.has(key)) explicitPaths.set(key, {
          article: bundle.files.some(file => file.path === entry.article_path) ? entry.article_path : undefined,
          research: bundle.files.some(file => file.path === entry.research_path) ? entry.research_path : undefined,
        });
      }
    }
    pathsByGroup.set(publication.group_id, paths);
  }
  for (const location of locations) {
    const key = wikiLinkKey(location.group_id, location.article_id);
    if (links.has(key)) continue;
    const published: PublishedWikiLinks = {};
    const explicit = explicitPaths.get(key);
    if (explicit?.article) published.article_url = buildWikiUrl(location, explicit.article);
    if (explicit?.research) published.research_url = buildWikiUrl(location, explicit.research);
    let articlePath: string | undefined;
    for (const file of pathsByGroup.get(location.group_id) || []) {
      if (file.endsWith(`/${location.directory}/article.md`)) {
        published.article_url ??= buildWikiUrl(location, file);
        articlePath ??= file;
      }
      if (file.endsWith(`/${location.directory}/research.md`))
        published.research_url ??= buildWikiUrl(location, file);
    }
    // Earlier standalone uploads have no delivery receipt. Keep their completed reports
    // discoverable under the already acknowledged article directory; never infer from a failed upload.
    const report = latestReports.get(key);
    if (
      articlePath &&
      report?.status === "succeeded" && report.archived_at &&
      (!report.publication_status ||
        ["updated", "unchanged"].includes(report.publication_status))
    ) {
      published.research_url ??= buildWikiUrl(
        location,
        articlePath.replace(/article\.md$/, "research.md"),
      );
    }
    if (published.article_url || published.research_url)
      links.set(key, published);
  }
  return links;
}
