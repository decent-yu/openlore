import crypto from 'node:crypto';
import { validateCron } from '../../infrastructure/time/cron.js';
import { eq } from 'drizzle-orm';
import type { Group } from '@openlore/contracts';
import { GITHUB_CODE_RESEARCH_SKILL } from '@openlore/contracts';
import { getDb } from '../../infrastructure/persistence/sqlite/db.js';
import {
  groupsTable,
  groupSourcesTable,
} from '../../infrastructure/persistence/sqlite/schema.js';

export function normalizeRoutePath(rawPath: string): string {
  let cleaned = rawPath.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleaned || cleaned.includes('..') || cleaned === '.') {
    throw new Error(`Invalid route path: '${rawPath}'. Cannot be empty or traverse directories.`);
  }
  return cleaned;
}

export class GroupsService {
  async listGroups(): Promise<Group[]> {
    const db = getDb();
    const rows = db.select().from(groupsTable).all();

    const groups: Group[] = [];
    for (const r of rows) {
      const rules = db
        .select()
        .from(groupSourcesTable)
        .where(eq(groupSourcesTable.groupId, r.id))
        .all();

      groups.push({
        id: r.id,
        name: r.name,
        description: r.description,
        preferences: r.preferences,
        enabled: Boolean(r.enabled),
        route: {
          repository_connection_id: r.repositoryConnectionId,
          base_path: r.basePath,
        },
        source_ids: rules.map((r) => r.sourceId),
        schedule_cron: r.scheduleCron,
        timezone: r.timezone,
        deep_analysis_count: r.deepAnalysisCount ?? 3,
        research_instructions: r.researchInstructions,
      selection_skill_id: r.selectionSkillId,
      research_skill_id: r.researchSkillId,
        ai_profile_id: r.aiProfileId,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      });
    }

    return groups;
  }

  async getGroup(id: string): Promise<Group | null> {
    const db = getDb();
    const r = db.select().from(groupsTable).where(eq(groupsTable.id, id)).get();
    if (!r) return null;

    const rules = db
      .select()
      .from(groupSourcesTable)
      .where(eq(groupSourcesTable.groupId, r.id))
      .all();

    return {
      id: r.id,
      name: r.name,
      description: r.description,
      preferences: r.preferences,
      enabled: Boolean(r.enabled),
      route: {
        repository_connection_id: r.repositoryConnectionId,
        base_path: r.basePath,
      },
      source_ids: rules.map((r) => r.sourceId),
      schedule_cron: r.scheduleCron,
      timezone: r.timezone,
      deep_analysis_count: r.deepAnalysisCount ?? 3,
      research_instructions: r.researchInstructions,
      selection_skill_id: r.selectionSkillId,
      research_skill_id: r.researchSkillId,
      ai_profile_id: r.aiProfileId,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }

  async validateRoute(
    repoConnId: string,
    basePath: string,
    excludeGroupId?: string,
  ): Promise<void> {
    const normalized = normalizeRoutePath(basePath);
    const db = getDb();
    const existing = db
      .select()
      .from(groupsTable)
      .where(eq(groupsTable.repositoryConnectionId, repoConnId))
      .all();

    for (const g of existing) {
      if (excludeGroupId && g.id === excludeGroupId) continue;
      const gPath = normalizeRoutePath(g.basePath);
      if (
        gPath === normalized ||
        gPath.startsWith(normalized + '/') ||
        normalized.startsWith(gPath + '/')
      ) {
        throw new Error(
          `Route conflict: path '${normalized}' overlaps with existing group '${g.name}' path '${gPath}' in the same repository.`,
        );
      }
    }
  }

  async saveGroup(data: {
    id?: string;
    name: string;
    description?: string;
    preferences?: string;
    enabled?: boolean;
    repository_connection_id: string;
    base_path: string;
    source_ids?: string[];
    schedule_cron?: string;
    timezone?: string;
    deep_analysis_count?: number;
    research_instructions?: string;
    selection_skill_id?: string;
    research_skill_id?: string;
    ai_profile_id?: string | null;
  }): Promise<Group> {
    if (data.research_skill_id === GITHUB_CODE_RESEARCH_SKILL) throw new Error('文章调研 Skill 不能使用 github-code-research；GitHub 来源自动使用独立代码调研 Skill');
    validateCron(data.schedule_cron || '0 8 * * *');
    new Intl.DateTimeFormat('en', { timeZone: data.timezone || 'Asia/Shanghai' });
    const id = data.id || `group_${crypto.randomUUID().slice(0, 8)}`;
    if (data.deep_analysis_count !== undefined && (!Number.isInteger(data.deep_analysis_count) || data.deep_analysis_count < 0 || data.deep_analysis_count > 100)) throw new Error('深度调研篇数必须为 0 到 100 之间的整数');
    const normalizedPath = normalizeRoutePath(data.base_path);
    await this.validateRoute(data.repository_connection_id, normalizedPath, id);

    const db = getDb();
    const now = new Date().toISOString();

    const record = {
      id,
      name: data.name,
      description: data.description || '',
      preferences: data.preferences || '',
      enabled: data.enabled !== undefined ? data.enabled : true,
      repositoryConnectionId: data.repository_connection_id,
      basePath: normalizedPath,
      scheduleCron: data.schedule_cron || '0 8 * * *',
      timezone: data.timezone || 'Asia/Shanghai',
      deepAnalysisCount: data.deep_analysis_count !== undefined ? data.deep_analysis_count : 3,
      researchInstructions: data.research_instructions || '',
      selectionSkillId: data.selection_skill_id || 'article-selector',
      researchSkillId: data.research_skill_id || 'deep-research-expert',
      aiProfileId: data.ai_profile_id || null,
      updatedAt: now,
    };

    db.insert(groupsTable)
      .values({ ...record, createdAt: now })
      .onConflictDoUpdate({
        target: groupsTable.id,
        set: record,
      })
      .run();

    if (data.source_ids) {
      db.delete(groupSourcesTable).where(eq(groupSourcesTable.groupId, id)).run();
      for (const sourceId of new Set(data.source_ids)) {
        db.insert(groupSourcesTable).values({ id: `gs_${crypto.randomUUID()}`, groupId: id, sourceId }).run();
      }
    }

    return (await this.getGroup(id))!;
  }

  async toggleGroup(id: string, enabled: boolean): Promise<Group> {
    const db = getDb();
    db.update(groupsTable)
      .set({ enabled, updatedAt: new Date().toISOString() })
      .where(eq(groupsTable.id, id))
      .run();
    return (await this.getGroup(id))!;
  }
}

export const groupsService = new GroupsService();
