import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import type { SkillBundle, Skill } from '@openlore/contracts';

export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
export function assertSkillId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id))
    throw new Error('Invalid Skill identifier');
}
export function safeRelativePath(value: string): string {
  if (
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid relative file path');
  return value;
}
export function bundleRevision(files: SkillBundle['files']): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([...files].sort((a, b) => a.path.localeCompare(b.path))),
    )
    .digest('hex');
}
export function readSkillBundle(id: string, directory: string): SkillBundle {
  assertSkillId(id);
  const root = fs.realpathSync(directory);
  const files: SkillBundle['files'] = [];
  let bytes = 0;
  function walk(folder: string, prefix = '') {
    for (const item of fs
      .readdirSync(folder, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        item.name.startsWith('.') ||
        item.name === 'node_modules' ||
        item.name === '__pycache__'
      )
        continue;
      const full = path.join(folder, item.name),
        relative = prefix + item.name;
      if (item.isSymbolicLink())
        throw new Error(`Skill contains a symlink: ${relative}`);
      if (item.isDirectory()) walk(full, relative + '/');
      else if (item.isFile()) {
        const stat = fs.statSync(full);
        bytes += stat.size;
        if (bytes > MAX_BUNDLE_BYTES || files.length >= 500)
          throw new Error('Skill package is too large');
        files.push({
          path: relative,
          content: fs.readFileSync(full).toString('base64'),
          executable: Boolean(stat.mode & 0o111),
        });
      }
    }
  }
  walk(root);
  if (!files.some((file) => file.path === 'SKILL.md'))
    throw new Error(`Missing SKILL.md for ${id}`);
  return { id, revision: bundleRevision(files), files };
}
export function validateBundle(bundle: SkillBundle): void {
  assertSkillId(bundle.id);
  const paths = new Set<string>();
  let size = 0;
  for (const file of bundle.files) {
    safeRelativePath(file.path);
    if (paths.has(file.path)) throw new Error('Duplicate Skill file');
    paths.add(file.path);
    size += Buffer.from(file.content, 'base64').length;
    if (size > MAX_BUNDLE_BYTES) throw new Error('Skill package is too large');
  }
  if (
    !paths.has('SKILL.md') ||
    bundle.revision !== bundleRevision(bundle.files)
  )
    throw new Error('Skill revision verification failed');
}
export function scanSkillDirectory(
  directory: string,
): Array<{ skill: Skill; bundle: SkillBundle }> {
  if (!directory) return [];
  if (directory.startsWith('~/'))
    directory = path.join(os.homedir(), directory.slice(2));
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .flatMap((entry) => {
      const folder = path.join(directory, entry.name),
        manifest = path.join(folder, 'SKILL.md');
      if (!fs.existsSync(manifest)) return [];
      const text = fs.readFileSync(manifest, 'utf8');
      const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!match) throw new Error(`Invalid Skill manifest: ${entry.name}`);
      const field = (name: string) =>
        match[1]
          .match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]
          .trim()
          .replace(/^['"]|['"]$/g, '');
      const id = field('name') || entry.name;
      const bundle = readSkillBundle(id, folder);
      return [
        {
          skill: {
            id,
            name: id,
            description: field('description') || '',
            type: field('type') || 'extraction',
            version: field('version'),
            revision: bundle.revision,
            tags: [],
            file_path: manifest,
            system_prompt: match[2].trim(),
          },
          bundle,
        },
      ];
    });
}
