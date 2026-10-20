import { eq } from "drizzle-orm";
import {
  ManifestSchema,
  type ArtifactBundle,
  type Group,
  type Manifest,
  type RepositorySyncResult,
  type ResearchTask,
  type StructuredEntry,
} from "@openlore/contracts";
import {
  getDb,
  getSqliteDatabase,
} from "../../infrastructure/persistence/sqlite/db.js";
import {
  artifactBundlesTable,
  deliveriesTable,
  repositoryConnectionsTable,
} from "../../infrastructure/persistence/sqlite/schema.js";
import { GitHubClient } from "../../infrastructure/repositories/github/client.js";
import { secretsStore } from "../../infrastructure/secrets/local_file/secrets_store.js";
import { markResearchArchived } from "../research/state.js";

export type { ArchiveInput, DeliveryResult } from "@openlore/contracts";
export function loadManifest(group: Group): Manifest {
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT b.bundle_json FROM artifact_bundles b JOIN deliveries d ON d.batch_id=b.batch_id AND d.group_id=b.group_id
    WHERE b.group_id=? AND d.target_kind='github' AND d.status IN ('updated','unchanged') ORDER BY d.created_at DESC,d.rowid DESC`,
    )
    .all(group.id) as { bundle_json: string }[];
  for (const row of rows) {
    const bundle = JSON.parse(row.bundle_json) as ArtifactBundle;
    const file = bundle.files.find(
      (file) =>
        file.path === `${group.route.base_path}/.openlore/manifest.json`,
    );
    if (file?.content_bytes)
      return ManifestSchema.parse(
        JSON.parse(Buffer.from(file.content_bytes, "base64").toString("utf8")),
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

/** Both task types publish the same bundle and produce the same acknowledgement. */
export async function publishArchive(
  group: Group,
  bundle: ArtifactBundle,
  researchTasks: ResearchTask[],
  commitMessage: string,
): Promise<RepositorySyncResult> {
  if (!bundle.files.length)
    return { status: "unchanged", changed_paths: [], errors: [] };
  const db = getDb();
  const record = {
    id: `bun_${bundle.batch_id}`,
    groupId: group.id,
    runId: bundle.run_id,
    collectionId: bundle.collection_id,
    batchId: bundle.batch_id,
    snapshotRef: bundle.snapshot_ref,
    kind: bundle.kind,
    bundleJson: JSON.stringify(bundle),
    createdAt: new Date().toISOString(),
  };
  db.insert(artifactBundlesTable)
    .values(record)
    .onConflictDoUpdate({
      target: artifactBundlesTable.id,
      set: { bundleJson: record.bundleJson },
    })
    .run();
  const repository = db
    .select()
    .from(repositoryConnectionsTable)
    .where(
      eq(repositoryConnectionsTable.id, group.route.repository_connection_id),
    )
    .get();
  if (!repository) throw new Error("GitHub 归档失败：仓库连接不存在");
  const token = secretsStore.getSecret(repository.credentialRef);
  if (!token) throw new Error("GitHub 归档失败：未配置仓库凭据");
  const result = await GitHubClient.syncFiles({
    owner: repository.owner,
    repo: repository.repo,
    branch: repository.defaultBranch,
    token,
    basePath: group.route.base_path,
    commitMessage,
    files: [
      ...new Map(bundle.files.map((file) => [file.path, file])).values(),
    ].map((file) => ({
      path: file.path,
      content: file.content_bytes!,
      encoding: file.encoding,
      sha256: file.sha256,
    })),
  });
  const delivery = {
    id: `delivery_${bundle.batch_id}`,
    groupId: group.id,
    batchId: bundle.batch_id,
    targetKind: "github",
    status: result.status,
    commitSha: result.commitSha || null,
    commitUrl: result.commitUrl || null,
    changedPathsJson: JSON.stringify(result.changedPaths),
    errorMessage: result.errorMessage || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.insert(deliveriesTable)
    .values(delivery)
    .onConflictDoUpdate({ target: deliveriesTable.id, set: delivery })
    .run();
  if (["updated", "unchanged"].includes(result.status))
    markResearchArchived(researchTasks.map((task) => task.id));
  return {
    status: result.status,
    commit_sha: result.commitSha,
    commit_url: result.commitUrl,
    changed_paths: result.changedPaths,
    errors: result.errorMessage
      ? [{ code: "sync_error", message: result.errorMessage, retryable: true }]
      : [],
  };
}
