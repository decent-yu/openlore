import crypto from 'node:crypto';
import { getSqliteDatabase } from '../../infrastructure/persistence/sqlite/db.js';
import {
  ExecutionRequestSchema,
  ExecutionResultSchema,
  type ExecutionRequest,
  type ExecutionResult,
} from '@openlore/contracts';

export class ExecutionQueue {
  enqueue(profileId: string, request: ExecutionRequest): string {
    const id = `exec_${crypto.randomUUID()}`;
    const now = Date.now();
    getSqliteDatabase()
      .prepare(
        'INSERT INTO ai_jobs (id,profile_id,request_json,status,created_at,deadline) VALUES (?,?,?,?,?,?)',
      )
      .run(
        id,
        profileId,
        JSON.stringify(request),
        'queued',
        now,
        now +
          (request.config.queue_timeout_seconds +
            request.config.timeout_seconds) *
            1000,
      );
    return id;
  }
  claim(profileId: string, concurrency: number) {
    const db = getSqliteDatabase();
    return db.transaction(() => {
      const now = Date.now();
      db.prepare(
        "UPDATE ai_jobs SET status='expired',lease_token=NULL WHERE deadline<=? AND status IN ('queued','running')",
      ).run(now);
      db.prepare(
        "UPDATE ai_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END, lease_token=NULL WHERE status='running' AND lease_until<?",
      ).run(now);
      const active = db
        .prepare(
          "SELECT count(*) count FROM ai_jobs WHERE profile_id=? AND status='running'",
        )
        .get(profileId) as { count: number };
      if (active.count >= concurrency) return null;
      const row = db
        .prepare(
          "SELECT * FROM ai_jobs WHERE profile_id=? AND status='queued' ORDER BY created_at LIMIT 1",
        )
        .get(profileId) as any;
      if (!row) return null;
      const lease = crypto.randomBytes(24).toString('hex');
      db.prepare(
        "UPDATE ai_jobs SET status='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=?",
      ).run(lease, now + 60000, row.id);
      return {
        id: row.id,
        lease_token: lease,
        request: ExecutionRequestSchema.parse(JSON.parse(row.request_json)),
      };
    })();
  }
  renew(profileId: string, id: string, lease: string): boolean {
    return (
      getSqliteDatabase()
        .prepare(
          "UPDATE ai_jobs SET lease_until=? WHERE id=? AND profile_id=? AND lease_token=? AND status='running' AND deadline>? AND lease_until>?",
        )
        .run(Date.now() + 60000, id, profileId, lease, Date.now(), Date.now())
        .changes === 1
    );
  }
  complete(
    profileId: string,
    id: string,
    lease: string,
    raw: unknown,
  ): boolean {
    const result = ExecutionResultSchema.parse(raw);
    return (
      getSqliteDatabase()
        .prepare(
          "UPDATE ai_jobs SET status='completed',result_json=?,lease_token=NULL WHERE id=? AND profile_id=? AND lease_token=? AND status='running' AND deadline>? AND lease_until>?",
        )
        .run(
          JSON.stringify(result),
          id,
          profileId,
          lease,
          Date.now(),
          Date.now(),
        ).changes === 1
    );
  }
  async wait(id: string, request: ExecutionRequest): Promise<ExecutionResult> {
    const started = Date.now();
    const waitingUntil = started + request.config.queue_timeout_seconds * 1000;
    while (true) {
      const row = getSqliteDatabase()
        .prepare('SELECT status,result_json,deadline FROM ai_jobs WHERE id=?')
        .get(id) as any;
      if (row?.status === 'completed')
        return ExecutionResultSchema.parse(JSON.parse(row.result_json));
      if (
        !row ||
        ['failed', 'expired', 'cancelled'].includes(row.status) ||
        Date.now() > row.deadline ||
        (row.status === 'queued' && Date.now() > waitingUntil)
      ) {
        getSqliteDatabase()
          .prepare(
            "UPDATE ai_jobs SET status='expired',lease_token=NULL WHERE id=? AND status IN ('queued','running')",
          )
          .run(id);
        return {
          status: 'timeout',
          provider: request.provider,
          model: request.input.model || 'default',
          durationMs: Date.now() - started,
          error: {
            code: 'worker_timeout',
            message: '等待本机执行器或任务执行超时，请检查执行器在线状态',
          },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
export const executionQueue = new ExecutionQueue();
