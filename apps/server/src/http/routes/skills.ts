import type { FastifyPluginAsync } from 'fastify';
import { skillsService } from '../../modules/skills/service.js';

export const skillsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { profile_id?: string } }>('/skills', async (request) => {
    return skillsService.listSkills(request.query.profile_id);
  });

  fastify.get('/skills/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const skill = await skillsService.getSkill(id, (request.query as { profile_id?: string }).profile_id);
    if (!skill) {
      reply.status(404);
      return { error: 'Skill not found', id };
    }
    return skill;
  });
};
