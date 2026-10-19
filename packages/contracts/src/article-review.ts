import { z } from "zod";

export const ArticleAssessmentSchema = z.object({
  quality: z.number().finite().min(0).max(100),
  positioning: z.string().trim().min(1).max(400),
  summary: z.string().trim().min(1).max(1600),
  tags: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  reason: z.string().trim().min(1).max(1200),
  evidence_refs: z.array(z.string().trim().min(16).max(2000)).min(1).max(10),
});
export type ArticleAssessment = z.infer<typeof ArticleAssessmentSchema>;
export const ArticleReviewSchema = z.object({
  status: z.enum(["queued", "running", "succeeded", "failed", "insufficient"]),
  result: ArticleAssessmentSchema.nullable(),
  error_message: z.string().nullable(),
  assessed_at: z.string().nullable(),
  log_id: z.string().nullable(),
  material_issue: z.string().optional(),
});
export type ArticleReview = z.infer<typeof ArticleReviewSchema>;
export const ReviewArticlesRequestSchema = z.object({
  article_ids: z.array(z.string().min(1)).min(1).max(100),
  force: z.boolean().default(false),
});
export const ArticleSelectionSchema = z.object({
  selected: z
    .array(
      z.object({
        article_id: z.string().min(1),
        reason: z.string().trim().min(1).max(1200),
      }),
    )
    .max(100),
});
