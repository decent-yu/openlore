import type { FastifyPluginAsync } from 'fastify';
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
  fastify.post<{ Params: { id: string } }>('/reports/:id/send', (request) =>
    reportService.send(request.params.id),
  );
};
