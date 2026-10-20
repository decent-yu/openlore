import { WikiDisplayConfigSchema } from '@openlore/contracts';
import crypto from 'node:crypto';
import { z } from 'zod';
import { ExecutorConfigSchema, WorkspaceSettingsSchema, parseModelSpec, type ExecutorConfig } from '@openlore/contracts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type {
  AIProfile,
  DoctorResult,
  NotificationConnection,
  RepositoryConnection,
  ServiceStatus,
  WorkspaceSettings,
} from '@openlore/contracts';
import { ExecutorAdapter } from '../../infrastructure/ai/executor_adapter.js';
import { getAppPaths } from '../../infrastructure/config/paths.js';
import { getDb, getSqliteDatabase } from '../../infrastructure/persistence/sqlite/db.js';
import {
  aiProfilesTable,
  groupsTable,
  notificationConnectionsTable,
  repositoryConnectionsTable,
  reportPlansTable,
  workspaceSettingsTable,
} from '../../infrastructure/persistence/sqlite/schema.js';
import { PythonWorkerRunner } from '../../infrastructure/python/runner.js';
import { GitHubClient } from '../../infrastructure/repositories/github/client.js';
import { getGitHubToken, DEFAULT_GITHUB_TOKEN_REF } from '../../infrastructure/repositories/github/credentials.js';
import { secretsStore } from '../../infrastructure/secrets/local_file/secrets_store.js';

export function parseGitRepoUrl(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  const httpsMatch = trimmed.match(/https?:\/\/[^/]+\/([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = trimmed.match(/git@[^:]+:([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  const shortMatch = trimmed.match(/^([^/]+)\/([^/.]+?)(?:\.git)?\/?$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };
  return null;
}

export class SettingsService {
  async getSettings(): Promise<WorkspaceSettings> {
    const db = getDb();
    const rows = db.select().from(workspaceSettingsTable).all();
    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      github_token_configured: Boolean(getGitHubToken()),
      default_github_token_connection_id: map.get('default_github_token_connection_id') || null,
      default_repository_connection_id:
        map.get('default_repository_connection_id') || null,
      default_ai_profile_id: map.get('default_ai_profile_id') || null,
      default_notification_connection_id:
        map.get('default_notification_connection_id') || null,
      timezone: map.get('timezone') || 'Asia/Shanghai',
      auto_start_service: map.get('auto_start_service') === 'true',

    };
  }


  async updateSettings(settings: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
    const db = getDb();
    for (const [key, value] of Object.entries(WorkspaceSettingsSchema.omit({ github_token_configured: true, default_github_token_connection_id: true }).partial().parse(settings))) {
      if (value !== undefined) {
        const valStr = Array.isArray(value) ? JSON.stringify(value) : String(value);
        db.insert(workspaceSettingsTable)
          .values({ key, value: valStr })
          .onConflictDoUpdate({
            target: workspaceSettingsTable.key,
            set: { value: valStr },
          })
          .run();
      }
    }
    return this.getSettings();
  }

  async setDefaultGitHubToken(id: string): Promise<WorkspaceSettings> {
    const connection = getSqliteDatabase().prepare('SELECT credential_ref FROM repository_connections WHERE id=?').get(id) as { credential_ref: string } | undefined;
    const token = connection && secretsStore.getSecret(connection.credential_ref);
    if (!token) throw Object.assign(new Error('该仓库连接没有专用 Token，请先编辑连接并填写 Token'), { statusCode: 400 });
    secretsStore.setSecret(DEFAULT_GITHUB_TOKEN_REF, token);
    getDb().insert(workspaceSettingsTable).values({ key: 'default_github_token_connection_id', value: id })
      .onConflictDoUpdate({ target: workspaceSettingsTable.key, set: { value: id } }).run();
    return this.getSettings();
  }

  // Repository Connections
  async listRepositoryConnections(): Promise<RepositoryConnection[]> {
    const db = getDb();
    const rows = db.select().from(repositoryConnectionsTable).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      revision: r.revision,
      owner: r.owner,
      repo: r.repo,
      default_branch: r.defaultBranch,
      credential_ref: r.credentialRef,
      wiki_base_url: r.wikiBaseUrl,
      wiki_root_path: r.wikiRootPath,
      state: r.state as any,
    }));
  }

  async saveRepositoryConnection(data: {
    id?: string;
    url?: string;
    name?: string;
    owner?: string;
    repo?: string;
    defaultBranch?: string;
    token?: string;
    wikiBaseUrl?: string;
    wikiRootPath?: string;
  }): Promise<RepositoryConnection> {
    let owner = data.owner || '';
    let repo = data.repo || '';

    if (data.url) {
      const parsed = parseGitRepoUrl(data.url);
      if (parsed) {
        owner = parsed.owner;
        repo = parsed.repo;
      }
    }

    if (!owner || !repo) {
      throw new Error('无效的仓库地址，请提供如 https://github.com/owner/repo.git 或 owner/repo 格式');
    }

    const name = data.name?.trim() || `${owner}/${repo}`;
    const db = getDb();
    const id = data.id || `repo_${crypto.randomUUID().slice(0, 8)}`;
    const revision = `rev_${Date.now()}`;
    const credentialRef = `secret_repo_${id}`;
    const existing = db.select().from(repositoryConnectionsTable).where(eq(repositoryConnectionsTable.id, id)).get();
    const wiki = WikiDisplayConfigSchema.parse({
      wiki_base_url: data.wikiBaseUrl ?? existing?.wikiBaseUrl ?? '',
      wiki_root_path: data.wikiRootPath ?? existing?.wikiRootPath ?? '',
    });

    if (data.token) {
      secretsStore.setSecret(credentialRef, data.token);
      if ((await this.getSettings()).default_github_token_connection_id === id) secretsStore.setSecret(DEFAULT_GITHUB_TOKEN_REF, data.token);
    }

    let defaultBranch = data.defaultBranch || 'main';
    let state = 'ready';

    const token = data.token || getGitHubToken(credentialRef);
    if (token) {
      const test = await GitHubClient.testConnection(owner, repo, token);
      if (test.ok) {
        defaultBranch = test.defaultBranch;
      } else {
        state = test.message.includes('404')
          ? 'repo_not_found'
          : test.message.includes('401')
            ? 'invalid_credential'
            : 'unknown';
      }
    }

    const record = {
      id,
      name,
      revision,
      owner,
      repo,
      defaultBranch,
      credentialRef,
      wikiBaseUrl: wiki.wiki_base_url,
      wikiRootPath: wiki.wiki_root_path,
      state,
      updatedAt: new Date().toISOString(),
    };

    db.insert(repositoryConnectionsTable)
      .values(record)
      .onConflictDoUpdate({
        target: repositoryConnectionsTable.id,
        set: record,
      })
      .run();

    return {
      id,
      name,
      revision,
      owner,
      repo,
      default_branch: defaultBranch,
      credential_ref: credentialRef,
      ...wiki,
      state: state as any,
    };
  }

  async testRepositoryConnection(id: string): Promise<{ ok: boolean; message: string }> {
    const db = getDb();
    const repo = db
      .select()
      .from(repositoryConnectionsTable)
      .where(eq(repositoryConnectionsTable.id, id))
      .get();
    if (!repo) {
      return { ok: false, message: 'Repository connection not found' };
    }
    const token = getGitHubToken(repo.credentialRef);
    if (!token) {
      return { ok: false, message: 'Token secret not configured' };
    }
    return GitHubClient.testConnection(repo.owner, repo.repo, token);
  }

  async deleteRepositoryConnection(id: string): Promise<{ ok: boolean }> {
    const db = getDb();
    const inUseGroups = db
      .select({ id: groupsTable.id, name: groupsTable.name })
      .from(groupsTable)
      .where(eq(groupsTable.repositoryConnectionId, id))
      .all();
    if (inUseGroups.length > 0) {
      const names = inUseGroups.map((g) => g.name).join('、');
      throw Object.assign(new Error(`无法删除：该仓库正被流水线任务「${names}」绑定使用，请先在流水线任务设置中更换仓库后再删除。`), {statusCode: 409});
    }

    const repo = db
      .select()
      .from(repositoryConnectionsTable)
      .where(eq(repositoryConnectionsTable.id, id))
      .get();
    if (repo?.credentialRef) {
      secretsStore.deleteSecret(repo.credentialRef);
    }
    db.delete(repositoryConnectionsTable).where(eq(repositoryConnectionsTable.id, id)).run();

    const settings = await this.getSettings();
    if (settings.default_github_token_connection_id === id) {
      secretsStore.deleteSecret(DEFAULT_GITHUB_TOKEN_REF);
      db.delete(workspaceSettingsTable).where(eq(workspaceSettingsTable.key, 'default_github_token_connection_id')).run();
    }
    if (settings.default_repository_connection_id === id) {
      await this.updateSettings({ default_repository_connection_id: '' });
    }

    return { ok: true };
  }

  // Notification Connections
  async listNotificationConnections(): Promise<NotificationConnection[]> {
    const db = getDb();
    const rows = db.select().from(notificationConnectionsTable).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      revision: r.revision,
      url_secret_ref: r.urlSecretRef,
      protocol: 'generic_json',
      state: r.state as any,
    }));
  }

  async saveNotificationConnection(data: {
    id?: string;
    name: string;
    webhookUrl?: string;
  }): Promise<NotificationConnection> {
    const db = getDb();
    const id = data.id || `notify_${crypto.randomUUID().slice(0, 8)}`;
    const revision = `rev_${Date.now()}`;
    const previous = db.select().from(notificationConnectionsTable).where(eq(notificationConnectionsTable.id, id)).get();
    const name = z.string().trim().min(1, '请输入通知通道名称').parse(data.name ?? previous?.name);
    const urlSecretRef = previous?.urlSecretRef || `secret_notify_${id}`;
    const webhookUrl = z.string().trim().url('请输入有效的 Webhook 地址').refine(
      value => /^https?:\/\//i.test(value), 'Webhook 仅支持 HTTP 或 HTTPS',
    ).parse(data.webhookUrl?.trim() || secretsStore.getSecret(urlSecretRef));

    if (data.webhookUrl) {
      secretsStore.setSecret(urlSecretRef, webhookUrl);
    }

    const record = {
      id,
      name,
      revision,
      urlSecretRef,
      protocol: 'generic_json',
      state: 'ready',
      updatedAt: new Date().toISOString(),
    };

    db.insert(notificationConnectionsTable)
      .values(record)
      .onConflictDoUpdate({
        target: notificationConnectionsTable.id,
        set: record,
      })
      .run();

    return {
      id,
      name,
      revision,
      url_secret_ref: urlSecretRef,
      protocol: 'generic_json',
      state: 'ready',
    };
  }

  async deleteNotificationConnection(id: string): Promise<{ ok: boolean }> {
    const db = getDb();
    const plans = db.select().from(reportPlansTable).all().filter(plan => JSON.parse(plan.configurationJson).notification_connection_id === id);
    if (plans.length) throw Object.assign(new Error(`无法删除：通知通道正被汇报方案「${plans.map(plan => plan.name).join('、')}」使用，请先更换方案的通知通道。`), {statusCode: 409});
    const notif = db
      .select()
      .from(notificationConnectionsTable)
      .where(eq(notificationConnectionsTable.id, id))
      .get();
    if (notif?.urlSecretRef) {
      secretsStore.deleteSecret(notif.urlSecretRef);
    }
    db.delete(notificationConnectionsTable).where(eq(notificationConnectionsTable.id, id)).run();

    const settings = await this.getSettings();
    if (settings.default_notification_connection_id === id) {
      await this.updateSettings({ default_notification_connection_id: '' });
    }


    return { ok: true };
  }

  // AI Profiles
  async listAIProfiles(): Promise<AIProfile[]> {
    const db = getDb();
    const rows = db.select().from(aiProfilesTable).all();
    const settings = await this.getSettings();
    const primaryId = settings.default_ai_profile_id;
    return rows.map((r, idx) => ({
      id: r.id,
      name: r.name,
      revision: r.revision,
      provider: r.provider as any,
      cli_path: r.cliPath,
      model: r.model || undefined,
      state: r.state as any,
      is_primary: primaryId ? r.id === primaryId : idx === 0,
      execution: ExecutorConfigSchema.parse(JSON.parse(r.executionJson || '{}')),
      worker_online: Boolean(r.workerLastSeen && Date.now() - Date.parse(r.workerLastSeen) < 45000),
      worker_last_seen: r.workerLastSeen,
      worker_name: r.workerName,
      worker_paired: Boolean(r.workerTokenHash),
    }));
  }

  async setPrimaryAIProfile(id: string): Promise<{ ok: boolean; primary_id: string }> {
    await this.updateSettings({ default_ai_profile_id: id });
    return { ok: true, primary_id: id };
  }

  async saveAIProfile(data: {
    id?: string;
    name: string;
    provider: 'codex_cli' | 'gemini_cli';
    cliPath: string;
    model?: string;
    is_primary?: boolean;
    execution?: Partial<ExecutorConfig>;
  }): Promise<AIProfile> {
    const db = getDb();
    const id = data.id || `ai_${crypto.randomUUID().slice(0, 8)}`;
    const revision = `rev_${Date.now()}`;

    const previous = data.id ? db.select().from(aiProfilesTable).where(eq(aiProfilesTable.id, data.id)).get() : null;
    const parsedSpec = parseModelSpec(data.model);
    const execution = ExecutorConfigSchema.parse({
      ...JSON.parse(previous?.executionJson || '{}'),
      ...(data.execution || {}),
      ...(parsedSpec.reasoning_effort ? { reasoning_effort: parsedSpec.reasoning_effort } : {}),
    });
    if (data.provider === 'gemini_cli' && execution.reasoning_effort && !['low', 'medium', 'high'].includes(execution.reasoning_effort)) {
      throw new Error('Gemini 思考级别仅支持 low、medium、high');
    }
    if (data.provider === 'gemini_cli' && (execution.config_profile || !execution.inherit_user_config)) throw new Error('Gemini 使用本机 Gemini 配置；配置 Profile 和忽略用户配置仅适用于 Codex');
    if (execution.transport !== 'worker' && execution.workspace_root && !path.isAbsolute(execution.workspace_root) && !execution.workspace_root.startsWith('~/')) throw new Error('工作区需要使用执行机的绝对路径');
    if (execution.skills_mode === 'local' && !execution.skills_directory) throw new Error('请选择执行机上的 Skills 目录');
    let state = execution.transport === 'local' ? 'ready' : 'unknown';
    if (execution.transport === 'local') {
      const test = await new ExecutorAdapter(id, data.provider, data.cliPath, execution).testConnection();
      if (!test.ok) state = 'invalid_path';
    }

    const record = {
      id,
      name: data.name,
      revision,
      provider: data.provider,
      cliPath: data.cliPath,
      model: parsedSpec.model || null,
      executionJson: JSON.stringify(execution),
      state,
      updatedAt: new Date().toISOString(),
    };

    db.insert(aiProfilesTable)
      .values(record)
      .onConflictDoUpdate({
        target: aiProfilesTable.id,
        set: record,
      })
      .run();

    if (data.is_primary) {
      await this.setPrimaryAIProfile(id);
    } else {
      const settings = await this.getSettings();
      if (!settings.default_ai_profile_id) {
        await this.setPrimaryAIProfile(id);
      }
    }

    return (await this.listAIProfiles()).find((profile) => profile.id === id)!;
  }

  async testAIProfile(id: string) {
    const profile = (await this.listAIProfiles()).find((item) => item.id === id);
    if (!profile) throw new Error('执行器不存在');
    const result = await new ExecutorAdapter(id, profile.provider, profile.cli_path, profile.execution).testConnection();
    getDb().update(aiProfilesTable).set({state: result.ok ? 'ready' : 'unknown'}).where(eq(aiProfilesTable.id,id)).run();
    return result;
  }

  async deleteAIProfile(id: string): Promise<{ ok: boolean }> {
    const db = getDb();
    const sqlite = (await import('../../infrastructure/persistence/sqlite/db.js')).getSqliteDatabase();
    sqlite.prepare("UPDATE ai_jobs SET status='cancelled',lease_token=NULL WHERE profile_id=? AND status IN ('queued','running')").run(id);
    db.delete(aiProfilesTable).where(eq(aiProfilesTable.id, id)).run();

    db.update(groupsTable)
      .set({ aiProfileId: null })
      .where(eq(groupsTable.aiProfileId, id))
      .run();

    const settings = await this.getSettings();
    if (settings.default_ai_profile_id === id) {
      const remaining = db.select().from(aiProfilesTable).all();
      await this.updateSettings({
        default_ai_profile_id: remaining.length > 0 ? remaining[0].id : '',
      });
    }

    return { ok: true };
  }

  // Doctor check
  async runDoctor(): Promise<DoctorResult> {
    const paths = getAppPaths();
    const checks: DoctorResult['checks'] = [];

    // 1. Data directories
    try {
      const exists = fs.existsSync(paths.dataDir);
      checks.push({
        name: 'Data Directory',
        status: exists ? 'pass' : 'fail',
        message: exists
          ? `Directory ready at ${paths.dataDir}`
          : 'Failed to access data directory',
      });
    } catch (e: any) {
      checks.push({
        name: 'Data Directory',
        status: 'fail',
        message: e.message,
      });
    }

    // 2. Database
    try {
      const db = getDb();
      checks.push({
        name: 'SQLite Database',
        status: 'pass',
        message: `Database accessible at ${paths.dbPath}`,
      });
    } catch (e: any) {
      checks.push({
        name: 'SQLite Database',
        status: 'fail',
        message: `Database error: ${e.message}`,
      });
    }

    // 3. Python environment
    try {
      const runner = new PythonWorkerRunner();
      const pythonPath = runner.getPythonPath();
      const pythonExists = fs.existsSync(pythonPath);
      checks.push({
        name: 'Python Environment',
        status: pythonExists ? 'pass' : 'warn',
        message: pythonExists
          ? `Python worker available at ${pythonPath}`
          : `Python binary not found at ${pythonPath}`,
      });
    } catch (e: any) {
      checks.push({
        name: 'Python Environment',
        status: 'fail',
        message: e.message,
      });
    }

    // 4. AI CLI checks
    const aiProfiles = await this.listAIProfiles();
    if (aiProfiles.length === 0) {
      checks.push({
        name: 'AI CLI Config',
        status: 'warn',
        message: 'No AI profile configured yet',
      });
    } else {
      for (const p of aiProfiles) {
        checks.push({
          name: `AI Profile (${p.name})`,
          status: p.state === 'ready' ? 'pass' : 'warn',
          message: `${p.provider} (${p.cli_path}) status: ${p.state}`,
        });
      }
    }

    const allOk = checks.every((c) => c.status !== 'fail');
    return { ok: allOk, checks };
  }

  // Service Management
  async getServiceStatus(): Promise<ServiceStatus> {
    const isDarwin = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';
    const platform = isDarwin ? 'darwin' : isLinux ? 'linux' : 'other';

    return {
      platform,
      installed: false,
      running: true,
      pid: process.pid,
      listening: '127.0.0.1:8767',
    };
  }
}

export const settingsService = new SettingsService();
