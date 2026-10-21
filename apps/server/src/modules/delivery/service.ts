import crypto from "node:crypto";
import fs from "node:fs";
import { and, desc, eq } from "drizzle-orm";
import type {
  ArtifactBundle,
  ArtifactBundleAsset,
  ArtifactBundleFile,
  Group,
  RepositorySyncResult,
  ResearchTask,
  StructuredEntry,
} from "@openlore/contracts";
import { getDb, getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import {
  loadManifest,
  publishArchive,
  type ArchiveInput,
  type DeliveryResult,
} from "./publication.js";
import { buildRepositoryArchive } from "./repository-archive.js";
import {
  articleSlug,
  articleOverview,
  archiveDate,
  markdownFile,
  navigationFiles,
  finalizeManifest,
  batchNavigationFile,
  researchWithArticleHeader,
} from "./archive-layout.js";
import {
  articlesTable,
  articleRevisionsTable,
  articleLocationsTable,
  collectionsTable,
  mediaAssetsTable,
} from "../../infrastructure/persistence/sqlite/schema.js";
import {
  articleTranslationService,
  CHINESE_ARTICLE_FILENAME,
} from "./translation.js";

function buildArticleMarkdown(
  entry: StructuredEntry,
  hasResearch: boolean,
): string {
  return (
    `# ${entry.title}\n\n` +
    `> **来源**: [${entry.original_url || "原文链接"}](${entry.original_url || "#"})  \n` +
    `> **作者**: ${entry.author || "未知"} | **发布时间**: ${entry.published_at || "未知"}  \n` +
    (hasResearch ? `> **深度调研**: [查看专题调研报告](research.md)  \n` : "") +
    `> **标签**: ${entry.tags.join(", ")}\n\n` +
    `---\n\n` +
    `## AI 导读\n\n${entry.summary}\n\n` +
    `---\n\n` +
    `## 原文整理\n\n${entry.organized_markdown}\n`
  );
}

export class DeliveryService {
  async allocateCollectionSequence(
    groupId: string,
    timezone: string = "Asia/Shanghai",
  ): Promise<{ collectionId: string; dateSequence: string }> {
    const db = getDb();
    const now = new Date();
    // Format YYYYMMDD in group timezone
    const yyyymmdd = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(now)
      .replace(/-/g, "");

    // Count existing collections for this day and group
    const todayCols = db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.groupId, groupId))
      .all()
      .filter((c) => c.dateSequence.startsWith(yyyymmdd));

    const nextSeqNum = todayCols.length + 1;
    const dateSequence = `${yyyymmdd}-${String(nextSeqNum).padStart(2, "0")}`;
    const collectionId = `col_${crypto.randomUUID().slice(0, 12)}`;

    db.insert(collectionsTable)
      .values({
        id: collectionId,
        groupId,
        dateSequence,
        createdAt: now.toISOString(),
      })
      .run();

    return { collectionId, dateSequence };
  }

  private async buildArticleBundle(
    options: ArchiveInput,
  ): Promise<ArtifactBundle> {
    const { group, runId, entries, researchTasks = [] } = options;
    const db = getDb();
    const batchId = `batch_${crypto.randomUUID()}`;
    const basePath = group.route.base_path; // e.g. "docs/agent-learning"

    const manifest = loadManifest(group);

    // Reuse available translations before allocating archive locations or publishing.
    const articles: Array<{ original: string; chinese: string }> = [];
    for (const entry of entries) {
      const original = buildArticleMarkdown(
        entry,
        researchTasks.some((task) => task.article_id === entry.article_id) ||
          !!manifest.article_locations[entry.article_id]?.has_research,
      );
      articles.push({
        original,
        chinese: await articleTranslationService.translate({
          markdown: original,
          articleId: entry.article_id,
          articleTitle: entry.title,
          groupId: group.id,
          runId,
          profileId: group.ai_profile_id,
        }),
      });
    }

    // 1. Allocate collection date sequence (e.g. 20261015-01)
    const { collectionId, dateSequence } =
      await this.allocateCollectionSequence(group.id, group.timezone);

    const bundleFiles: ArtifactBundleFile[] = [];
    const bundleAssets: ArtifactBundleAsset[] = [];
    const articleEntries: ArtifactBundle["entries"] = [];

    const now = new Date().toISOString();

    // 2. Process each article
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const existing = manifest.article_locations[entry.article_id];
      let slug = existing?.slug || articleSlug(entry.slug || entry.title);
      let articleRelDir =
        existing?.directory ||
        `articles/${archiveDate(now, group.timezone)}-${slug}`;
      // Two distinct sources may have the same title. Never overwrite their directories.
      const occupied = db
        .select()
        .from(articleLocationsTable)
        .where(eq(articleLocationsTable.groupId, group.id))
        .all();
      if (
        !existing &&
        occupied.some(
          (location) =>
            location.articleId !== entry.article_id &&
            location.directory === articleRelDir,
        )
      ) {
        slug += `-${crypto.createHash("sha256").update(entry.article_id).digest("hex").slice(0, 12)}`;
        articleRelDir = `articles/${archiveDate(now, group.timezone)}-${slug}`;
      }
      const articleFullPath = `${basePath}/${articleRelDir}`;
      const research = researchTasks.find(
        (task) => task.article_id === entry.article_id,
      );
      const hasResearch = !!research || !!existing?.has_research;
      articleEntries.push({
        article_id: entry.article_id,
        slug,
        directory: articleRelDir,
        article_path: `${articleFullPath}/article.md`,
        research_path: `${articleFullPath}/research.md`,
      });
      manifest.article_locations[entry.article_id] = {
        collection_id: existing?.collection_id || collectionId,
        directory: articleRelDir,
        slug,
        title: entry.title,
        original_url: entry.original_url || "",
        tags: entry.tags,
        collected_at: existing?.collected_at || now,
        updated_at: now,
        has_research: hasResearch,
      };
      bundleFiles.push(
        markdownFile(
          `${articleFullPath}/README.md`,
          articleOverview(manifest.article_locations[entry.article_id], true),
        ),
      );

      // Record in article_locations table
      db.insert(articleLocationsTable)
        .values({
          id: `loc_${crypto.randomUUID().slice(0, 12)}`,
          groupId: group.id,
          articleId: entry.article_id,
          collectionId,
          orderSeq: i + 1,
          slug,
          directory: articleRelDir,
          createdAt: new Date().toISOString(),
        })
        .run();

      for (const [filename, content] of [
        ["article.md", articles[i].original],
        [CHINESE_ARTICLE_FILENAME, articles[i].chinese],
      ]) {
        bundleFiles.push(
          markdownFile(`${articleFullPath}/${filename}`, content),
        );
      }

      if (research) {
        bundleFiles.push(markdownFile(
          `${articleFullPath}/research.md`,
          researchWithArticleHeader(research.report_markdown, entry, true, group.timezone),
        ));
      }

      // Assets for this article
      const assets = db
        .select()
        .from(mediaAssetsTable)
        .where(eq(mediaAssetsTable.articleId, entry.article_id))
        .all();

      for (const asset of assets) {
        if (fs.existsSync(asset.blobRef)) {
          const fileBuf = fs.readFileSync(asset.blobRef);
          const assetFilePath = `${articleFullPath}/${asset.localPath}`;
          bundleFiles.push({
            path: assetFilePath,
            content_bytes: fileBuf.toString("base64"),
            encoding: "binary",
            sha256: asset.sha256,
            media_type: asset.mimeType,
          });

          bundleAssets.push({
            asset_id: asset.id,
            original_url: asset.originalUrl,
            path: assetFilePath,
            sha256: asset.sha256,
            mime_type: asset.mimeType,
            size_bytes: asset.sizeBytes,
          });
        }
      }
    }

    const batchPath = `${basePath}/batches/${dateSequence}.md`;
    manifest.collection_locations[collectionId] = {
      path: batchPath,
      date_sequence: dateSequence,
      created_at: now,
      article_ids: entries.map((entry) => entry.article_id),
    };
    bundleFiles.push(
      batchNavigationFile(group, manifest, collectionId, bundleFiles),
    );
    bundleFiles.push(...navigationFiles(group, manifest, bundleFiles));
    // Retries may encounter the same media path; send one final version per path.
    const uniqueFiles = new Map(bundleFiles.map((file) => [file.path, file]));
    bundleFiles.splice(0, bundleFiles.length, ...uniqueFiles.values());
    manifest.delivered_batches.push(batchId);
    finalizeManifest(basePath, manifest, bundleFiles);

    // 7. Save artifact bundle
    const bundle: ArtifactBundle = {
      group_id: group.id,
      run_id: runId,
      collection_id: collectionId,
      batch_id: batchId,
      snapshot_ref: `snap_${runId}`,
      kind: "collection",
      entries: articleEntries,
      assets: bundleAssets,
      files: bundleFiles,
    };

    return bundle;
  }

  async buildAndDeliverBatch(options: ArchiveInput): Promise<DeliveryResult> {
    const { group, runId, entries, researchTasks = [] } = options;
    let bundle: ArtifactBundle;
    if (!entries.length)
      bundle = {
        group_id: group.id,
        run_id: runId,
        collection_id: "",
        batch_id: `batch_${crypto.randomUUID()}`,
        snapshot_ref: `snap_${runId}`,
        kind: "collection",
        entries: [],
        assets: [],
        files: [],
      };
    else if (group.task_type === "repository_research") {
      const collection = await this.allocateCollectionSequence(
        group.id,
        group.timezone,
      );
      bundle = await buildRepositoryArchive(
        options,
        collection,
        loadManifest(group),
      );
    } else bundle = await this.buildArticleBundle(options);
    const syncResult = await publishArchive(
      group,
      bundle,
      researchTasks,
      `chore(knowledge): archive ${group.name}`,
    );
    return { bundle, syncResult };
  }

  async deliverResearchReport(
    group: Group,
    task: ResearchTask,
  ): Promise<RepositorySyncResult> {
    const db = getDb();
    const article = db
      .select()
      .from(articlesTable)
      .where(eq(articlesTable.id, task.article_id))
      .get();
    const loc = db
      .select()
      .from(articleLocationsTable)
      .where(
        and(
          eq(articleLocationsTable.groupId, group.id),
          eq(articleLocationsTable.articleId, task.article_id),
        ),
      )
      .orderBy(desc(articleLocationsTable.createdAt))
      .get();
    if (group.task_type === "repository_research" || !loc) {
      if (!article) throw new Error("归档失败：研究材料不存在");
      const researchRevision = (getSqliteDatabase().prepare('SELECT revision_hash FROM research_tasks WHERE id=?').get(task.id) as { revision_hash: string } | undefined)?.revision_hash || article.latestRevision || '';
      const revision = db
        .select()
        .from(articleRevisionsTable)
        .where(
          and(
            eq(articleRevisionsTable.articleId, article.id),
            eq(
              articleRevisionsTable.revisionHash,
              researchRevision,
            ),
          ),
        )
        .get();
      if (!revision || !fs.existsSync(revision.contentRef))
        throw new Error("归档失败：研究材料正文文件缺失");
      return (
        await this.buildAndDeliverBatch({
          group,
          runId: `research_${task.id}`,
          researchTasks: [task],
          entries: [
            {
              article_id: article.id,
              revision: researchRevision,
              slug: task.article_slug,
              title: task.article_title,
              original_url: article.canonicalUrl,
              author: article.author,
              published_at: article.publishedAt,
              tags: [],
              summary: "",
              organized_markdown: fs.readFileSync(revision.contentRef, "utf8"),
              asset_refs: [],
              evidence_refs: [],
              limitations: [],
            },
          ],
        })
      ).syncResult;
    }
    const base = group.route.base_path;
    const manifest = loadManifest(group);
    const now = new Date().toISOString();
    const item = manifest.article_locations[task.article_id] || {
      collection_id: loc.collectionId,
      directory: loc.directory,
      slug: loc.slug,
      title: article?.title || task.article_title,
      original_url: article?.canonicalUrl || "",
      tags: [],
      collected_at: loc.createdAt,
      updated_at: now,
      has_research: true,
    };
    item.updated_at = now;
    item.has_research = true;
    manifest.article_locations[task.article_id] = item;
    const researchPath = `${base}/${loc.directory}/research.md`;
    const hasChinese = !!manifest.managed_files[
      `${base}/${loc.directory}/${CHINESE_ARTICLE_FILENAME}`
    ];
    const batchId = `research_${task.id}`;
    const bundle: ArtifactBundle = {
      group_id: group.id,
      run_id: batchId,
      collection_id: loc.collectionId,
      batch_id: batchId,
      snapshot_ref: `snap_${batchId}`,
      kind: "research",
      entries: [
        {
          article_id: task.article_id,
          slug: loc.slug,
          directory: loc.directory,
          article_path: `${base}/${loc.directory}/article.md`,
          research_path: researchPath,
        },
      ],
      assets: [],
      files: [markdownFile(
        researchPath,
        researchWithArticleHeader(task.report_markdown, {
          title: task.article_title,
          original_url: article?.canonicalUrl || item.original_url,
          author: article?.author,
          published_at: article?.publishedAt,
        }, hasChinese, group.timezone),
      )],
    };
    for (const asset of db
      .select()
      .from(mediaAssetsTable)
      .where(eq(mediaAssetsTable.articleId, task.article_id))
      .all()) {
      if (fs.existsSync(asset.blobRef))
        bundle.files.push({
          path: `${base}/${loc.directory}/${asset.localPath}`,
          content_bytes: fs.readFileSync(asset.blobRef).toString("base64"),
          encoding: "binary",
          sha256: asset.sha256,
          media_type: asset.mimeType,
        });
    }
    bundle.files.push(
      markdownFile(
        `${base}/${loc.directory}/README.md`,
        articleOverview(item, hasChinese),
      ),
      ...navigationFiles(group, manifest),
    );
    if (!manifest.delivered_batches.includes(batchId))
      manifest.delivered_batches.push(batchId);
    finalizeManifest(base, manifest, bundle.files);
    return publishArchive(
      group,
      bundle,
      [task],
      `docs(research): add in-depth research for ${loc.slug}`,
    );
  }
}

export const deliveryService = new DeliveryService();
