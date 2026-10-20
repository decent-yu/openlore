import type { Group, Manifest } from '@openlore/contracts';

/** One-time repair plan for system-managed duplicate repository pages. */
export function planRepositoryLayoutRepair(group: Group, previous: Manifest) {
  if (group.task_type !== 'repository_research') throw new Error('仅支持仓库研读归档');
  const manifest = structuredClone(previous);
  const base = group.route.base_path;
  const repositories = new Set(Object.values(manifest.article_locations).map(item => item.directory.split('/')[0]));
  const deletePaths = Object.keys(manifest.managed_files).filter(path =>
    [...repositories].some(repository => path === `${base}/${repository}/README.md` || path.startsWith(`${base}/${repository}/articles/`)),
  );
  for (const path of deletePaths) delete manifest.managed_files[path];
  for (const item of Object.values(manifest.article_locations)) {
    delete item.article_path;
    item.research_path ||= `${item.directory}.md`;
    item.reading_path = item.research_path;
  }
  return { manifest, deletePaths };
}
