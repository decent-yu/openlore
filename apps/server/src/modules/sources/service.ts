import crypto from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { SourceOptionsSchema, type Source } from '@openlore/contracts';
import { getDb, getSqliteDatabase } from '../../infrastructure/persistence/sqlite/db.js';
import { sourcesTable, sourceStatesTable } from '../../infrastructure/persistence/sqlite/schema.js';

export class SourcesService {
  async listSources(): Promise<Source[]> {
    const db = getDb();
    const rows = db.select().from(sourcesTable).all();

    if (rows.length === 0) {
      await this.seedDefaultSources();
      return this.listSources();
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      description: r.description,
      capability_id: r.capabilityId,
      enabled: Boolean(r.enabled),
      options: SourceOptionsSchema.parse(JSON.parse(r.optionsJson || '{}')),
      quality_stats: Object.fromEntries((getSqliteDatabase().prepare('SELECT status, count(*) n FROM collection_candidates WHERE source_id=? GROUP BY status').all(r.id) as Array<{status:string;n:number}>).map((row) => [row.status,row.n])),
      last_polled_at: r.lastPolledAt || undefined,
      last_success_at: r.lastSuccessAt || undefined,
      last_error: r.lastError || undefined,
    }));
  }

  async getSource(id: string): Promise<Source | null> {
    const db = getDb();
    const r = db.select().from(sourcesTable).where(eq(sourcesTable.id, id)).get();
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      url: r.url,
      description: r.description,
      capability_id: r.capabilityId,
      enabled: Boolean(r.enabled),
      options: SourceOptionsSchema.parse(JSON.parse(r.optionsJson || '{}')),
      quality_stats: Object.fromEntries((getSqliteDatabase().prepare('SELECT status, count(*) n FROM collection_candidates WHERE source_id=? GROUP BY status').all(r.id) as Array<{status:string;n:number}>).map((row) => [row.status,row.n])),
      last_polled_at: r.lastPolledAt || undefined,
      last_success_at: r.lastSuccessAt || undefined,
      last_error: r.lastError || undefined,
    };
  }

  async saveSource(data: {
    id?: string;
    name: string;
    url: string;
    description?: string;
    capability_id?: string;
    enabled?: boolean;
    options?: Record<string, unknown>;
  }): Promise<Source> {
    const db = getDb();
    const id = data.id || `src_${crypto.randomUUID().slice(0, 12)}`;
    const previous = data.id ? await this.getSource(data.id) : null;
    const name = z.string().trim().min(1, '请输入来源名称').parse(data.name ?? previous?.name);
    const url = z.string().trim().url('请输入有效的来源地址').refine(
      value => /^https?:\/\//i.test(value), '来源地址仅支持 HTTP 或 HTTPS',
    ).parse(data.url ?? previous?.url);
    const options = SourceOptionsSchema.parse(data.options ?? previous?.options ?? {});
    const record = {
      id,
      name,
      url,
      description: data.description ?? previous?.description ?? '',
      capabilityId: data.capability_id ?? previous?.capability_id ?? 'web_feed',
      enabled: data.enabled ?? previous?.enabled ?? true,
      optionsJson: JSON.stringify(options),
      updatedAt: new Date().toISOString(),
    };

    db.insert(sourcesTable)
      .values(record)
      .onConflictDoUpdate({
        target: sourcesTable.id,
        set: record,
      })
      .run();

    if (previous && (previous.url !== url || JSON.stringify(previous.options) !== JSON.stringify(options))) {
      db.delete(sourceStatesTable).where(eq(sourceStatesTable.sourceId, id)).run();
      const { collectionService } = await import('../collection/service.js');
      await collectionService.revalidateSource(id);
    }
    return this.getSource(id) as Promise<Source>;
  }

  async toggleSource(id: string, enabled: boolean): Promise<Source> {
    const db = getDb();
    db.update(sourcesTable)
      .set({ enabled, updatedAt: new Date().toISOString() })
      .where(eq(sourcesTable.id, id))
      .run();
    return this.getSource(id) as Promise<Source>;
  }

  async updateLastPolled(
    id: string,
    success: boolean,
    errorMsg?: string,
  ): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    const updateData: any = {
      lastPolledAt: now,
      updatedAt: now,
      lastError: errorMsg || null,
    };
    if (success) {
      updateData.lastSuccessAt = now;
    }
    db.update(sourcesTable).set(updateData).where(eq(sourcesTable.id, id)).run();
  }

  async seedDefaultSources(): Promise<void> {
    const db = getDb();
    const existing = db.select().from(sourcesTable).all();
    if (existing.length > 0) return;

    await this.saveSource({
      id: 'cloudflare',
      name: 'Cloudflare Blog',
      url: 'https://blog.cloudflare.com/rss/',
      description:
        '网络、安全、数据库、性能优化、云基础设施及 Agent 工程实践一手分析',
      capability_id: 'web_feed',
      enabled: true,
    });

    await this.saveSource({
      id: 'simonw',
      name: 'Simon Willison',
      url: 'https://simonwillison.net/atom/everything/',
      description:
        'LLM 工具、编程 Agent、开发方法、实验与技术评论',
      capability_id: 'web_feed',
      enabled: true,
    });
  }
}

export const sourcesService = new SourcesService();
