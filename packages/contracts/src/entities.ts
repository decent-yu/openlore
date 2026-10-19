import { z } from 'zod';
import { ExecutionResultSchema } from './execution.js';
import { GroupRouteSchema } from './delivery.js';

export const SourceCapabilitySchema = z.enum([
  'web_feed',
  'web_page',
  'github_api',
  'platform',
]);
export type SourceCapability = z.infer<typeof SourceCapabilitySchema>;

export const SourceOptionsSchema = z.object({
  poll_interval_mins: z.number().int().min(1).max(10080).default(30),
  keywords: z.array(z.string().trim().min(1)).default([]),
  excluded_keywords: z.array(z.string().trim().min(1)).default([]),
  keyword_mode: z.enum(['any', 'all']).default('any'),
  keyword_policy: z.enum(['assist', 'strict']).default('assist'),
  max_age_days: z.number().int().min(1).max(3650).default(30),
  current_year_only: z.boolean().default(true),
  verify_publication_date: z.boolean().default(true),
  excluded_categories: z.array(z.string().trim().min(1)).default(['Company', 'Company Announcements', 'Global Affairs']),
});
export type SourceOptions = z.infer<typeof SourceOptionsSchema>;

export const SourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  description: z.string().default(''),
  capability_id: z.string().default('web_feed'),
  enabled: z.boolean().default(true),
  options: SourceOptionsSchema.default({}),
  quality_stats: z.record(z.number()).optional(),
  last_polled_at: z.string().nullable().optional(),
  last_success_at: z.string().nullable().optional(),
  last_error: z.string().nullable().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  preferences: z.string().default(''),
  enabled: z.boolean().default(true),
  route: GroupRouteSchema,
  source_ids: z.array(z.string()).default([]),
  schedule_cron: z.string().default('0 8 * * *'),
  timezone: z.string().default('Asia/Shanghai'),
  deep_analysis_count: z.number().int().nonnegative().default(3),
  research_instructions: z.string().default(''),
  ai_profile_id: z.string().nullable().optional(),
  assessment_skill_id: z.string().default('tech-article-extractor'),
  research_skill_id: z.string().default('deep-research-expert'),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Group = z.infer<typeof GroupSchema>;

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string().optional(),
  revision: z.string().optional(),
  type: z.string().default('extraction'),
  tags: z.array(z.string()).default([]),
  system_prompt: z.string(),
  file_path: z.string(),
});
export type Skill = z.infer<typeof SkillSchema>;

export const DailyFeedArticleSchema = z.object({
  wiki_url: z.string().optional(),
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  author: z.string().nullable().optional(),
  original_url: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  summary: z.string(),
  tags: z.array(z.string()).default([]),
  group_id: z.string(),
  group_name: z.string(),
  score: z.number().optional(),
  is_deep_analyzed: z.boolean().default(false),
  user_interested: z.boolean().default(false),
  selection_source: z.string().default('ai_daily_auto'),
  research: z
    .object({
      id: z.string(),
      status: z.string(),
      report_markdown: z.string(),
      wiki_url: z.string().optional(),
      questions: z.array(z.string()).default([]),
      evidence: z.array(z.any()).default([]),
    })
    .nullable()
    .optional(),
  delivery: z
    .object({
      commit_sha: z.string().nullable().optional(),
      commit_url: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type DailyFeedArticle = z.infer<typeof DailyFeedArticleSchema>;

export const RunCountsSchema = z.object({
  observed: z.number().int().default(0),
  already_processed: z.number().int().default(0),
  candidate: z.number().int().default(0),
  planned: z.number().int().default(0),
  excluded: z.number().int().default(0),
  deferred: z.number().int().default(0),
});
export type RunCounts = z.infer<typeof RunCountsSchema>;

export const RunAILogSchema = z.object({
  execution: ExecutionResultSchema.shape.execution,
  timestamp: z.string(),
  article_id: z.string().optional(),
  article_title: z.string().optional(),
  task_type: z.string().default('assess'),
  skill_id: z.string().optional(),
  model: z.string().optional(),
  prompt_preview: z.string(),
  response_preview: z.string(),
  status: z.string().default('success'),
});
export type RunAILog = z.infer<typeof RunAILogSchema>;

export const RunOutputSchema = z.object({
  entries: z.array(z.object({
    article_id: z.string(), title: z.string(), summary: z.string(),
    original_url: z.string().nullable().optional(), document_url: z.string().optional(),
    is_deep_analyzed: z.boolean().default(false),
  })).default([]),
  commit_url: z.string().optional(),
});
export type RunOutput = z.infer<typeof RunOutputSchema>;

export const RunSchema = z.object({
  id: z.string(),
  group_id: z.string(),
  group_name: z.string(),
  status: z.enum([
    'queued',
    'running',
    'succeeded',
    'partial',
    'failed',
    'cancelled',
    'blocked',
  ]),
  stage: z.string(),
  counts: RunCountsSchema,
  started_at: z.string(),
  finished_at: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  ai_logs: z.array(RunAILogSchema).default([]),
  output: RunOutputSchema.default({}),
});
export type Run = z.infer<typeof RunSchema>;

export const PushDeliveryRecordSchema = z.object({
  id: z.string(),
  batch_id: z.string(),
  ai_log_id: z.string().optional(),
  report_plan_id: z.string().optional(),
  pipeline_ids: z.array(z.string()).default([]),
  group_id: z.string(),
  status: z.string(),
  webhook_name: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string(),
  total_count: z.number().default(0),
  deep_count: z.number().default(0),
  candidate_count: z.number().default(0),
  platform_response: z.string().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string(),
});
export type PushDeliveryRecord = z.infer<typeof PushDeliveryRecordSchema>;

export const ResearchTaskSchema = z.object({
  execution: ExecutionResultSchema.shape.execution,
  model: z.string().optional(),
  id: z.string(),
  group_id: z.string(),
  article_id: z.string(),
  article_title: z.string(),
  article_slug: z.string(),
  status: z.enum([
    'queued',
    'running',
    'succeeded',
    'partial',
    'failed',
    'cancelled',
  ]),
  questions: z.array(z.string()).default([]),
  evidence: z
    .array(
      z.object({
        url: z.string(),
        title: z.string(),
        quote: z.string(),
      }),
    )
    .default([]),
  report_markdown: z.string().default(''),
  created_at: z.string(),
  finished_at: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
});
export type ResearchTask = z.infer<typeof ResearchTaskSchema>;

export const PoolStatusSchema = z.enum(['ready', 'pending', 'review', 'history', 'excluded', 'failed']);
export type PoolStatus = z.infer<typeof PoolStatusSchema>;
export const LibraryArticleSchema = z.object({
  assessments: z.array(z.object({
    group_id: z.string(),
    group_name: z.string(),
    relevance: z.number().min(0).max(100),
    quality: z.number().min(0).max(100),
    overall: z.number().min(0).max(100),
    reason: z.string(),
    assessed_at: z.string(),
  })).default([]),
  wiki_url: z.string().optional(),
  content_kind: z.string().default('unknown'),
  date_evidence: z.record(z.unknown()).default({}),
  id: z.string(),
  title: z.string(),
  author: z.string().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  latest_revision: z.string().nullable().optional(),
  sources: z.array(z.string()).default([]),
  groups: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        decision: z.string().optional(),
        is_deep_analyzed: z.boolean().optional(),
      }),
    )
    .default([]),
  is_deep_analyzed: z.boolean().default(false),
  user_interested: z.boolean().default(false),
  body_snippet: z.string().default(''),
  research: z
    .object({
      id: z.string(),
      status: z.string(),
      report_markdown: z.string().default(''),
      wiki_url: z.string().optional(),
      questions: z.array(z.string()).default([]),
      evidence: z.array(z.any()).default([]),
      finished_at: z.string().nullable().optional(),
      archived_at: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type LibraryArticle = z.infer<typeof LibraryArticleSchema>;

export const LibraryResponseSchema = z.object({
  items: z.array(LibraryArticleSchema),
  pagination: z.object({
    page: z.number(),
    page_size: z.number(),
    total_count: z.number(),
    total_pages: z.number(),
  }),
  filter_meta: z.object({
    total_count: z.number(),
    today_count: z.number(),
    three_days_count: z.number(),
    published_today_count: z.number(),
    published_three_days_count: z.number(),
    unreviewed_count: z.number(),
    scored_count: z.number(),
    deep_count: z.number(),
    interested_count: z.number(),
  }),
});
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;
