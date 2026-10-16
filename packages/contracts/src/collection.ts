import { z } from 'zod';

export const ContentBodySchema = z.object({
  value: z.string(),
  format: z.enum(['html', 'text', 'markdown']),
  completeness: z.enum(['full', 'summary', 'empty', 'unknown']),
});
export type ContentBody = z.infer<typeof ContentBodySchema>;

export const ContentAttachmentSchema = z.object({
  url: z.string(),
  kind: z.string(),
  fetched: z.boolean(),
});
export type ContentAttachment = z.infer<typeof ContentAttachmentSchema>;

export const ContentItemSchema = z.object({
  source_item_id: z.string(),
  source_id: z.string(),
  native_id: z.string().nullable().optional(),
  original_url: z.string().nullable().optional(),
  final_url: z.string().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  categories: z.array(z.string()).optional(),
  date_evidence: z.record(z.unknown()).optional(),
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  body: ContentBodySchema,
  attachments: z.array(ContentAttachmentSchema).default([]),
  fetched_at: z.string(),
  fetch_method: z.string(),
  raw_ref: z.string().nullable().optional(),
  issues: z.array(z.string()).default([]),
});
export type ContentItem = z.infer<typeof ContentItemSchema>;

export const CollectionErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  source_item_id: z.string().optional(),
  retryable: z.boolean(),
  retry_after_seconds: z.number().nullable().optional(),
});
export type CollectionError = z.infer<typeof CollectionErrorSchema>;

export const CollectionRequestSchema = z.object({
  run_id: z.string(),
  source_id: z.string(),
  source_revision: z.string(),
  capability_id: z.string(),
  operation: z.enum(['discover', 'fetch']),
  target: z.object({
    url: z.string(),
    source_item_id: z.string().optional(),
  }),
  scope: z.object({
    since: z.string().nullable().optional(),
    until: z.string().nullable().optional(),
    limit: z.number().int().positive().default(100),
  }),
  state: z.record(z.unknown()).nullable().optional(),
  credential_ref: z.string().nullable().optional(),
  options: z.record(z.unknown()).default({}),
  budget: z.object({
    timeout_seconds: z.number().default(30),
    max_requests: z.number().default(10),
  }),
});
export type CollectionRequest = z.infer<typeof CollectionRequestSchema>;

export const CollectionResultSchema = z.object({
  run_id: z.string(),
  source_id: z.string(),
  capability_id: z.string(),
  status: z.enum(['success', 'partial', 'failed', 'not_modified']),
  items: z.array(ContentItemSchema).default([]),
  next_state: z.record(z.unknown()).nullable().optional(),
  scan: z.enum(['complete', 'more', 'limited', 'unknown']),
  errors: z.array(CollectionErrorSchema).default([]),
  observed_at: z.string(),
  stats: z.object({
    requests: z.number().int().nonnegative(),
    items_observed: z.number().int().nonnegative(),
    items_returned: z.number().int().nonnegative(),
    items_filtered: z.number().int().nonnegative().optional(),
    items_new: z.number().int().nonnegative().optional(),
    quality_counts: z.record(z.number()).optional(),
    processing_reasons: z.record(z.number()).optional(),
    queued: z.number().int().nonnegative().optional(),
  }),
});
export type CollectionResult = z.infer<typeof CollectionResultSchema>;
