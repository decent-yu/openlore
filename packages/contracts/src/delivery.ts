import { z } from "zod";
import { WikiDisplayConfigSchema } from "./wiki.js";
export { WikiDisplayConfigSchema, buildWikiUrl } from "./wiki.js";

export const RepositoryConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.string(),
  owner: z.string(),
  repo: z.string(),
  default_branch: z.string(),
  credential_ref: z.string(),
  ...WikiDisplayConfigSchema.shape,
  state: z.enum([
    "ready",
    "invalid_credential",
    "repo_not_found",
    "branch_protected",
    "unknown",
  ]),
});
export type RepositoryConnection = z.infer<typeof RepositoryConnectionSchema>;

export const NotificationConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.string(),
  url_secret_ref: z.string(),
  protocol: z.literal("generic_json"),
  state: z.enum(["ready", "failed"]),
});
export type NotificationConnection = z.infer<
  typeof NotificationConnectionSchema
>;

export const GroupRouteSchema = z.object({
  repository_connection_id: z.string(),
  base_path: z.string(),
});
export type GroupRoute = z.infer<typeof GroupRouteSchema>;

export const ArtifactBundleFileSchema = z.object({
  path: z.string(),
  content_ref: z.string().optional(),
  content_bytes: z.string().optional(), // base64 representation if direct
  encoding: z.enum(["utf-8", "binary"]),
  sha256: z.string(),
  media_type: z.string(),
  expected_remote_sha256: z.string().optional(),
});
export type ArtifactBundleFile = z.infer<typeof ArtifactBundleFileSchema>;

export const ArtifactBundleAssetSchema = z.object({
  asset_id: z.string(),
  original_url: z.string(),
  path: z.string(),
  sha256: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
});
export type ArtifactBundleAsset = z.infer<typeof ArtifactBundleAssetSchema>;

export const ArtifactBundleSchema = z.object({
  group_id: z.string(),
  run_id: z.string(),
  collection_id: z.string(),
  batch_id: z.string(),
  snapshot_ref: z.string(),
  kind: z.enum(["collection", "research", "digest", "resync", "repair"]),
  entries: z.array(
    z.object({
      article_id: z.string(),
      slug: z.string(),
      directory: z.string(),
      article_path: z.string().optional(),
      research_path: z.string().optional(),
    }),
  ),
  assets: z.array(ArtifactBundleAssetSchema).default([]),
  files: z.array(ArtifactBundleFileSchema),
  base_manifest_ref: z.string().nullable().optional(),
});
export type ArtifactBundle = z.infer<typeof ArtifactBundleSchema>;

export const RepositorySyncResultSchema = z.object({
  status: z.enum([
    "updated",
    "unchanged",
    "blocked",
    "conflict",
    "unknown",
    "failed",
  ]),
  commit_sha: z.string().optional(),
  commit_url: z.string().optional(),
  changed_paths: z.array(z.string()).default([]),
  errors: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        retryable: z.boolean(),
      }),
    )
    .default([]),
});
export type RepositorySyncResult = z.infer<typeof RepositorySyncResultSchema>;

export const NotificationResultSchema = z.object({
  status: z.enum(["sent", "skipped", "failed", "unknown"]),
  platform_response: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type NotificationResult = z.infer<typeof NotificationResultSchema>;

export const ManifestSchema = z.object({
  group_id: z.string(),
  article_locations: z.record(
    z.object({
      collection_id: z.string(),
      directory: z.string(),
      slug: z.string(),
      title: z.string(),
      original_url: z.string(),
      tags: z.array(z.string()),
      collected_at: z.string(),
      updated_at: z.string(),
      has_research: z.boolean(),
      reading_path: z.string().optional(),
      article_path: z.string().optional(),
      research_path: z.string().optional(),
    }),
  ),
  collection_locations: z.record(
    z.object({
      path: z.string(),
      date_sequence: z.string(),
      created_at: z.string(),
      article_ids: z.array(z.string()),
    }),
  ),
  delivered_batches: z.array(z.string()),
  managed_files: z.record(
    z.object({
      sha256: z.string(),
      media_type: z.string(),
      size: z.number().int().nonnegative(),
    }),
  ),
});
export type Manifest = z.infer<typeof ManifestSchema>;
