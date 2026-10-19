import { z } from "zod";
import { executionLogs } from "../../infrastructure/ai/execution_logs.js";
import type { FastifyPluginAsync } from "fastify";
import { appScheduler } from "../../modules/scheduler/scheduler.js";

export const runsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/execution-logs", async (request) => {
    const filters = z
      .object({
        run_id: z.string().optional(),
        job_id: z.string().optional(),
        log_id: z.string().optional(),
        status: z.string().optional(),
        task_type: z.string().optional(),
        search: z.string().max(300).optional(),
        page: z.coerce.number().int().min(1).default(1),
        page_size: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(request.query);
    return executionLogs.list(filters);
  });
  fastify.get<{ Params: { id: string } }>(
    "/execution-logs/:id",
    async (request, reply) => {
      const log = executionLogs.get(request.params.id);
      if (!log)
        return reply
          .status(404)
          .send({ error: { code: "not_found", message: "AI 调用记录不存在" } });
      return log;
    },
  );

  fastify.get("/runs", async (request) => {
    const query = request.query as { group_id?: string };
    return appScheduler.listRuns(query.group_id);
  });

  fastify.get("/runs/pushes", async () => {
    return appScheduler.listPushDeliveries();
  });

  fastify.get("/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await appScheduler.getRun(id);
    if (!run) {
      return reply
        .status(404)
        .send({ error: { code: "not_found", message: "Run not found" } });
    }
    return run;
  });
};
