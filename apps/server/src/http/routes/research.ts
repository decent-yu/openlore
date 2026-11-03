import crypto from "node:crypto";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { claimResearchArticle, releaseResearchClaims } from "../../modules/research/state.js";
import type { FastifyPluginAsync } from 'fastify';
import { groupsService } from '../../modules/groups/service.js';
import { deliveryService } from '../../modules/delivery/service.js';
import { researchService } from '../../modules/research/service.js';

export const researchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/research', async (request) => {
    const query = request.query as { group_id?: string };
    return researchService.listResearchTasks(query.group_id);
  });
  fastify.post<{ Params: { id: string } }>('/research/:id/recover', async (request, reply) => {
    const row = getSqliteDatabase().prepare('SELECT article_id,group_id FROM research_tasks WHERE id=?').get(request.params.id) as { article_id: string; group_id: string } | undefined;
    if (!row) return reply.status(404).send({ error: { code: 'not_found', message: '研读记录不存在' } });
    const owner = `recover_${crypto.randomUUID()}`;
    if (!claimResearchArticle(row.article_id, row.group_id, owner, true))
      return reply.status(409).send({ error: { code: 'research_running', message: '该研读正在执行，请先停止任务' } });
    try {
      const task = await researchService.recoverRepositoryReport(request.params.id);
      if (!task) return reply.status(404).send({ error: { code: 'no_saved_report', message: '没有可复用的本地研报文件' } });
      const group = await groupsService.getGroup(task.group_id);
      if (group && task.status === 'succeeded' && !task.archived_at) {
        const archive = await deliveryService.deliverResearchReport(group, task);
        if (!['updated', 'unchanged'].includes(archive.status))
          return reply.status(502).send({ error: { code: 'archive_failed', message: '研报已恢复，归档失败，请重试交付' }, task });
      }
      return (await researchService.listResearchTasks(task.group_id)).find(row => row.id === task.id);
    } finally { releaseResearchClaims(owner); }

  });
};
