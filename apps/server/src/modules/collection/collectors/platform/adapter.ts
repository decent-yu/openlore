import type {
  CollectionRequest,
  CollectionResult,
  ContentItem,
} from '@openlore/contracts';
import { SafeHttpClient } from '../../../../infrastructure/http/client.js';
import type { CollectorAdapter } from '../../registry.js';

export class PlatformCollectorAdapter implements CollectorAdapter {
  id = 'platform';
  supportedOperations: Array<'discover' | 'fetch'> = ['discover', 'fetch'];

  async collect(request: CollectionRequest): Promise<CollectionResult> {
    const observedAt = new Date().toISOString();
    const targetUrl = request.target.url;

    try {
      const res = await SafeHttpClient.fetch(targetUrl, {
        timeoutMs: (request.budget?.timeout_seconds || 30) * 1000,
      });

      const item: ContentItem = {
        source_item_id: `${request.source_id}:${Buffer.from(targetUrl).toString('base64').slice(0, 16)}`,
        source_id: request.source_id,
        native_id: null,
        original_url: targetUrl,
        final_url: res.url,
        canonical_url: res.url,
        title: `[Platform Content] ${targetUrl}`,
        author: (request.options?.author_handle as string) || null,
        published_at: observedAt,
        updated_at: null,
        body: {
          value: res.text.slice(0, 5000),
          format: 'text',
          completeness: 'summary',
        },
        attachments: [],
        fetched_at: observedAt,
        fetch_method: 'platform',
        issues: [],
      };

      return {
        run_id: request.run_id,
        source_id: request.source_id,
        capability_id: this.id,
        status: 'success',
        items: [item],
        next_state: null,
        scan: 'complete',
        errors: [],
        observed_at: observedAt,
        stats: { requests: 1, items_observed: 1, items_returned: 1 },
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
            code: 'fetch_error',
            message: err.message || 'Platform fetch failed',
            retryable: true,
          },
        ],
        observed_at: observedAt,
        stats: { requests: 1, items_observed: 0, items_returned: 0 },
      };
    }
  }
}
