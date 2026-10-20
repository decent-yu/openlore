import { expect, it, vi, afterEach } from 'vitest';
import { GroupSchema, ManifestSchema } from '@openlore/contracts';
import { planRepositoryLayoutRepair } from '../src/modules/delivery/repository-layout.js';
import { GitHubClient } from '../src/infrastructure/repositories/github/client.js';

afterEach(() => vi.restoreAllMocks());

it('removes only managed material copies and repository indexes while preserving reports and root navigation', () => {
  const group = GroupSchema.parse({ id: 'study', name: 'Study', task_type: 'repository_research', route: { repository_connection_id: 'vault', base_path: 'docs/research' }, created_at: '', updated_at: '' });
  const metadata = { sha256: 'hash', media_type: 'text/markdown', size: 1 };
  const original = ManifestSchema.parse({
    group_id: 'study', collection_locations: {}, delivered_batches: [],
    article_locations: { one: { collection_id: 'batch', directory: 'owner@repo/01-topic', slug: 'topic', title: 'Topic', original_url: 'https://github.com/owner/repo', tags: [], collected_at: '', updated_at: '', has_research: true, reading_path: 'owner@repo/01-topic.md', research_path: 'owner@repo/01-topic.md', article_path: 'owner@repo/articles/01-topic.md' } },
    managed_files: Object.fromEntries(['docs/research/README.md', 'docs/research/owner@repo/README.md', 'docs/research/owner@repo/articles/01-topic.md', 'docs/research/owner@repo/01-topic.md', 'docs/research/owner@repo/assets/01-topic/diagram.svg', 'docs/articles/README.md'].map(path => [path, metadata])),
  });
  const plan = planRepositoryLayoutRepair(group, original);
  expect(plan.deletePaths.sort()).toEqual(['docs/research/owner@repo/README.md', 'docs/research/owner@repo/articles/01-topic.md']);
  expect(plan.manifest.article_locations.one.article_path).toBeUndefined();
  expect(plan.manifest.article_locations.one.research_path).toBe('owner@repo/01-topic.md');
  expect(Object.keys(plan.manifest.managed_files)).toEqual(expect.arrayContaining(['docs/research/README.md', 'docs/research/owner@repo/01-topic.md', 'docs/research/owner@repo/assets/01-topic/diagram.svg', 'docs/articles/README.md']));
  expect(original.article_locations.one.article_path).toBeTruthy();
  expect(planRepositoryLayoutRepair(group, plan.manifest).deletePaths).toEqual([]);
});

it('publishes deletions as one non-forced Git tree update without uploading replacement blobs', async () => {
  const request = vi.spyOn(GitHubClient, 'request').mockResolvedValueOnce({ object: { sha: 'head' } }).mockResolvedValueOnce({ tree: { sha: 'old-tree' } }).mockResolvedValueOnce({ sha: 'new-tree' }).mockResolvedValueOnce({ sha: 'new-commit' }).mockResolvedValueOnce({});
  const result = await GitHubClient.syncFiles({ owner: 'example', repo: 'vault', branch: 'main', token: 'test', basePath: 'docs/research', expectedHead: 'head', files: [], deletePaths: ['docs/research/owner@repo/README.md'], commitMessage: 'Remove duplicate page' });
  expect(result.status).toBe('updated');
  const tree = request.mock.calls.find(([url]) => url.endsWith('/git/trees'))!;
  expect(JSON.parse(String(tree[2]?.body))).toMatchObject({ base_tree: 'old-tree', tree: [{ path: 'docs/research/owner@repo/README.md', sha: null }] });
  expect(request.mock.calls.some(([url]) => url.endsWith('/git/blobs'))).toBe(false);
  expect(JSON.parse(String(request.mock.calls.at(-1)![2]?.body))).toEqual({ sha: 'new-commit', force: false });
});

it('stops repair when the archive branch changes or a deletion escapes its base path', async () => {
  const request = vi.spyOn(GitHubClient, 'request').mockResolvedValue({ object: { sha: 'changed' }, tree: { sha: 'tree' } });
  const options = { owner: 'example', repo: 'vault', branch: 'main', token: 'test', basePath: 'docs/research', files: [], commitMessage: 'Repair' };
  expect((await GitHubClient.syncFiles({ ...options, expectedHead: 'previous' })).status).toBe('conflict');
  expect(request).toHaveBeenCalledTimes(1);
  request.mockClear();
  expect((await GitHubClient.syncFiles({ ...options, deletePaths: ['docs/research/../other.md'] })).status).toBe('failed');
  expect(request.mock.calls.some(([, , options]) => options?.method === 'POST')).toBe(false);
});
