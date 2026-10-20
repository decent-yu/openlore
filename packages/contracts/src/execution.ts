import { z } from 'zod';
import { ReasoningEffortSchema } from './model-spec.js';
import { RepositoryCheckoutSchema } from './github-source.js';

export const ExecutorConfigSchema = z.object({
  reasoning_effort: ReasoningEffortSchema.optional(),
  transport: z.enum(['local', 'worker', 'ssh']).default('local'),
  workspace_root: z.string().default(''),
  skills_directory: z.string().default(''),
  skills_mode: z.enum(['synced', 'local']).default('synced'),
  config_profile: z.string().default(''),
  inherit_user_config: z.boolean().default(true),
  timeout_seconds: z.number().int().min(10).max(3600).default(900),
  queue_timeout_seconds: z.number().int().min(10).max(86400).default(3600),
  retention_days: z.number().int().min(1).max(90).default(7),
  concurrency: z.number().int().min(1).max(4).default(1),
  ssh_host: z.string().default(''),
  ssh_user: z.string().default(''),
  ssh_port: z.number().int().min(1).max(65535).default(22),
  ssh_identity_file: z.string().default(''),
  ssh_node_path: z.string().default('node'),
  ssh_cli_entry: z.string().default(''),
});
export type ExecutorConfig = z.infer<typeof ExecutorConfigSchema>;
export const SkillFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  executable: z.boolean().default(false),
});
export const SkillBundleSchema = z.object({
  id: z.string(),
  revision: z.string(),
  files: z.array(SkillFileSchema).max(500),
});
export type SkillBundle = z.infer<typeof SkillBundleSchema>;
export const ExecutionSessionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,199}$/),
  workspace: z.string().min(1),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ExecutionSession = z.infer<typeof ExecutionSessionSchema>;
export const ExecutionInputSchema = z.object({
  jobId: z.string(),
  runId: z.string().optional(),
  groupId: z.string().optional(),
  reportPlanId: z.string().optional(),
  articleId: z.string().optional(),
  articleTitle: z.string().optional(),
  profileId: z.string(),
  taskType: z.enum([
    'assess',
    'select',
    'organize',
    'translate',
    'research_plan',
    'research_report',
    'digest',
    'repair',
  ]),
  skillId: z.string().optional(),
  skillRevision: z.string().optional(),
  skillBundle: SkillBundleSchema.optional(),
  prompt: z.string(),
  material: z.string(),
  repository: RepositoryCheckoutSchema.optional(),
  outputSchema: z.record(z.unknown()).optional(),
  model: z.string().optional(),
  reasoning_effort: ReasoningEffortSchema.optional(),
  session: ExecutionSessionSchema.optional(),
});
export type ExecutionInput = z.infer<typeof ExecutionInputSchema>;
export const ExecutionResultSchema = z.object({
  status: z.enum([
    'success',
    'invalid_output',
    'auth_required',
    'quota_exceeded',
    'timeout',
    'failed',
  ]),
  result: z.unknown().optional(),
  provider: z.string(),
  model: z.string(),
  durationMs: z.number(),
  queue_duration_ms: z.number().nonnegative().optional(),
  trace_id: z.string().optional(),
  session: ExecutionSessionSchema.optional(),
  diagnostics: z
    .object({
      stdout: z.string(),
      stderr: z.string(),
      exit_code: z.number().nullable(),
      timed_out: z.boolean(),
      timeout_seconds: z.number(),
      output_truncated: z.boolean().default(false),
      partial_document: z.string().optional(),
    })
    .optional(),
  usage: z
    .object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
      totalTokens: z.number().optional(),
      cachedTokens: z.number().optional(),
      reasoningTokens: z.number().optional(),
    })
    .optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  artifacts: z.array(SkillFileSchema).max(200).optional(),
  execution: z
    .object({
      workspace: z.string(),
      session_id: z.string().optional(),
      skill_id: z.string().optional(),
      skill_revision: z.string().optional(),
      prompt: z.string(),
      mode: z.enum(['native', 'explicit-path']),
      skill_instructions: z.string().optional(),
      skill_files: z.array(z.string()).optional(),
    })
    .optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
export const ExecutionProgressSchema = z.object({
  updated_at: z.string().datetime(),
  last_output_at: z.string().datetime().optional(),
  state: z.enum(['queued', 'running']).optional(),
  queue_duration_ms: z.number().nonnegative().optional(),
  execution: ExecutionResultSchema.shape.execution,
  diagnostics: ExecutionResultSchema.shape.diagnostics,
});
export type ExecutionProgress = z.infer<typeof ExecutionProgressSchema>;
export const ExecutionRequestSchema = z.object({
  input: ExecutionInputSchema,
  config: ExecutorConfigSchema,
  provider: z.enum(['codex_cli', 'gemini_cli']),
  cli_path: z.string().min(1),
});
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;
