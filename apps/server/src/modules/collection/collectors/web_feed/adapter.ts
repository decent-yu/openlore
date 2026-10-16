import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CollectionRequest,
  CollectionResult,
  ContentItem,
} from '@openlore/contracts';
import { getAppPaths } from '../../../../infrastructure/config/paths.js';
import { SafeHttpClient } from '../../../../infrastructure/http/client.js';
import { pythonWorkerRunner } from '../../../../infrastructure/python/runner.js';
import type { CollectorAdapter } from '../../registry.js';

export class WebFeedCollectorAdapter implements CollectorAdapter {
  id = 'web_feed';
  supportedOperations: Array<'discover' | 'fetch'> = ['discover'];

  async collect(request: CollectionRequest): Promise<CollectionResult> {
    const observedAt = new Date().toISOString();
    const targetUrl = request.target.url;

    if (request.operation !== 'discover') {
      return {
        run_id: request.run_id,
        source_id: request.source_id,
        capability_id: this.id,
        status: 'failed',
        items: [],
        next_state: request.state || null,
        scan: 'unknown',
        errors: [
          {
            code: 'unsupported_operation',
            message: `web_feed does not support operation '${request.operation}'`,
            retryable: false,
          },
        ],
        observed_at: observedAt,
        stats: { requests: 0, items_observed: 0, items_returned: 0 },
      };
    }

    const state = (request.state || {}) as Record<string, any>;
    if (state.pending_items_ref && fs.existsSync(state.pending_items_ref)) {
      const pending = JSON.parse(fs.readFileSync(state.pending_items_ref, 'utf-8')) as ContentItem[];
      return this.page(request, pending, state, observedAt, 0);
    }
    const prevEtag = state.etag;
    const prevLastModified = state.last_modified;

    try {
      const httpRes = await SafeHttpClient.fetch(targetUrl, {
        etag: prevEtag,
        lastModified: prevLastModified,
        timeoutMs: (request.budget?.timeout_seconds || 30) * 1000,
      });

      if (httpRes.notModified) {
        return {
          run_id: request.run_id,
          source_id: request.source_id,
          capability_id: this.id,
          status: 'not_modified',
          items: [],
          next_state: request.state || null,
          scan: 'unknown',
          errors: [],
          observed_at: observedAt,
          stats: { requests: 1, items_observed: 0, items_returned: 0 },
        };
      }

      if (httpRes.status < 200 || httpRes.status >= 300) throw new Error(`HTTP ${httpRes.status}`);

      // Save raw feed bytes to blobs storage
      const sha256 = crypto
        .createHash('sha256')
        .update(httpRes.data)
        .digest('hex');
      const paths = getAppPaths();
      const rawRef = path.join(paths.blobsDir, sha256);
      if (!fs.existsSync(rawRef)) {
        fs.writeFileSync(rawRef, httpRes.data);
      }

      // Save to temp job file for python worker
      const jobDir = path.join(paths.jobsDir, request.run_id);
      if (!fs.existsSync(jobDir)) {
        fs.mkdirSync(jobDir, { recursive: true });
      }
      const inputPath = path.join(jobDir, `feed_${Date.now()}.xml`);
      fs.writeFileSync(inputPath, httpRes.data);

      const pyRes = await pythonWorkerRunner.run({
        protocol_version: 1,
        job_id: request.run_id,
        operation: 'parse_feed',
        input_path: inputPath,
        original_url: targetUrl,
        response_meta: {
          content_type: httpRes.headers['content-type'],
          status_code: httpRes.status,
        },
        options: {},
      });

      try {
        fs.unlinkSync(inputPath);
      } catch {
        // ignore
      }

      if (pyRes.status === 'failed' || !pyRes.data) {
        return {
          run_id: request.run_id,
          source_id: request.source_id,
          capability_id: this.id,
          status: 'failed',
          items: [],
          next_state: request.state || null,
          scan: 'unknown',
          errors: [
            {
              code: pyRes.error?.code || 'parse_error',
              message: pyRes.error?.message || 'Failed to parse feed in Python worker',
              retryable: pyRes.error?.retryable ?? true,
            },
          ],
          observed_at: observedAt,
          stats: { requests: 1, items_observed: 0, items_returned: 0 },
        };
      }

      const feedData = pyRes.data as { feed: any; entries: any[] };
      const rawEntries = feedData.entries || [];
      const items: ContentItem[] = [];

      for (const e of rawEntries) {
        const nativeId = e.native_id || null;
        const link = e.link || null;
        // source_item_id: stable within source; source_id + upstream native_id or canonical url
        const sourceItemId = nativeId
          ? `${request.source_id}:${nativeId}`
          : link
            ? `${request.source_id}:${link}`
            : `${request.source_id}:${crypto.randomUUID()}`;

        items.push({
          source_item_id: sourceItemId,
          source_id: request.source_id,
          native_id: nativeId,
          original_url: link,
          final_url: link,
          canonical_url: link,
          categories: e.tags || [],
          date_evidence: { verified: false, source: 'feed', feed_published_at: e.published_at || null },
          title: e.title || null,
          author: e.author || null,
          published_at: e.published_at || null,
          updated_at: e.updated_at || null,
          body: {
            value: e.body?.value || '',
            format: e.body?.format || 'html',
            completeness: e.body?.completeness || 'unknown',
          },
          attachments: [],
          fetched_at: observedAt,
          fetch_method: 'web_feed',
          raw_ref: rawRef,
          issues: [...(e.published_at ? [] : ['date_unknown']), ...(e.body?.completeness === 'empty' ? ['body_empty'] : [])],
        });
      }

      const newEtag = httpRes.headers['etag'] || null;
      const newLastModified = httpRes.headers['last-modified'] || null;

      const nextState: Record<string, any> = {
        etag: newEtag,
        last_modified: newLastModified,
        last_polled_at: observedAt,
      };

      items.sort((a, b) => (Date.parse(b.published_at || '') || 0) - (Date.parse(a.published_at || '') || 0) || a.source_item_id.localeCompare(b.source_item_id));
      return this.page(request, items, nextState, observedAt, 1);

    } catch (err: any) {
      return {
        run_id: request.run_id,
        source_id: request.source_id,
        capability_id: this.id,
        status: 'failed',
        items: [],
        next_state: request.state || null,
        scan: 'unknown',
        errors: [
          {
            code: 'network_error',
            message: err.message,
            retryable: true,
          },
        ],
        observed_at: observedAt,
        stats: { requests: 1, items_observed: 0, items_returned: 0 },
      };
    }
  }
  private page(request: CollectionRequest, all: ContentItem[], state: Record<string, any>, observedAt: string, requests: number): CollectionResult {
    const items = all.filter((item) => {
      const published = Date.parse(item.published_at || '');
      if (!Number.isFinite(published)) return true;
      return (!request.scope.since || published >= Date.parse(request.scope.since)) && (!request.scope.until || published <= Date.parse(request.scope.until));
    });
    const offset = Number(state.pending_offset || 0);
    const selected = items.slice(offset, offset + request.scope.limit);
    const next: Record<string, any> = { ...state };
    if (offset + selected.length < items.length) {
      const ref = state.pending_items_ref || path.join(getAppPaths().blobsDir, crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex'));
      if (!fs.existsSync(ref)) fs.writeFileSync(ref, JSON.stringify(items));
      next.pending_items_ref = ref;
      next.pending_offset = offset + selected.length;
    } else {
      delete next.pending_items_ref;
      delete next.pending_offset;
    }
    return {
      run_id: request.run_id, source_id: request.source_id, capability_id: this.id,
      status: 'success', items: selected, next_state: next,
      scan: next.pending_items_ref ? 'more' : 'complete', errors: [], observed_at: observedAt,
      stats: { requests, items_observed: selected.length, items_returned: selected.length },
    };
  }

}
