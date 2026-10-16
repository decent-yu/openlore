import type { FastifyPluginAsync } from 'fastify';
import { appScheduler } from '../../modules/scheduler/scheduler.js';

export const runsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/runs', async (request) => {
    const query = request.query as { group_id?: string };
    return appScheduler.listRuns(query.group_id);
  });

  fastify.get('/runs/pushes', async () => {
    return appScheduler.listPushDeliveries();
  });

  fastify.get('/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await appScheduler.getRun(id);
    if (!run) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Run not found' } });
    }
    return run;
  });
};
