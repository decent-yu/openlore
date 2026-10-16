import type { FastifyPluginAsync } from 'fastify';
import { appScheduler } from '../../modules/scheduler/scheduler.js';
import { collectionService } from '../../modules/collection/service.js';
import { sourcesService } from '../../modules/sources/service.js';

export const sourcesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/sources', async () => {
    return sourcesService.listSources();
  });

  fastify.post('/sources', async (request) => {
    return sourcesService.saveSource(request.body as any);
  });

  fastify.get('/sources/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = await sourcesService.getSource(id);
    if (!source) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Source not found' } });
    }
    return source;
  });

  fastify.patch('/sources/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    if (body.enabled !== undefined && Object.keys(body).length === 1) {
      return sourcesService.toggleSource(id, body.enabled);
    }
    return sourcesService.saveSource({ ...body, id });
  });

  fastify.post('/sources/:id/revalidate', async (request) => {
    const { id } = request.params as { id: string };
    return { counts: await collectionService.revalidateSource(id) };
  });

  fastify.get('/sources/:id/quality-runs', async (request) => {
    const { id } = request.params as { id: string };
    const { getSqliteDatabase } = await import('../../infrastructure/persistence/sqlite/db.js');
    return getSqliteDatabase().prepare('SELECT * FROM collection_runs WHERE source_id=? ORDER BY created_at DESC LIMIT 20').all(id);
  });

  fastify.post('/sources/:id/preview', async (request) => {
    const { id } = request.params as { id: string };
    return collectionService.previewSource(id);
  });

  fastify.post('/sources/:id/poll', async (request) => {
    const { id } = request.params as { id: string };
    return collectionService.discoverSource(id);
  });

  fastify.post('/sources/poll-all', async () => {
    const ids = await appScheduler.pollDueSources(true);
    return { ok: true, polled_sources: ids };
  });
};
