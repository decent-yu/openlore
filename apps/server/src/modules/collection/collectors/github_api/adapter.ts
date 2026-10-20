import type {
  CollectionRequest,
  CollectionResult,
  ContentItem,
} from '@openlore/contracts';
import { getGitHubToken } from '../../../../infrastructure/repositories/github/credentials.js';
import { SafeHttpClient } from '../../../../infrastructure/http/client.js';
import type { CollectorAdapter } from '../../registry.js';

export class GithubApiCollectorAdapter implements CollectorAdapter {
  id = 'github_api';
  supportedOperations: Array<'discover' | 'fetch'> = ['discover', 'fetch'];

  parseOwnerRepo(url: string): { owner: string; repo: string } | null {
    const cleaned = url.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    const parts = cleaned.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
    return null;
  }

  async collect(request: CollectionRequest): Promise<CollectionResult> {
    const observedAt = new Date().toISOString();
    const targetUrl = request.target.url;
    const parsed = this.parseOwnerRepo(targetUrl);

    if (!parsed) {
      return {
        run_id: request.run_id,
        source_id: request.source_id,
        capability_id: this.id,
        status: 'failed',
        items: [],
        next_state: null,
        scan: 'complete',
        errors: [
          {
            code: 'invalid_config',
            message: `Invalid GitHub repository URL: ${targetUrl}`,
            retryable: false,
          },
        ],
        observed_at: observedAt,
        stats: { requests: 0, items_observed: 0, items_returned: 0 },
      };
    }

    const { owner, repo } = parsed;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`;

    try {
      const token = getGitHubToken(request.credential_ref);
      const res = await SafeHttpClient.fetch(apiUrl, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'OpenLore-Collector/1.0',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        maxRedirects: token ? 0 : 5,
        timeoutMs: (request.budget?.timeout_seconds || 30) * 1000,
      });

      if (res.status === 200) {
        const data = JSON.parse(res.text);
        const items: ContentItem[] = (Array.isArray(data) ? data : []).map((rel: any) => ({
          source_item_id: `${request.source_id}:${rel.id || rel.tag_name}`,
          source_id: request.source_id,
          native_id: String(rel.id || ''),
          original_url: rel.html_url || targetUrl,
          final_url: rel.html_url || targetUrl,
          canonical_url: rel.html_url || targetUrl,
          title: `[Release] ${rel.name || rel.tag_name || 'New Release'}`,
          author: rel.author?.login || owner,
          published_at: rel.published_at || rel.created_at || observedAt,
          updated_at: rel.published_at || null,
          body: {
            value: rel.body || 'No release notes provided.',
            format: 'markdown',
            completeness: rel.body ? 'full' : 'summary',
          },
          attachments: (rel.assets || []).map((a: any) => ({
            url: a.browser_download_url,
            kind: 'binary',
            fetched: false,
          })),
          fetched_at: observedAt,
          fetch_method: 'github_api',
          issues: [],
        }));

        return {
          run_id: request.run_id,
          source_id: request.source_id,
          capability_id: this.id,
          status: 'success',
          items,
          next_state: null,
          scan: 'complete',
          errors: [],
          observed_at: observedAt,
          stats: {
            requests: 1,
            items_observed: items.length,
            items_returned: items.length,
          },
        };
      }

      return {
        run_id: request.run_id,
        source_id: request.source_id,
        capability_id: this.id,
        status: 'partial',
        items: [],
        next_state: null,
        scan: 'complete',
        errors: [
          {
            code: 'github_api_status',
            message: `GitHub API returned status ${res.status}`,
            retryable: res.status >= 500,
          },
        ],
        observed_at: observedAt,
        stats: { requests: 1, items_observed: 0, items_returned: 0 },
      };
    } catch (err: any) {
      return {
        run_id: request.run_id,
        source_id: request.source_id,
        capability_id: this.id,
        status: 'failed',
        items: [],
        next_state: null,
        scan: 'unknown',
        errors: [
          {
            code: 'network_error',
            message: err.message || 'Failed to fetch GitHub releases',
            retryable: true,
          },
        ],
        observed_at: observedAt,
        stats: { requests: 1, items_observed: 0, items_returned: 0 },
      };
    }
  }
}
