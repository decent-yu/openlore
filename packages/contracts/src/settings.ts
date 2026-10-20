import { z } from 'zod';
import { DEFAULT_REPORT_CARD_TITLE, ReportCardTitleTemplateSchema, DEFAULT_REPORT_TEMPLATE, ReportTemplateSchema } from './report-template.js';
export { DEFAULT_REPORT_TEMPLATE, DEFAULT_REPORT_CARD_TITLE, REPORT_TEMPLATE_VARIABLES, ReportTemplateSchema, ReportCardTitleTemplateSchema, renderReportTemplate, renderReportCardTitle, buildFeishuCard } from './report-template.js';
import { ExecutorConfigSchema } from './execution.js';

export const AIProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.string(),
  provider: z.enum(['codex_cli', 'gemini_cli']),
  cli_path: z.string(),
  model: z.string().optional(),
  state: z.enum([
    'ready',
    'invalid_path',
    'auth_required',
    'unsupported_version',
    'unknown',
  ]),
  is_primary: z.boolean().default(false),
  execution: ExecutorConfigSchema.default({}),
  worker_online: z.boolean().default(false),
  worker_last_seen: z.string().nullable().optional(),
  worker_name: z.string().nullable().optional(),
  worker_paired: z.boolean().default(false),
});
export type AIProfile = z.infer<typeof AIProfileSchema>;

export const WorkspaceSettingsSchema = z.object({
  github_token_configured: z.boolean().default(false),
  default_github_token_connection_id: z.string().nullable().optional(),
  default_repository_connection_id: z.string().nullable().optional(),
  default_ai_profile_id: z.string().nullable().optional(),
  default_notification_connection_id: z.string().nullable().optional(),
  timezone: z.string().default('Asia/Shanghai'),
  auto_start_service: z.boolean().default(false),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const DoctorCheckSchema = z.object({
  name: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  message: z.string(),
  details: z.string().optional(),
});
export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;

export const DoctorResultSchema = z.object({
  ok: z.boolean(),
  checks: z.array(DoctorCheckSchema),
});
export type DoctorResult = z.infer<typeof DoctorResultSchema>;

export const ServiceStatusSchema = z.object({
  platform: z.enum(['darwin', 'linux', 'other']),
  installed: z.boolean(),
  running: z.boolean(),
  pid: z.number().nullable().optional(),
  listening: z.string().default('127.0.0.1:8767'),
});
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const ReportSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  schedule_cron: z.string().default('0 9 * * *'),
  timezone: z.string().default('Asia/Shanghai'),
  notification_connection_id: z.string().nullable().default(null),
  template: ReportTemplateSchema.default(DEFAULT_REPORT_TEMPLATE),
  card_title_template: ReportCardTitleTemplateSchema.default(DEFAULT_REPORT_CARD_TITLE),
  pipeline_ids: z.array(z.string()).default([]),
});
export type ReportSettings = z.infer<typeof ReportSettingsSchema>;

export const ReportPreviewSchema = z.object({
  state: z.enum(['ready', 'waiting', 'empty', 'invalid_config']),
  message: z.string(),
  date: z.string(),
  summary: z.string(),
  card_title: z.string(),
  tasks: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), count: z.number() })),
  articles: z.array(z.object({ article_id: z.string(), title: z.string(), summary: z.string(), url: z.string().optional(), is_deep_analyzed: z.boolean() })),
});
export type ReportPreview = z.infer<typeof ReportPreviewSchema>;

export const ReportPlanSchema = ReportSettingsSchema.extend({
  id: z.string(),
  name: z.string().trim().min(1),
});
export type ReportPlan = z.infer<typeof ReportPlanSchema>;
