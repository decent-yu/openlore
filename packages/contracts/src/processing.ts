import { z } from 'zod';

export const DecisionSchema = z.object({
  article_id: z.string(),
  revision: z.string(),
  decision: z.enum(['selected', 'excluded', 'pending', 'deferred']),
  reason: z.string(),
  matched_source_ids: z.array(z.string()).default([]),
  scores: z
    .object({
      relevance: z.number().min(0).max(100),
      quality: z.number().min(0).max(100),
      overall: z.number().min(0).max(100),
    })
    .optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const StructuredEntrySchema = z.object({
  article_id: z.string(),
  revision: z.string(),
  slug: z.string(),
  title: z.string(),
  original_url: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  summary: z.string(),
  organized_markdown: z.string(),
  asset_refs: z.array(z.string()).default([]),
  evidence_refs: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
});
export type StructuredEntry = z.infer<typeof StructuredEntrySchema>;

export const ProcessingRequestSchema = z.object({
  run_id: z.string(),
  group_id: z.string(),
  group_revision: z.string(),
  items: z.array(
    z.object({
      article_id: z.string(),
      revision: z.string(),
      content_ref: z.string(),
      source_ids: z.array(z.string()),
      title: z.string().optional(),
      url: z.string().optional(),
    }),
  ),
  focus: z.string(),
  preferences: z.string().default(''),
  ai_profile_ref: z.string(),
  skill_ref: z.string().default('openlore-article-organizer'),
  skill_revision: z.string().default('v1'),
  prompt_revision: z.string().default('v1'),
  budget: z.object({
    selected_limit: z.number().int().positive().default(10),
    deadline: z.string().optional(),
  }),
});
export type ProcessingRequest = z.infer<typeof ProcessingRequestSchema>;

export const ProcessingResultSchema = z.object({
  status: z.enum(['success', 'partial', 'failed']),
  decisions: z.array(DecisionSchema).default([]),
  entries: z.array(StructuredEntrySchema).default([]),
  bundle_ref: z.string().nullable().optional(),
  batch_id: z.string().nullable().optional(),
  errors: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        article_id: z.string().optional(),
        retryable: z.boolean(),
      }),
    )
    .default([]),
});
export type ProcessingResult = z.infer<typeof ProcessingResultSchema>;
