import { z } from 'zod';

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  request_id: z.string(),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const SseEventSchema = z.object({
  entity_type: z.enum(['run', 'source', 'group', 'job', 'research', 'settings']),
  entity_id: z.string(),
  status: z.string(),
  revision: z.string().optional(),
  timestamp: z.string(),
});
export type SseEvent = z.infer<typeof SseEventSchema>;
