import path from 'node:path';
import fs from 'node:fs';
import {
  ExecutorConfigSchema,
  ExecutionResultSchema,
  type ExecutorConfig,
  type ExecutionRequest,
  type SkillBundle,
} from '@openlore/contracts';
import type { AIAdapter, AITaskInput, AIResult } from './adapter.js';
import { executeInWorkspace, runProcess } from './workspace_runner.js';
import { skillsService } from '../../modules/skills/service.js';
import { readSkillBundle, scanSkillDirectory } from './skill_bundle.js';
import { executionQueue } from '../../modules/executors/queue.js';
import { getSqliteDatabase } from '../persistence/sqlite/db.js';

export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
export class ExecutorAdapter implements AIAdapter {
  constructor(
    public profileId: string,
    public provider: 'codex_cli' | 'gemini_cli',
    public cliPath: string,
    public config: ExecutorConfig,
  ) {}
  async execute(input: AITaskInput): Promise<AIResult> {
    try {
      let bundle: SkillBundle | undefined;
      if (input.skillId) {
        if (this.config.skills_mode === 'local') {
          if (this.config.transport === 'local')
            bundle = scanSkillDirectory(this.config.skills_directory).find(
              (item) => item.skill.id === input.skillId,
            )?.bundle;
          else {
            const row = getSqliteDatabase()
              .prepare('SELECT worker_catalog_json FROM ai_profiles WHERE id=?')
              .get(this.profileId) as any;
            bundle = JSON.parse(row?.worker_catalog_json || '[]').find(
              (item: any) => item.skill.id === input.skillId,
            )?.bundle;
          }
        } else {
          const skill = await skillsService.getSkill(input.skillId);
          if (skill && skill.file_path !== 'builtin')
            bundle = readSkillBundle(skill.id, path.dirname(skill.file_path));
        }
        if (
          input.skillRevision &&
          bundle &&
          input.skillRevision !== bundle.revision
        )
          throw new Error('所选 Skill 版本与执行器版本不一致，请刷新后重试');
        if (!bundle)
          throw new Error(
            `Skill 未就绪：${input.skillId}，请同步或刷新执行器的 Skills`,
          );
      }
      const request: ExecutionRequest = {
        input: {
          ...input,
          skillBundle: bundle,
          skillRevision: bundle?.revision,
        },
        config: this.config,
        provider: this.provider,
        cli_path: this.cliPath,
      };
      let result: AIResult;
      if (this.config.transport === 'worker')
        result = await executionQueue.wait(
          executionQueue.enqueue(this.profileId, request),
          request,
        );
      else if (this.config.transport === 'ssh')
        result = await this.ssh({ action: 'execute', request });
      else result = await executeInWorkspace(request);
      return result;
    } catch (error: any) {
      return {
        status: 'failed',
        provider: this.provider,
        model: input.model || 'default',
        durationMs: 0,
        error: { code: 'executor_error', message: error.message },
      };
    }
  }
  async ssh(payload: unknown): Promise<any> {
    const c = this.config;
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(c.ssh_host) ||
      !c.ssh_cli_entry ||
      !c.ssh_node_path
    )
      throw new Error('请配置有效 SSH 主机、Node 路径与 OpenLore CLI 路径');
    if (c.ssh_user && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(c.ssh_user))
      throw new Error('SSH 用户名无效');
    const args = [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ConnectTimeout=10',
      '-p',
      String(c.ssh_port),
    ];
    if (c.ssh_identity_file) args.push('-i', c.ssh_identity_file);
    args.push(
      c.ssh_user ? `${c.ssh_user}@${c.ssh_host}` : c.ssh_host,
      `${shellQuote(c.ssh_node_path)} ${shellQuote(c.ssh_cli_entry)} execute-once`,
    );
    const result = await runProcess(
      'ssh',
      args,
      process.cwd(),
      JSON.stringify(payload),
      (c.timeout_seconds + 20) * 1000,
    );
    if (result.code !== 0 || result.timedOut)
      throw new Error(
        'SSH 执行失败，请检查连通性、known_hosts、密钥和远端路径',
      );
    return JSON.parse(result.stdout);
  }
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (this.config.transport === 'worker') {
      const row = getSqliteDatabase()
        .prepare('SELECT worker_last_seen FROM ai_profiles WHERE id=?')
        .get(this.profileId) as any;
      const online =
        row?.worker_last_seen &&
        Date.now() - Date.parse(row.worker_last_seen) < 45000;
      return {
        ok: Boolean(online),
        message: online ? '本机执行器在线' : '等待本机执行器连接',
      };
    }
    if (this.config.transport === 'ssh') {
      try {
        const result = await this.ssh({
          action: 'inspect',
          config: this.config,
          cli_path: this.cliPath,
        });
        getSqliteDatabase()
          .prepare(
            'UPDATE ai_profiles SET worker_catalog_json=?,worker_last_seen=? WHERE id=?',
          )
          .run(
            JSON.stringify(result.catalog || []),
            new Date().toISOString(),
            this.profileId,
          );
        return { ok: true, message: `SSH 已连接：${result.version}` };
      } catch (error: any) {
        return { ok: false, message: error.message };
      }
    }
    try {
      const res = await runProcess(
        this.cliPath,
        ['--version'],
        process.cwd(),
        '',
        10000,
      );
      return {
        ok: res.code === 0,
        message: res.stdout.trim() || 'CLI 版本检查失败',
      };
    } catch (error: any) {
      return { ok: false, message: error.message };
    }
  }
}
