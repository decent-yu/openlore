import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExecutorConfigSchema, type Skill } from '@openlore/contracts';
import { getSqliteDatabase } from '../../infrastructure/persistence/sqlite/db.js';
import { readSkillBundle, scanSkillDirectory } from '../../infrastructure/ai/skill_bundle.js';
import { getAppPaths } from '../../infrastructure/config/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseSkillMarkdown(filePath: string, fallbackId: string): Skill | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');

    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    let frontmatterRaw = '';
    let body = content;

    if (match) {
      frontmatterRaw = match[1];
      body = match[2].trim();
    }

    const frontmatter: Record<string, any> = {};
    for (const line of frontmatterRaw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        let val = trimmed.slice(colonIdx + 1).trim();
        if (val.startsWith('[') && val.endsWith(']')) {
          frontmatter[key] = val
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
        } else {
          frontmatter[key] = val.replace(/^['"]|['"]$/g, '');
        }
      }
    }

    const id = frontmatter.name || fallbackId;
    const revision = readSkillBundle(id, path.dirname(filePath)).revision;
    return {
      id,
      name: frontmatter.name || fallbackId,
      description: frontmatter.description || '自定义抽取与评估 Skill',
      version: frontmatter.version || undefined,
      type: frontmatter.type || 'extraction',
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : ['extraction'],
      system_prompt: body,
      revision,
      file_path: filePath,
    };
  } catch {
    return null;
  }
}

export class SkillsService {
  private getSkillDirectories(): string[] {
    const dirs: string[] = [];
    const cwd = process.cwd();

    // 1. Repo root / workspace skills directory
    const candidates = [
      path.resolve(cwd, 'skills'),
      path.resolve(cwd, '../skills'),
      path.resolve(cwd, '../../skills'),
      path.resolve(__dirname, '../../../../../skills'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand) && !dirs.includes(cand)) {
        dirs.push(cand);
      }
    }

    // 2. User data skills directory ~/.openlore/skills
    const appPaths = getAppPaths();
    const userSkillsDir = path.join(appPaths.dataDir, 'skills');
    if (fs.existsSync(userSkillsDir) && !dirs.includes(userSkillsDir)) {
      dirs.push(userSkillsDir);
    }

    return dirs;
  }

  async listSkills(profileId?: string): Promise<Skill[]> {
    if (profileId) {
      const db = getSqliteDatabase();
      const id = profileId === 'default' ? (db.prepare("SELECT value FROM workspace_settings WHERE key='default_ai_profile_id'").get() as any)?.value : profileId;
      const profile = db.prepare('SELECT execution_json, worker_catalog_json FROM ai_profiles WHERE id=?').get(id || '') as any;
      if (profile) {
        const config = ExecutorConfigSchema.parse(JSON.parse(profile.execution_json || '{}'));
        if (config.skills_mode === 'local') {
          return config.transport === 'local' ? scanSkillDirectory(config.skills_directory).map((item) => item.skill) : JSON.parse(profile.worker_catalog_json || '[]').map((item: any) => item.skill);
        }
      }
    }
    const dirs = this.getSkillDirectories();
    const skillsMap = new Map<string, Skill>();

    for (const baseDir of dirs) {
      try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMdPath = path.join(baseDir, entry.name, 'SKILL.md');
            const skill = parseSkillMarkdown(skillMdPath, entry.name);
            if (skill && !skillsMap.has(skill.id)) {
              skillsMap.set(skill.id, skill);
            }
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const fallbackId = path.basename(entry.name, '.md');
            const skill = parseSkillMarkdown(path.join(baseDir, entry.name), fallbackId);
            if (skill && !skillsMap.has(skill.id)) {
              skillsMap.set(skill.id, skill);
            }
          }
        }
      } catch {
        // skip unreadable directories
      }
    }

    return Array.from(skillsMap.values());
  }

  async getSkill(id: string, profileId?: string): Promise<Skill | null> {
    const all = await this.listSkills(profileId);
    return all.find((s) => s.id === id) || null;
  }

  async getSkills(ids: string[]): Promise<Skill[]> {
    const all = await this.listSkills();
    const idSet = new Set(ids);
    return all.filter((s) => idSet.has(s.id));
  }
}

export const skillsService = new SkillsService();
