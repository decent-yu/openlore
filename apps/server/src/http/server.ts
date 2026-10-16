import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { appScheduler } from '../modules/scheduler/scheduler.js';
import { executorsRoutes } from './routes/executors.js';
import { feedRoutes } from './routes/feed.js';
import { groupsRoutes } from './routes/groups.js';
import { libraryRoutes } from './routes/library.js';
import { researchRoutes } from './routes/research.js';
import { reportsRoutes } from './routes/reports.js';
import { runsRoutes } from './routes/runs.js';
import { settingsRoutes } from './routes/settings.js';
import { skillsRoutes } from './routes/skills.js';
import { sourcesRoutes } from './routes/sources.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 24 * 1024 * 1024,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: () => `req_${crypto.randomUUID().slice(0, 8)}`,
  });

  const adminToken = process.env.OPENLORE_ADMIN_TOKEN;
  app.addHook('onRequest', async (request, reply) => {
    if (!adminToken || request.url.startsWith('/api/v1/worker/')) return;
    const authorization = request.headers.authorization || '';
    const credential = authorization.startsWith('Bearer ') ? authorization.slice(7) : authorization.startsWith('Basic ') ? Buffer.from(authorization.slice(6), 'base64').toString().split(':').slice(1).join(':') : '';
    const actual = crypto.createHash('sha256').update(credential).digest();
    const expected = crypto.createHash('sha256').update(adminToken).digest();
    if (!crypto.timingSafeEqual(actual, expected)) return reply.header('WWW-Authenticate', 'Basic realm="OpenLore"').status(401).send({ error: 'Authentication required' });
  });
  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || origin === process.env.OPENLORE_PUBLIC_URL || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  // Global error handler
  app.setErrorHandler((error: any, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode || (error.name === 'ZodError' ? 400 : 500);
    return reply.status(statusCode).send({
      error: {
        code: error.code || 'internal_server_error',
        message: error.message || 'An unexpected error occurred',
      },
      request_id: request.id,
    });
  });

  // SSE endpoint
  app.get('/api/v1/events', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    reply.raw.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    const unsubscribe = appScheduler.addSseListener((event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    request.raw.on('close', () => {
      unsubscribe();
    });
  });

  // Register API routes
  await app.register(
    async (api) => {
      await api.register(feedRoutes);
      await api.register(settingsRoutes);
      await api.register(executorsRoutes);
      await api.register(sourcesRoutes);
      await api.register(groupsRoutes);
      await api.register(runsRoutes);
      await api.register(reportsRoutes);
      await api.register(libraryRoutes);
      await api.register(researchRoutes);
      await api.register(skillsRoutes);
    },
    { prefix: '/api/v1' },
  );

  // Serve static UI if dist exists
  const webDistDir = path.resolve(__dirname, '../../../web/dist');
  if (fs.existsSync(webDistDir)) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/',
    });

    // SPA fallback
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({
          error: {
            code: 'not_found',
            message: `API route '${request.url}' not found`,
          },
          request_id: request.id,
        });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler(async (request, reply) => {
      return reply.status(404).send({
        error: {
          code: 'not_found',
          message: `Route '${request.url}' not found`,
        },
        request_id: request.id,
      });
    });
  }

  return app;
}
