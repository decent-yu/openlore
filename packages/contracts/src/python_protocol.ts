import { z } from 'zod';

export const PythonWorkerRequestSchema = z.object({
  protocol_version: z.literal(1),
  job_id: z.string(),
  operation: z.enum(['parse_feed', 'extract_article']),
  input_path: z.string(),
  original_url: z.string().nullable().optional(),
  final_url: z.string().nullable().optional(),
  response_meta: z
    .object({
      content_type: z.string().optional(),
      status_code: z.number().int().optional(),
    })
    .default({}),
  options: z.record(z.unknown()).default({}),
});
export type PythonWorkerRequest = z.infer<typeof PythonWorkerRequestSchema>;

export const PythonWorkerErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type PythonWorkerError = z.infer<typeof PythonWorkerErrorSchema>;

export const PythonWorkerResponseSchema = z.object({
  protocol_version: z.literal(1),
  job_id: z.string(),
  status: z.enum(['success', 'partial', 'failed']),
  data: z.unknown().nullable().optional(),
  issues: z.array(z.string()).default([]),
  error: PythonWorkerErrorSchema.nullable().optional(),
});
export type PythonWorkerResponse = z.infer<typeof PythonWorkerResponseSchema>;
