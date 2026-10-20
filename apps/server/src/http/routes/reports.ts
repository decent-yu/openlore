import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { reportService } from '../../modules/reports/service.js';

export const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/reports', () => reportService.listPlans());
  fastify.post('/reports', (request) => reportService.savePlan(request.body));
  fastify.put<{ Params: { id: string } }>('/reports/:id', async (request) => {
    await reportService.getPlan(request.params.id);
    return reportService.savePlan({
      ...(request.body as object),
      id: request.params.id,
    });
  });
  fastify.delete<{ Params: { id: string } }>('/reports/:id', (request) =>
    reportService.deletePlan(request.params.id),
  );
  fastify.get<{ Params: { id: string } }>('/reports/:id/preview', (request) =>
    reportService.preview(request.params.id),
  );
  fastify.post<{ Params: { id: string } }>('/reports/:id/send', (request) => {
    const options = z.object({ force: z.boolean().default(false) }).parse(request.body || {});
    return reportService.send(request.params.id, options);
  });
};
