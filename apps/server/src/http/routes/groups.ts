import type { FastifyPluginAsync } from 'fastify';
import { groupsService } from '../../modules/groups/service.js';
import { appScheduler } from '../../modules/scheduler/scheduler.js';

export const groupsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/pipelines', async () => {
    return groupsService.listGroups();
  });

  fastify.post('/pipelines', async (request) => {
    return groupsService.saveGroup(request.body as any);
  });

  fastify.get('/pipelines/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const group = await groupsService.getGroup(id);
    if (!group) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Group not found' } });
    }
    return group;
  });

  fastify.patch('/pipelines/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    if (body.enabled !== undefined && Object.keys(body).length === 1) {
      return groupsService.toggleGroup(id, body.enabled);
    }
    return groupsService.saveGroup({ ...body, id });
  });

  fastify.post('/pipelines/:id/run', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await appScheduler.triggerGroupRun(id);
    return reply.status(202).send(run);
  });

  fastify.post('/pipelines/trigger-all', async (_request, reply) => {
    const runs = await appScheduler.triggerAllEnabledGroups();
    return reply.status(202).send(runs);
  });
};
