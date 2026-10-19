import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import type {
  ArtifactBundle,
  ArtifactBundleAsset,
  ArtifactBundleFile,
  Group,
  Manifest,
  RepositorySyncResult,
  ResearchTask,
  StructuredEntry,
} from '@openlore/contracts';
import { getAppPaths } from '../../infrastructure/config/paths.js';
import { getDb } from '../../infrastructure/persistence/sqlite/db.js';
import {
  articleLocationsTable,
  artifactBundlesTable,
  collectionsTable,
  deliveriesTable,
  mediaAssetsTable,
  repositoryConnectionsTable,
} from '../../infrastructure/persistence/sqlite/schema.js';
import { GitHubClient } from '../../infrastructure/repositories/github/client.js';
import { secretsStore } from '../../infrastructure/secrets/local_file/secrets_store.js';

export class DeliveryService {
  async allocateCollectionSequence(groupId: string, timezone: string = 'Asia/Shanghai'): Promise<{ collectionId: string; dateSequence: string }> {
    const db = getDb();
    const now = new Date();
    // Format YYYYMMDD in group timezone
    const yyyymmdd = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(now)
      .replace(/-/g, '');

    // Count existing collections for this day and group
    const todayCols = db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.groupId, groupId))
      .all()
      .filter((c) => c.dateSequence.startsWith(yyyymmdd));

    const nextSeqNum = todayCols.length + 1;
    const dateSequence = `${yyyymmdd}-${String(nextSeqNum).padStart(2, '0')}`;
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
    const paths = getAppPaths();
    const batchId = `batch_${Date.now()}`;
    const basePath = group.route.base_path; // e.g. "docs/agent-leaning"

    if (entries.length === 0) {
      // Zero new entries = zero files = zero empty commit
      const emptyBundle: ArtifactBundle = {
        group_id: group.id,
        run_id: runId,
        collection_id: '',
        batch_id: batchId,
        snapshot_ref: `snap_${runId}`,
        kind: 'collection',
        entries: [],
        assets: [],
        files: [],
      };
      return {
        bundle: emptyBundle,
        syncResult: {
          status: 'unchanged',
          changed_paths: [],
          errors: [],
        },
      };
    }

    // 1. Allocate collection date sequence (e.g. 20261015-01)
    const { collectionId, dateSequence } = await this.allocateCollectionSequence(
      group.id,
      group.timezone,
    );

    const bundleFiles: ArtifactBundleFile[] = [];
    const bundleAssets: ArtifactBundleAsset[] = [];
    const articleEntries: ArtifactBundle['entries'] = [];

    // Map manifest locations
    const manifestArticleLocations: Record<string, { collection_id: string; directory: string; slug: string }> = {};

    // 2. Process each article
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const order = String(i + 1).padStart(2, '0');
      const articleDirName = `${order}-${entry.slug}`;
      const articleRelDir = `${dateSequence}/${articleDirName}`;
      const articleFullPath = `${basePath}/${articleRelDir}`;

      articleEntries.push({
        article_id: entry.article_id,
        slug: entry.slug,
        directory: articleRelDir,
      });

      manifestArticleLocations[entry.article_id] = {
        collection_id: collectionId,
        directory: articleRelDir,
        slug: entry.slug,
      };

      // Record in article_locations table
      db.insert(articleLocationsTable)
        .values({
          id: `loc_${crypto.randomUUID().slice(0, 12)}`,
          groupId: group.id,
          articleId: entry.article_id,
          collectionId,
          orderSeq: i + 1,
          slug: entry.slug,
          directory: articleRelDir,
          createdAt: new Date().toISOString(),
        })
        .run();

      const research = researchTasks.find((task) => task.article_id === entry.article_id);
      // Build article.md
      const articleMdContent =
        `# ${entry.title}\n\n` +
        `> **来源**: [${entry.original_url || '原文链接'}](${entry.original_url || '#'})  \n` +
        `> **作者**: ${entry.author || '未知'} | **发布时间**: ${entry.published_at || '未知'}  \n` +
        (research ? `> **深度调研**: [查看专题调研报告](research.md)  \n` : '') +
        `> **标签**: ${entry.tags.join(', ')}\n\n` +
        `---\n\n` +
        `## AI 导读\n\n` +
        `${entry.summary}\n\n` +
        `---\n\n` +
        `## 原文整理\n\n` +
        `${entry.organized_markdown}\n`;

      const artMdSha = crypto.createHash('sha256').update(articleMdContent).digest('hex');
      bundleFiles.push({
        path: `${articleFullPath}/article.md`,
        content_bytes: Buffer.from(articleMdContent, 'utf-8').toString('base64'),
        encoding: 'utf-8',
        sha256: artMdSha,
        media_type: 'text/markdown',
      });

      if (research) {
        bundleFiles.push({
          path: `${articleFullPath}/research.md`,
          content_bytes: Buffer.from(research.report_markdown, 'utf-8').toString('base64'),
          encoding: 'utf-8',
          sha256: crypto.createHash('sha256').update(research.report_markdown).digest('hex'),
          media_type: 'text/markdown',
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
            content_bytes: fileBuf.toString('base64'),
            encoding: 'binary',
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

    // 3. Batch navigation README.md
    const batchReadmeContent =
      `# 任务批次：${dateSequence}\n\n` +
      `生成时间：${new Date().toISOString()}  \n` +
      `本批共包含 ${entries.length} 篇精选文章：\n\n` +
      entries
        .map(
          (e, idx) =>
            `- [${e.title}](${String(idx + 1).padStart(2, '0')}-${e.slug}/article.md)` +
            (researchTasks.some((task) => task.article_id === e.article_id) ? ` ([调研报告](${String(idx + 1).padStart(2, '0')}-${e.slug}/research.md))` : ''),
        )
        .join('\n') +
      '\n';

    const batchReadmeSha = crypto.createHash('sha256').update(batchReadmeContent).digest('hex');
    bundleFiles.push({
      path: `${basePath}/${dateSequence}/README.md`,
      content_bytes: Buffer.from(batchReadmeContent, 'utf-8').toString('base64'),
      encoding: 'utf-8',
      sha256: batchReadmeSha,
      media_type: 'text/markdown',
    });

    // 5. Root group README.md
    const groupReadmeContent =
      `# ${group.name}\n\n` +
      `${group.description}\n\n` +
      `## 历史任务批次\n\n` +
      `- [批次 ${dateSequence}](${dateSequence}/README.md)（${entries.length} 篇文章）\n`;

    const groupReadmeSha = crypto.createHash('sha256').update(groupReadmeContent).digest('hex');
    bundleFiles.push({
      path: `${basePath}/README.md`,
      content_bytes: Buffer.from(groupReadmeContent, 'utf-8').toString('base64'),
      encoding: 'utf-8',
      sha256: groupReadmeSha,
      media_type: 'text/markdown',
    });

    // 6. Manifest .openlore/manifest.json
    const manifest: Manifest = {
      group_id: group.id,
      article_locations: manifestArticleLocations,
      collection_locations: {
        [collectionId]: { directory: `${basePath}/${dateSequence}` },
      },
      delivered_batches: [batchId],
      managed_files: Object.fromEntries(
        bundleFiles.map((f) => [
          f.path,
          {
            sha256: f.sha256,
            media_type: f.media_type,
            size: f.content_bytes ? Buffer.from(f.content_bytes, 'base64').length : 0,
          },
        ]),
      ),
    };

    const manifestJson = JSON.stringify(manifest, null, 2);
    const manifestSha = crypto.createHash('sha256').update(manifestJson).digest('hex');
    bundleFiles.push({
      path: `${basePath}/.openlore/manifest.json`,
      content_bytes: Buffer.from(manifestJson, 'utf-8').toString('base64'),
      encoding: 'utf-8',
      sha256: manifestSha,
      media_type: 'application/json',
    });

    // 7. Save artifact bundle
    const bundle: ArtifactBundle = {
      group_id: group.id,
      run_id: runId,
      collection_id: collectionId,
      batch_id: batchId,
      snapshot_ref: `snap_${runId}`,
      kind: 'collection',
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
        kind: 'collection',
        bundleJson: JSON.stringify(bundle),
        createdAt: new Date().toISOString(),
      })
      .run();

    // 8. GitHub sync
    let syncResult: RepositorySyncResult = {
      status: 'unchanged',
      changed_paths: [],
      errors: [],
    };

    const repoConn = db
      .select()
      .from(repositoryConnectionsTable)
      .where(eq(repositoryConnectionsTable.id, group.route.repository_connection_id))
      .get();

    if (!repoConn) throw new Error('GitHub 归档失败：仓库连接不存在');
    if (repoConn) {
      const token = secretsStore.getSecret(repoConn.credentialRef);
      if (!token) throw new Error('GitHub 归档失败：未配置仓库凭据');
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
            ? [{ code: 'sync_error', message: ghRes.errorMessage, retryable: true }]
            : [],
        };

        // Record delivery
        db.insert(deliveriesTable)
          .values({
            id: `del_${crypto.randomUUID().slice(0, 12)}`,
            groupId: group.id,
            batchId,
            targetKind: 'github',
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
      .get();

    if (!loc) {
      throw Object.assign(new Error('文章尚未建立归档位置，请先运行所属流水线完成归档'), { statusCode: 409 });
    }

    const researchPath = `${basePath}/${loc.directory}/research.md`;
    const reportMdContent = task.report_markdown;
    const reportSha = crypto.createHash('sha256').update(reportMdContent).digest('hex');

    const repoConn = db
      .select()
      .from(repositoryConnectionsTable)
      .where(eq(repositoryConnectionsTable.id, group.route.repository_connection_id))
      .get();

    let syncResult: RepositorySyncResult = {
      status: 'unchanged',
      changed_paths: [],
      errors: [],
    };

    if (!repoConn) throw new Error('GitHub 归档失败：仓库连接不存在');
    if (repoConn) {
      const token = secretsStore.getSecret(repoConn.credentialRef);
      if (!token) throw new Error('GitHub 归档失败：未配置仓库凭据');
      if (token) {
        const assets = db
          .select()
          .from(mediaAssetsTable)
          .where(eq(mediaAssetsTable.articleId, task.article_id))
          .all();

        const filesToSync: { path: string; content: string; encoding: 'utf-8' | 'binary'; sha256: string }[] = [
          {
            path: researchPath,
            content: Buffer.from(reportMdContent, 'utf-8').toString('base64'),
            encoding: 'utf-8',
            sha256: reportSha,
          },
        ];

        for (const asset of assets) {
          if (fs.existsSync(asset.blobRef)) {
            const fileBuf = fs.readFileSync(asset.blobRef);
            filesToSync.push({
              path: `${basePath}/${loc.directory}/${asset.localPath}`,
              content: fileBuf.toString('base64'),
              encoding: 'binary',
              sha256: asset.sha256,
            });
          }
        }

        const ghRes = await GitHubClient.syncFiles({
          owner: repoConn.owner,
          repo: repoConn.repo,
          branch: repoConn.defaultBranch,
          token,
          basePath,
          files: filesToSync,
          commitMessage: `docs(research): add in-depth research for ${loc.slug}`,
        });

        const record = {
          id: `research_delivery_${task.id}`,
          groupId: group.id,
          batchId: `research_${task.id}`,
          targetKind: 'github',
          status: ghRes.status,
          commitSha: ghRes.commitSha || null,
          commitUrl: ghRes.commitUrl || null,
          changedPathsJson: JSON.stringify(ghRes.changedPaths),
          errorMessage: ghRes.errorMessage || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        db.insert(deliveriesTable).values(record).onConflictDoUpdate({
          target: deliveriesTable.id,
          set: record,
        }).run();

        syncResult = {
          status: ghRes.status as any,
          commit_sha: ghRes.commitSha,
          commit_url: ghRes.commitUrl,
          changed_paths: ghRes.changedPaths,
          errors: ghRes.errorMessage
            ? [{ code: 'sync_error', message: ghRes.errorMessage, retryable: true }]
            : [],
        };
      }
    }

    return syncResult;
  }
}

export const deliveryService = new DeliveryService();
