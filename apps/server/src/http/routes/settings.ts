import type { FastifyPluginAsync } from 'fastify';
import { settingsService } from '../../modules/settings/service.js';

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/settings', async () => {
    return settingsService.getSettings();
  });

  fastify.patch('/settings', async (request) => {
    return settingsService.updateSettings(request.body as any);
  });

  fastify.get('/settings/connections/repository', async () => {
    return settingsService.listRepositoryConnections();
  });

  fastify.post('/settings/connections/repository', async (request) => {
    return settingsService.saveRepositoryConnection(request.body as any);
  });

  fastify.delete('/settings/connections/repository/:id', async (request) => {
    const { id } = request.params as { id: string };
    return settingsService.deleteRepositoryConnection(id);
  });

  fastify.post('/settings/connections/repository/:id/test', async (request) => {
    const { id } = request.params as { id: string };
    return settingsService.testRepositoryConnection(id);
  });

  fastify.get('/settings/connections/notification', async () => {
    return settingsService.listNotificationConnections();
  });

  fastify.post('/settings/connections/notification', async (request) => {
    return settingsService.saveNotificationConnection(request.body as any);
  });

  fastify.delete('/settings/connections/notification/:id', async (request) => {
    const { id } = request.params as { id: string };
    return settingsService.deleteNotificationConnection(id);
  });

  fastify.get('/settings/ai-profiles', async () => {
    return settingsService.listAIProfiles();
  });

  fastify.post('/settings/ai-profiles', async (request) => {
    return settingsService.saveAIProfile(request.body as any);
  });

  fastify.post<{ Params: { id: string } }>('/settings/ai-profiles/:id/test', (request) => settingsService.testAIProfile(request.params.id));

  fastify.delete('/settings/ai-profiles/:id', async (request) => {
    const { id } = request.params as { id: string };
    return settingsService.deleteAIProfile(id);
  });

  fastify.post('/settings/ai-profiles/:id/primary', async (request) => {
    const { id } = request.params as { id: string };
    return settingsService.setPrimaryAIProfile(id);
  });

  fastify.get('/settings/doctor', async () => {
    return settingsService.runDoctor();
  });

  fastify.get('/settings/service', async () => {
    return settingsService.getServiceStatus();
  });

};
