import crypto from "node:crypto";
import fs from "node:fs";
import {
  repositoryStudy,
  type ArtifactBundle,
  type Manifest,
} from "@openlore/contracts";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { safeRelativePath } from "../../infrastructure/ai/skill_bundle.js";
import {
  articleSlug,
  markdownFile,
  navigationFiles,
  finalizeManifest,
  batchNavigationFile,
} from "./archive-layout.js";
import type { ArchiveInput } from "./publication.js";

/** Repository studies archive each report once, directly beneath its repository directory. */
export async function buildRepositoryArchive(
  input: ArchiveInput,
  collection: { collectionId: string; dateSequence: string },
  manifest: Manifest,
): Promise<ArtifactBundle> {
  const { group, runId, entries, researchTasks = [] } = input;
  const base = group.route.base_path;
  const now = new Date().toISOString();
  const db = getSqliteDatabase();
  const bundle: ArtifactBundle = {
    group_id: group.id,
    run_id: runId,
    collection_id: collection.collectionId,
    batch_id: `batch_${crypto.randomUUID()}`,
    snapshot_ref: `snap_${runId}`,
    kind: "collection",
    entries: [],
    assets: [],
    files: [],
  };
  for (const entry of entries) {
    const row = db
      .prepare("SELECT date_evidence_json FROM articles WHERE id=?")
      .get(entry.article_id) as { date_evidence_json: string } | undefined;
    const task = researchTasks.find(
      (task) =>
        task.article_id === entry.article_id &&
        task.status === "succeeded" &&
        task.report_markdown.trim(),
    );
    const study = task?.repository_study || repositoryStudy(JSON.parse(row?.date_evidence_json || "{}"));
    if (!study || !task)
      throw new Error("仓库归档需要仓库信息与已完成的研报");
    const existing = manifest.article_locations[entry.article_id];
    const location = db
      .prepare(
        "SELECT directory,order_seq FROM article_locations WHERE group_id=? AND article_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(group.id, entry.article_id) as
      { directory: string; order_seq: number } | undefined;
    const prefix = `${study.directory}/`;
    const order =
      location?.order_seq ??
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(order_seq),0)+1 n FROM article_locations WHERE group_id=? AND substr(directory,1,length(?))=?",
          )
          .get(group.id, prefix, prefix) as { n: number }
      ).n;
    const directory =
      existing?.directory ||
      location?.directory ||
      `${prefix}${String(order).padStart(2, "0")}-${articleSlug(entry.title)}`;
    const stem = directory.split("/").at(-1)!;
    const reportPath = `${directory}.md`;
    const assetRoot = `${study.directory}/assets/${stem}`;
    const report = task.report_markdown.replace(
      /(\]\()(?:\.\/)?assets\//g,
      `$1./assets/${stem}/`,
    );
    bundle.files.push(markdownFile(`${base}/${reportPath}`, report));
    bundle.entries.push({
      article_id: entry.article_id,
      slug: entry.slug,
      directory,
      research_path: `${base}/${reportPath}`,
    });
    manifest.article_locations[entry.article_id] = {
      collection_id: existing?.collection_id || collection.collectionId,
      directory,
      slug: entry.slug,
      title: entry.title,
      original_url: study.repository_url,
      tags: entry.tags,
      collected_at: existing?.collected_at || now,
      updated_at: now,
      has_research: true,
      reading_path: reportPath,
      research_path: reportPath,
    };
    if (!location)
      db.prepare(
        "INSERT INTO article_locations(id,group_id,article_id,collection_id,order_seq,slug,directory,created_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        `loc_${crypto.randomUUID()}`,
        group.id,
        entry.article_id,
        collection.collectionId,
        order,
        entry.slug,
        directory,
        now,
      );
    for (const asset of db
      .prepare("SELECT * FROM media_assets WHERE article_id=?")
      .all(entry.article_id) as Array<{
      id: string;
      local_path: string;
      blob_ref: string;
      sha256: string;
      mime_type: string;
      size_bytes: number;
      original_url: string;
    }>) {
      if (!fs.existsSync(asset.blob_ref)) continue;
      safeRelativePath(asset.local_path);
      const assetPath = `${base}/${assetRoot}/${asset.local_path.replace(/^assets\//, "")}`;
      bundle.files.push({
        path: assetPath,
        content_bytes: fs.readFileSync(asset.blob_ref).toString("base64"),
        encoding: "binary",
        sha256: asset.sha256,
        media_type: asset.mime_type,
      });
      bundle.assets.push({
        asset_id: asset.id,
        path: assetPath,
        original_url: asset.original_url,
        sha256: asset.sha256,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
      });
    }
  }
  manifest.collection_locations[collection.collectionId] = {
    path: `${base}/batches/${collection.dateSequence}.md`,
    date_sequence: collection.dateSequence,
    created_at: now,
    article_ids: entries.map((entry) => entry.article_id),
  };
  bundle.files.push(
    batchNavigationFile(group, manifest, collection.collectionId, bundle.files),
    ...navigationFiles(group, manifest, bundle.files),
  );
  manifest.delivered_batches.push(bundle.batch_id);
  finalizeManifest(base, manifest, bundle.files);
  bundle.files = [
    ...new Map(bundle.files.map((file) => [file.path, file])).values(),
  ];
  return bundle;
}
