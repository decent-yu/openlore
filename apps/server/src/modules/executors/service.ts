import crypto from 'node:crypto';
import { ExecutorConfigSchema, type ExecutorConfig } from '@openlore/contracts';
import { getSqliteDatabase } from '../../infrastructure/persistence/sqlite/db.js';
import { executionQueue } from './queue.js';
import { validateBundle } from '../../infrastructure/ai/skill_bundle.js';

export const executorService = {
  pair(id: string) {
    const db = getSqliteDatabase();
    const row = db
      .prepare('SELECT execution_json FROM ai_profiles WHERE id=?')
      .get(id) as any;
    if (
      !row ||
      ExecutorConfigSchema.parse(JSON.parse(row.execution_json)).transport !==
        'worker'
    )
      throw new Error('请选择常驻 Worker 执行器');
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(
      'UPDATE ai_profiles SET worker_token_hash=?,worker_last_seen=NULL WHERE id=?',
    ).run(crypto.createHash('sha256').update(token).digest('hex'), id);
    db.prepare(
      "UPDATE ai_jobs SET status='cancelled',lease_token=NULL WHERE profile_id=? AND status IN ('queued','running')",
    ).run(id);
    return { profile_id: id, token };
  },
  authenticate(id: string, token: string) {
    const row = getSqliteDatabase()
      .prepare('SELECT * FROM ai_profiles WHERE id=?')
      .get(id) as any;
    const digest = crypto.createHash('sha256').update(token).digest('hex');
    if (
      !row?.worker_token_hash ||
      !crypto.timingSafeEqual(
        Buffer.from(digest),
        Buffer.from(row.worker_token_hash),
      ) ||
      ExecutorConfigSchema.parse(JSON.parse(row.execution_json)).transport !==
        'worker'
    )
      throw Object.assign(new Error('执行器令牌无效'), { statusCode: 401 });
    return row;
  },
  heartbeat(id: string, name: string, catalog: any[]) {
    if (
      catalog.length > 100 ||
      Buffer.byteLength(JSON.stringify(catalog)) > 16 * 1024 * 1024
    )
      throw new Error('Skills 目录过大，请指定专用目录');
    for (const entry of catalog) {
      validateBundle(entry.bundle);
      if (entry.skill.id !== entry.bundle.id)
        throw new Error('Skill ID mismatch');
    }
    getSqliteDatabase()
      .prepare(
        'UPDATE ai_profiles SET worker_last_seen=?,worker_name=?,worker_catalog_json=? WHERE id=?',
      )
      .run(
        new Date().toISOString(),
        name.slice(0, 100),
        JSON.stringify(catalog),
        id,
      );
  },
  claim(id: string) {
    const row = getSqliteDatabase()
      .prepare('SELECT execution_json FROM ai_profiles WHERE id=?')
      .get(id) as any;
    return executionQueue.claim(
      id,
      ExecutorConfigSchema.parse(JSON.parse(row.execution_json)).concurrency,
    );
  },
};
