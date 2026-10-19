import type { FastifyPluginAsync } from 'fastify';
import { feedService } from '../../modules/feed/service.js';

export const feedRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/feed', async (request) => {
    const { group_id, date } = request.query as { group_id?: string; date?: string };
    return feedService.getDailyFeed(group_id, date);
  });

  fastify.post('/feed/research', async (request) => {
    const body = request.body as {
      group_id: string;
      article_id: string;
      source?: 'user_interest' | 'ai_daily_auto';
    };
    return feedService.researchArticle(body.group_id, body.article_id);
  });

  fastify.post('/articles/:id/interest', async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { interested?: boolean; group_id?: string }) || {};
    return feedService.toggleArticleInterest(id, body.interested);
  });
};
