import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  ExecutorConfigSchema,
  SkillBundleSchema,
  SkillSchema,
  ExecutionProgressSchema,
} from '@openlore/contracts';
import { executorService } from '../../modules/executors/service.js';
import { executionQueue } from '../../modules/executors/queue.js';

export const executorsRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>(
    '/settings/ai-profiles/:id/pair',
    (request) => executorService.pair(request.params.id),
  );
  app.register(
    async (worker) => {
      worker.addHook('onRequest', async (request) => {
        const { id } = request.params as { id: string };
        executorService.authenticate(
          id,
          request.headers.authorization?.replace(/^Bearer /, '') || '',
        );
      });
      worker.get<{ Params: { id: string } }>(
        '/:id/configuration',
        (request) => {
          const row = executorService.authenticate(
            request.params.id,
            request.headers.authorization!.slice(7),
          );
          return {
            profile_id: row.id,
            provider: row.provider,
            cli_path: row.cli_path,
            model: row.model,
            config: ExecutorConfigSchema.parse(JSON.parse(row.execution_json)),
          };
        },
      );
      worker.post<{ Params: { id: string } }>('/:id/heartbeat', (request) => {
        const body = z
          .object({
            name: z.string(),
            catalog: z
              .array(
                z.object({ skill: SkillSchema, bundle: SkillBundleSchema }),
              )
              .max(100),
          })
          .parse(request.body);
        executorService.heartbeat(request.params.id, body.name, body.catalog);
        return { ok: true };
      });
      worker.post<{ Params: { id: string } }>('/:id/claim', (request) =>
        executorService.claim(request.params.id),
      );
      worker.post<{ Params: { id: string; job: string } }>(
        '/:id/jobs/:job/renew',
        (request) => {
          const body = z
            .object({
              lease_token: z.string(),
              progress: ExecutionProgressSchema.optional(),
            })
            .parse(request.body);
          return {
            active: executionQueue.renew(
              request.params.id,
              request.params.job,
              body.lease_token,
              body.progress,
            ),
          };
        },
      );
      worker.post<{ Params: { id: string; job: string } }>(
        '/:id/jobs/:job/result',
        (request, reply) => {
          const body = z
            .object({ lease_token: z.string(), result: z.unknown() })
            .parse(request.body);
          if (
            !executionQueue.complete(
              request.params.id,
              request.params.job,
              body.lease_token,
              body.result,
            )
          )
            return reply
              .status(409)
              .send({ error: 'Lease expired or job already completed' });
          return { ok: true };
        },
      );
    },
    { prefix: '/worker' },
  );
};
