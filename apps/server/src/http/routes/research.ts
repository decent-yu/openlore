import type { FastifyPluginAsync } from 'fastify';
import { researchService } from '../../modules/research/service.js';

export const researchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/research', async (request) => {
    const query = request.query as { group_id?: string };
    return researchService.listResearchTasks(query.group_id);
  });
};
