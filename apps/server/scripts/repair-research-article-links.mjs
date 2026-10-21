import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ManifestSchema } from '@openlore/contracts';
import { initDatabase, getSqliteDatabase } from '../dist/infrastructure/persistence/sqlite/db.js';
import { getAppPaths } from '../dist/infrastructure/config/paths.js';
import { GitHubClient } from '../dist/infrastructure/repositories/github/client.js';
import { getGitHubToken } from '../dist/infrastructure/repositories/github/credentials.js';
import { groupsService } from '../dist/modules/groups/service.js';
import { loadManifest } from '../dist/modules/delivery/publication.js';
import { researchWithArticleHeader, markdownFile, finalizeManifest } from '../dist/modules/delivery/archive-layout.js';

const args = process.argv.slice(2);
const groupIndex = args.indexOf('--group');
const groupId = groupIndex < 0 ? undefined : args[groupIndex + 1];
if (groupIndex >= 0 && (!groupId || groupId.startsWith('--')))
  throw new Error('用法：node apps/server/scripts/repair-research-article-links.mjs [--group <id>] [--apply]');
initDatabase();
const db = getSqliteDatabase();
const backupRoot = path.join(getAppPaths().backupsDir, `research-article-links-${Date.now()}`);
try {
  const groups = (await groupsService.listGroups()).filter(group =>
    group.task_type === 'article_research' && (!groupId || group.id === groupId));
  if (!groups.length) throw new Error('没有匹配的文章调研流水线');
  if (args.includes('--apply')) {
    const active = db.prepare("SELECT id FROM runs WHERE status IN ('running','queued') UNION ALL SELECT id FROM ai_jobs WHERE status IN ('running','queued')").all();
    if (active.length) throw new Error('存在执行中的任务，稍后再修复历史归档');
  }
  for (const group of groups) {
    const localManifest = loadManifest(group);
    if (!Object.values(localManifest.article_locations).some(item => item.has_research)) continue;
    const repository = db.prepare('SELECT * FROM repository_connections WHERE id=?').get(group.route.repository_connection_id);
    if (!repository) throw new Error('归档仓库连接不存在');
    const token = getGitHubToken(repository.credential_ref);
    if (!token) throw new Error('归档仓库 Token 不存在');
    const api = `https://api.github.com/repos/${repository.owner}/${repository.repo}`;
    const ref = await GitHubClient.request(`${api}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`, token);
    const head = ref.object.sha;
    const commit = await GitHubClient.request(`${api}/git/commits/${head}`, token);
    const tree = await GitHubClient.request(`${api}/git/trees/${commit.tree.sha}?recursive=1`, token);
    if (tree.truncated) throw new Error('远端文件树不完整，停止修复');
    const remote = new Map(tree.tree.filter(item => item.type === 'blob').map(item => [item.path, item]));
    const read = async file => {
      if (!remote.has(file)) throw new Error(`归档文件不存在：${file}`);
      const blob = await GitHubClient.request(`${api}/git/blobs/${remote.get(file).sha}`, token);
      return Buffer.from(blob.content, 'base64');
    };
    const base = group.route.base_path;
    const manifestPath = `${base}/.openlore/manifest.json`;
    const originalManifest = await read(manifestPath);
    const manifest = ManifestSchema.parse(JSON.parse(originalManifest.toString('utf8')));
    if (manifest.group_id !== group.id) throw new Error('远端 manifest 不属于当前流水线');
    const writes = [], entries = [], originals = new Map();
    for (const [articleId, item] of Object.entries(manifest.article_locations)) {
      if (!item.has_research) continue;
      const file = `${base}/${item.research_path || `${item.directory}/research.md`}`;
      if (!file.startsWith(`${base}/`) || file.split('/').some(part => part === '..' || part === '.' || !part))
        throw new Error(`研报路径不在归档目录内：${file}`);
      if (!manifest.managed_files[file]) throw new Error(`研报不是托管文件：${file}`);
      const directory = path.posix.dirname(file);
      const hasChinese = remote.has(`${directory}/article-zh-CN.md`);
      const articlePath = `${directory}/${hasChinese ? 'article-zh-CN.md' : 'article.md'}`;
      if (!remote.has(articlePath)) throw new Error(`没有可链接的正文：${file}`);
      const before = await read(file);
      const article = db.prepare('SELECT author,published_at FROM articles WHERE id=?').get(articleId);
      const after = researchWithArticleHeader(before.toString('utf8'), {
        title: item.title, original_url: item.original_url,
        author: article?.author, published_at: article?.published_at,
      }, hasChinese, group.timezone);
      if (before.equals(Buffer.from(after))) continue;
      writes.push(markdownFile(file, after));
      originals.set(file, before);
      entries.push({ article_id: articleId, slug: item.slug, directory: item.directory, research_path: file });
    }
    console.log(JSON.stringify({ group: group.name, repository: `${repository.owner}/${repository.repo}`, branch: repository.default_branch, reports: writes.map(file => file.path), count: writes.length }, null, 2));
    if (!writes.length || !args.includes('--apply')) continue;
    const backup = path.join(backupRoot, group.id);
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    await db.backup(path.join(backup, 'openlore.db'));
    fs.chmodSync(path.join(backup, 'openlore.db'), 0o600);
    fs.writeFileSync(path.join(backup, 'before-head.txt'), head, { mode: 0o600 });
    fs.writeFileSync(path.join(backup, 'local-manifest.json'), JSON.stringify(localManifest, null, 2), { mode: 0o600 });
    originals.set(manifestPath, originalManifest);
    for (const [file, bytes] of originals) {
      const target = path.join(backup, 'files', file);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, bytes, { mode: 0o600 });
    }
    const batchId = `repair_${crypto.randomUUID()}`;
    manifest.delivered_batches.push(batchId);
    finalizeManifest(base, manifest, writes);
    const result = await GitHubClient.syncFiles({
      owner: repository.owner, repo: repository.repo, branch: repository.default_branch, token,
      basePath: base, expectedHead: head,
      commitMessage: 'docs(research): add source context to archived reports',
      files: writes.map(file => ({ path: file.path, content: file.content_bytes, encoding: file.encoding, sha256: file.sha256 })),
    });
    fs.writeFileSync(path.join(backup, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    if (!['updated', 'unchanged'].includes(result.status)) throw new Error(result.errorMessage || '历史研报修复失败');
    const bundle = {
      group_id: group.id, run_id: batchId, collection_id: '', batch_id: batchId,
      snapshot_ref: batchId, kind: 'repair', entries, assets: [], files: writes,
    };
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('INSERT INTO artifact_bundles(id,group_id,run_id,collection_id,batch_id,snapshot_ref,kind,bundle_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(`bun_${batchId}`, group.id, batchId, '', batchId, batchId, 'repair', JSON.stringify(bundle), now);
      db.prepare('INSERT INTO deliveries(id,group_id,batch_id,target_kind,status,commit_sha,commit_url,changed_paths_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(`delivery_${batchId}`, group.id, batchId, 'github', result.status, result.commitSha || null, result.commitUrl || null, JSON.stringify(result.changedPaths), now, now);
    })();
    console.log(JSON.stringify({ status: result.status, repaired: entries.length, commit_url: result.commitUrl, backup }, null, 2));
  }
} finally { db.close(); }
