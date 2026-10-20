import { markResearchArchived } from "../research/state.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type {
  ArtifactBundle,
  ArtifactBundleAsset,
  ArtifactBundleFile,
  Group,
  Manifest,
  RepositorySyncResult,
  ResearchTask,
  StructuredEntry,
} from "@openlore/contracts";
import {
  getDb,
  getSqliteDatabase,
} from "../../infrastructure/persistence/sqlite/db.js";
import { ManifestSchema } from "@openlore/contracts";
import {
  articleSlug,
  articleOverview,
  archiveDate,
  markdownFile,
  navigationFiles,
  finalizeManifest,
} from "./archive-layout.js";
import {
  articlesTable,
  articleRevisionsTable,
  articleLocationsTable,
  artifactBundlesTable,
  collectionsTable,
  deliveriesTable,
  mediaAssetsTable,
  repositoryConnectionsTable,
} from "../../infrastructure/persistence/sqlite/schema.js";
import { GitHubClient } from "../../infrastructure/repositories/github/client.js";
import { secretsStore } from "../../infrastructure/secrets/local_file/secrets_store.js";
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
  private loadManifest(group: Group): Manifest {
    const rows = getSqliteDatabase()
      .prepare(
        `
      SELECT b.bundle_json FROM artifact_bundles b
      JOIN deliveries d ON d.batch_id=b.batch_id AND d.group_id=b.group_id
      WHERE b.group_id=? AND d.target_kind='github' AND d.status IN ('updated','unchanged')
      ORDER BY d.created_at DESC, d.rowid DESC
    `,
      )
      .all(group.id) as Array<{ bundle_json: string }>;
    const manifestPath = `${group.route.base_path}/.openlore/manifest.json`;
    for (const row of rows) {
      const bundle = JSON.parse(row.bundle_json) as ArtifactBundle;
      const file = bundle.files.find((file) => file.path === manifestPath);
      if (file?.content_bytes)
        return ManifestSchema.parse(
          JSON.parse(
            Buffer.from(file.content_bytes, "base64").toString("utf8"),
          ),
        );
    }
    return {
      group_id: group.id,
      article_locations: {},
      collection_locations: {},
      delivered_batches: [],
      managed_files: {},
    };
  }

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

  async buildAndDeliverBatch(options: {
    group: Group;
    runId: string;
    entries: StructuredEntry[];
    researchTasks?: ResearchTask[];
  }): Promise<{ bundle: ArtifactBundle; syncResult: RepositorySyncResult }> {
    const { group, runId, entries, researchTasks = [] } = options;
    const db = getDb();
    const batchId = `batch_${crypto.randomUUID()}`;
    const basePath = group.route.base_path; // e.g. "docs/agent-learning"

    if (entries.length === 0) {
      // Zero new entries = zero files = zero empty commit
      const emptyBundle: ArtifactBundle = {
        group_id: group.id,
        run_id: runId,
        collection_id: "",
        batch_id: batchId,
        snapshot_ref: `snap_${runId}`,
        kind: "collection",
        entries: [],
        assets: [],
        files: [],
      };
      return {
        bundle: emptyBundle,
        syncResult: {
          status: "unchanged",
          changed_paths: [],
          errors: [],
        },
      };
    }

    const manifest = this.loadManifest(group);

    // Complete and validate every translation before allocating archive locations or publishing.
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
        bundleFiles.push({
          path: `${articleFullPath}/research.md`,
          content_bytes: Buffer.from(
            research.report_markdown,
            "utf-8",
          ).toString("base64"),
          encoding: "utf-8",
          sha256: crypto
            .createHash("sha256")
            .update(research.report_markdown)
            .digest("hex"),
          media_type: "text/markdown",
        });
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
      markdownFile(
        batchPath,
        `# 采集批次：${dateSequence}\n\n生成时间：${now}  \n本批共包含 ${entries.length} 篇文章：\n\n` +
          articleEntries
            .map((entry) => {
              const article = manifest.article_locations[entry.article_id];
              return (
                `- [${article.title}](../${entry.directory}/README.md)` +
                ` · [简体中文](../${entry.directory}/${CHINESE_ARTICLE_FILENAME})` +
                (article.has_research
                  ? ` · [调研](../${entry.directory}/research.md)`
                  : "")
              );
            })
            .join("\n") +
          "\n\n[返回知识首页](../README.md)\n",
      ),
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

    db.insert(artifactBundlesTable)
      .values({
        id: `bun_${crypto.randomUUID().slice(0, 12)}`,
        groupId: group.id,
        runId,
        collectionId,
        batchId,
        snapshotRef: `snap_${runId}`,
        kind: "collection",
        bundleJson: JSON.stringify(bundle),
        createdAt: new Date().toISOString(),
      })
      .run();

    // 8. GitHub sync
    let syncResult: RepositorySyncResult = {
      status: "unchanged",
      changed_paths: [],
      errors: [],
    };

    const repoConn = db
      .select()
      .from(repositoryConnectionsTable)
      .where(
        eq(repositoryConnectionsTable.id, group.route.repository_connection_id),
      )
      .get();

    if (!repoConn) throw new Error("GitHub 归档失败：仓库连接不存在");
    if (repoConn) {
      const token = secretsStore.getSecret(repoConn.credentialRef);
      if (!token) throw new Error("GitHub 归档失败：未配置仓库凭据");
      if (token) {
        const ghFiles = bundleFiles.map((f) => ({
          path: f.path,
          content: f.content_bytes!,
          encoding: f.encoding,
          sha256: f.sha256,
        }));

        const ghRes = await GitHubClient.syncFiles({
          owner: repoConn.owner,
          repo: repoConn.repo,
          branch: repoConn.defaultBranch,
          token,
          basePath,
          files: ghFiles,
          commitMessage: `chore(knowledge): archive collection batch ${dateSequence}`,
        });

        syncResult = {
          status: ghRes.status as any,
          commit_sha: ghRes.commitSha,
          commit_url: ghRes.commitUrl,
          changed_paths: ghRes.changedPaths,
          errors: ghRes.errorMessage
            ? [
                {
                  code: "sync_error",
                  message: ghRes.errorMessage,
                  retryable: true,
                },
              ]
            : [],
        };

        if (["updated", "unchanged"].includes(ghRes.status))
          markResearchArchived(researchTasks.map((task) => task.id));

        // Record delivery
        db.insert(deliveriesTable)
          .values({
            id: `del_${crypto.randomUUID().slice(0, 12)}`,
            groupId: group.id,
            batchId,
            targetKind: "github",
            status: ghRes.status,
            commitSha: ghRes.commitSha,
            commitUrl: ghRes.commitUrl,
            changedPathsJson: JSON.stringify(ghRes.changedPaths),
            errorMessage: ghRes.errorMessage,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .run();
      }
    }

    return { bundle, syncResult };
  }

  async deliverResearchReport(
    group: Group,
    task: ResearchTask,
  ): Promise<RepositorySyncResult> {
    const db = getDb();
    const basePath = group.route.base_path;

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

    if (!loc) {
      const article = db
        .select()
        .from(articlesTable)
        .where(eq(articlesTable.id, task.article_id))
        .get();
      const revision = db
        .select()
        .from(articleRevisionsTable)
        .where(
          and(
            eq(articleRevisionsTable.articleId, task.article_id),
            eq(
              articleRevisionsTable.revisionHash,
              article?.latestRevision || "",
            ),
          ),
        )
        .get();
      if (!article || !revision || !fs.existsSync(revision.contentRef))
        throw new Error("归档失败：文章正文文件缺失");
      return (
        await this.buildAndDeliverBatch({
          group,
          runId: `research_${task.id}`,
          researchTasks: [task],
          entries: [
            {
              article_id: article.id,
              revision: article.latestRevision || "",
              slug: task.article_slug,
              title: article.title || task.article_title,
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

    const researchPath = `${basePath}/${loc.directory}/research.md`;
    const reportMdContent = task.report_markdown;
    const reportSha = crypto
      .createHash("sha256")
      .update(reportMdContent)
      .digest("hex");

    const repoConn = db
      .select()
      .from(repositoryConnectionsTable)
      .where(
        eq(repositoryConnectionsTable.id, group.route.repository_connection_id),
      )
      .get();

    let syncResult: RepositorySyncResult = {
      status: "unchanged",
      changed_paths: [],
      errors: [],
    };

    if (!repoConn) throw new Error("GitHub 归档失败：仓库连接不存在");
    if (repoConn) {
      const token = secretsStore.getSecret(repoConn.credentialRef);
      if (!token) throw new Error("GitHub 归档失败：未配置仓库凭据");
      if (token) {
        const assets = db
          .select()
          .from(mediaAssetsTable)
          .where(eq(mediaAssetsTable.articleId, task.article_id))
          .all();

        const filesToSync: {
          path: string;
          content: string;
          encoding: "utf-8" | "binary";
          sha256: string;
        }[] = [
          {
            path: researchPath,
            content: Buffer.from(reportMdContent, "utf-8").toString("base64"),
            encoding: "utf-8",
            sha256: reportSha,
          },
        ];

        for (const asset of assets) {
          if (fs.existsSync(asset.blobRef)) {
            const fileBuf = fs.readFileSync(asset.blobRef);
            filesToSync.push({
              path: `${basePath}/${loc.directory}/${asset.localPath}`,
              content: fileBuf.toString("base64"),
              encoding: "binary",
              sha256: asset.sha256,
            });
          }
        }

        const manifest = this.loadManifest(group);
        const article = manifest.article_locations[task.article_id];
        if (article) {
          article.has_research = true;
          article.updated_at = new Date().toISOString();
          const files: ArtifactBundleFile[] = filesToSync.map((file) => ({
            path: file.path,
            content_bytes: file.content,
            encoding: file.encoding,
            sha256: file.sha256,
            media_type: file.path.endsWith(".md")
              ? "text/markdown"
              : "application/octet-stream",
          }));
          files.push(
            markdownFile(
              `${basePath}/${article.directory}/README.md`,
              articleOverview(
                article,
                !!manifest.managed_files[
                  `${basePath}/${article.directory}/${CHINESE_ARTICLE_FILENAME}`
                ],
              ),
            ),
            ...navigationFiles(group, manifest),
          );
          const batchId = `research_${task.id}`;
          if (!manifest.delivered_batches.includes(batchId))
            manifest.delivered_batches.push(batchId);
          finalizeManifest(basePath, manifest, files);
          filesToSync.splice(
            0,
            filesToSync.length,
            ...files.map((file) => ({
              path: file.path,
              content: file.content_bytes!,
              encoding: file.encoding,
              sha256: file.sha256,
            })),
          );
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
                slug: article.slug,
                directory: article.directory,
              },
            ],
            assets: [],
            files,
          };
          db.insert(artifactBundlesTable)
            .values({
              id: `bun_${batchId}`,
              groupId: group.id,
              runId: batchId,
              collectionId: loc.collectionId,
              batchId,
              snapshotRef: bundle.snapshot_ref,
              kind: "research",
              bundleJson: JSON.stringify(bundle),
              createdAt: new Date().toISOString(),
            })
            .onConflictDoUpdate({
              target: artifactBundlesTable.id,
              set: { bundleJson: JSON.stringify(bundle) },
            })
            .run();
        }

        const ghRes = await GitHubClient.syncFiles({
          owner: repoConn.owner,
          repo: repoConn.repo,
          branch: repoConn.defaultBranch,
          token,
          basePath,
          files: [
            ...new Map(filesToSync.map((file) => [file.path, file])).values(),
          ],
          commitMessage: `docs(research): add in-depth research for ${loc.slug}`,
        });

        if (["updated", "unchanged"].includes(ghRes.status))
          markResearchArchived([task.id]);

        const record = {
          id: `research_delivery_${task.id}`,
          groupId: group.id,
          batchId: `research_${task.id}`,
          targetKind: "github",
          status: ghRes.status,
          commitSha: ghRes.commitSha || null,
          commitUrl: ghRes.commitUrl || null,
          changedPathsJson: JSON.stringify(ghRes.changedPaths),
          errorMessage: ghRes.errorMessage || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        db.insert(deliveriesTable)
          .values(record)
          .onConflictDoUpdate({
            target: deliveriesTable.id,
            set: record,
          })
          .run();

        syncResult = {
          status: ghRes.status as any,
          commit_sha: ghRes.commitSha,
          commit_url: ghRes.commitUrl,
          changed_paths: ghRes.changedPaths,
          errors: ghRes.errorMessage
            ? [
                {
                  code: "sync_error",
                  message: ghRes.errorMessage,
                  retryable: true,
                },
              ]
            : [],
        };
      }
    }

    return syncResult;
  }
}

export const deliveryService = new DeliveryService();
