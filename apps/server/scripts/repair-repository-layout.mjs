import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initDatabase, getSqliteDatabase } from '../dist/infrastructure/persistence/sqlite/db.js';
import { getAppPaths } from '../dist/infrastructure/config/paths.js';
import { GitHubClient } from '../dist/infrastructure/repositories/github/client.js';
import { getGitHubToken } from '../dist/infrastructure/repositories/github/credentials.js';
import { groupsService } from '../dist/modules/groups/service.js';
import { loadManifest } from '../dist/modules/delivery/publication.js';
import { planRepositoryLayoutRepair } from '../dist/modules/delivery/repository-layout.js';
import { navigationFiles, batchNavigationFile, finalizeManifest } from '../dist/modules/delivery/archive-layout.js';

const args = process.argv.slice(2);
const groupId = args[args.indexOf('--group') + 1];
if (!args.includes('--group') || !groupId) throw new Error('用法：node apps/server/scripts/repair-repository-layout.mjs --group <id> [--apply]');
initDatabase();
const db = getSqliteDatabase();
try {
  const group = await groupsService.getGroup(groupId);
  if (!group) throw new Error('流水线不存在');
  const previous = loadManifest(group);
  const { manifest, deletePaths } = planRepositoryLayoutRepair(group, previous);
  if (!deletePaths.length) {
    console.log(JSON.stringify({ group: group.name, status: 'unchanged', delete_paths: [] }));
  } else {
    const repository = db.prepare('SELECT * FROM repository_connections WHERE id=?').get(group.route.repository_connection_id);
    if (!repository) throw new Error('归档仓库连接不存在');
    const token = getGitHubToken(repository.credential_ref);
    if (!token) throw new Error('归档仓库 Token 不存在');
    const api = `https://api.github.com/repos/${repository.owner}/${repository.repo}`;
    const ref = await GitHubClient.request(`${api}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`, token);
    const head = ref.object.sha;
    const commit = await GitHubClient.request(`${api}/git/commits/${head}`, token);
    const tree = await GitHubClient.request(`${api}/git/trees/${commit.tree.sha}?recursive=1`, token);
    if (tree.truncated) throw new Error('远端文件树不完整，停止历史清理');
    const remote = new Map(tree.tree.filter(item => item.type === 'blob').map(item => [item.path, item]));
    const actualDeletes = deletePaths.filter(file => remote.has(file));
    const retainedReports = Object.values(manifest.article_locations).map(item => `${group.route.base_path}/${item.research_path}`);
    for (const file of retainedReports) if (!remote.has(file)) throw new Error(`研报不存在，停止清理：${file}`);
    console.log(JSON.stringify({ group: group.name, repository: `${repository.owner}/${repository.repo}`, branch: repository.default_branch, delete_paths: actualDeletes, retained_reports: retainedReports }, null, 2));
    if (args.includes('--apply')) {
      const backup = path.join(getAppPaths().backupsDir, `repository-layout-${Date.now()}`);
      fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
      await db.backup(path.join(backup, 'openlore.db'));
      fs.chmodSync(path.join(backup, 'openlore.db'), 0o600);
      fs.writeFileSync(path.join(backup, 'before-manifest.json'), JSON.stringify(previous, null, 2), { mode: 0o600 });
      fs.writeFileSync(path.join(backup, 'before-head.txt'), head, { mode: 0o600 });
      const read = async file => {
        const blob = await GitHubClient.request(`${api}/git/blobs/${remote.get(file).sha}`, token);
        return Buffer.from(blob.content, 'base64');
      };
      for (const file of actualDeletes) {
        const destination = path.join(backup, 'files', file);
        fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
        fs.writeFileSync(destination, await read(file), { mode: 0o600 });
      }
      const retainedFiles = [];
      for (const [file, metadata] of Object.entries(manifest.managed_files)) {
        if (!remote.has(file)) { delete manifest.managed_files[file]; continue; }
        const bytes = await read(file);
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        manifest.managed_files[file] = { ...metadata, sha256, size: bytes.length };
        retainedFiles.push({ path: file, content_bytes: bytes.toString('base64'), encoding: metadata.media_type.startsWith('text/') ? 'utf-8' : 'binary', sha256, media_type: metadata.media_type });
      }
      const batchId = `repair_${crypto.randomUUID()}`;
      const writes = Object.keys(manifest.collection_locations).map(id => batchNavigationFile(group, manifest, id, retainedFiles));
      writes.push(...navigationFiles(group, manifest, retainedFiles));
      manifest.delivered_batches.push(batchId);
      finalizeManifest(group.route.base_path, manifest, writes);
      const result = await GitHubClient.syncFiles({
        owner: repository.owner, repo: repository.repo, branch: repository.default_branch, token,
        basePath: group.route.base_path, expectedHead: head, deletePaths: actualDeletes,
        commitMessage: `chore(knowledge): remove duplicate repository research pages`,
        files: writes.map(file => ({ path: file.path, content: file.content_bytes, encoding: file.encoding, sha256: file.sha256 })),
      });
      if (!['updated', 'unchanged'].includes(result.status)) throw new Error(result.errorMessage || '远端清理失败');
      const files = [...new Map([...retainedFiles, ...writes].map(file => [file.path, file])).values()];
      const bundle = {
        group_id: group.id, run_id: batchId, collection_id: Object.keys(manifest.collection_locations)[0] || '',
        batch_id: batchId, snapshot_ref: batchId, kind: 'repair',
        entries: Object.entries(manifest.article_locations).map(([article_id, item]) => ({ article_id, slug: item.slug, directory: item.directory, research_path: `${group.route.base_path}/${item.research_path}` })),
        assets: [], files,
      };
      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare('INSERT INTO artifact_bundles(id,group_id,run_id,collection_id,batch_id,snapshot_ref,kind,bundle_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(`bun_${batchId}`, group.id, batchId, bundle.collection_id, batchId, batchId, 'repair', JSON.stringify(bundle), now);
        db.prepare('INSERT INTO deliveries(id,group_id,batch_id,target_kind,status,commit_sha,commit_url,changed_paths_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(`delivery_${batchId}`, group.id, batchId, 'github', result.status, result.commitSha || null, result.commitUrl || null, JSON.stringify(result.changedPaths), now, now);
      })();
      console.log(JSON.stringify({ status: result.status, commit_url: result.commitUrl, deleted: actualDeletes.length, backup }, null, 2));
    }
  }
} finally { db.close(); }
