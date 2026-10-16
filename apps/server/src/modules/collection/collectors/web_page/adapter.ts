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

export class WebPageCollectorAdapter implements CollectorAdapter {
  id = 'web_page';
  supportedOperations: Array<'discover' | 'fetch'> = ['discover', 'fetch'];

  async collect(request: CollectionRequest): Promise<CollectionResult> {
    const observedAt = new Date().toISOString();
    const targetUrl = request.target.url;

    try {
      const httpRes = await SafeHttpClient.fetch(targetUrl, {
        timeoutMs: (request.budget?.timeout_seconds || 30) * 1000,
      });

      if (httpRes.status < 200 || httpRes.status >= 300) throw new Error(`HTTP ${httpRes.status}`);
      const paths = getAppPaths();
      const sha256 = crypto
        .createHash('sha256')
        .update(httpRes.data)
        .digest('hex');
      const rawRef = path.join(paths.blobsDir, sha256);
      if (!fs.existsSync(rawRef)) {
        fs.writeFileSync(rawRef, httpRes.data);
      }

      const jobDir = path.join(paths.jobsDir, request.run_id);
      if (!fs.existsSync(jobDir)) {
        fs.mkdirSync(jobDir, { recursive: true });
      }
      const inputPath = path.join(jobDir, `page_${Date.now()}.html`);
      fs.writeFileSync(inputPath, httpRes.data);

      const pyRes = await pythonWorkerRunner.run({
        protocol_version: 1,
        job_id: request.run_id,
        operation: 'extract_article',
        input_path: inputPath,
        original_url: targetUrl,
        final_url: httpRes.url,
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
              code: pyRes.error?.code || 'extract_error',
              message: pyRes.error?.message || 'Failed to extract article HTML',
              retryable: pyRes.error?.retryable ?? true,
            },
          ],
          observed_at: observedAt,
          stats: { requests: 1, items_observed: 0, items_returned: 0 },
        };
      }

      const pageData = pyRes.data as {
        canonical_url?: string;
        categories?: string[];
        date_evidence?: Record<string, unknown>;
        updated_at?: string;
        title?: string;
        author?: string;
        published_at?: string;
        text: string;
        format: string;
        completeness: string;
        images?: Array<{ src: string; alt?: string; title?: string }>;
      };

      const sourceItemId =
        request.target.source_item_id ||
        `${request.source_id}:${crypto.randomUUID()}`;

      const attachments = (pageData.images || []).map((img) => ({
        url: img.src,
        kind: 'image',
        fetched: false,
      }));

      const item: ContentItem = {
        source_item_id: sourceItemId,
        source_id: request.source_id,
        native_id: null,
        original_url: targetUrl,
        final_url: httpRes.url,
        canonical_url: pageData.canonical_url || httpRes.url,
        categories: pageData.categories || [],
        date_evidence: pageData.date_evidence,
        title: pageData.title || null,
        author: pageData.author || null,
        published_at: pageData.published_at || null,
        updated_at: pageData.updated_at || null,
        body: {
          value: pageData.text,
          format: 'markdown',
          completeness: (pageData.completeness as any) || 'full',
        },
        attachments,
        fetched_at: observedAt,
        fetch_method: 'web_page',
        raw_ref: rawRef,
        issues: [...(pyRes.issues || []), ...(pageData.completeness === 'full' ? [] : ['possibly_truncated'])],
      };

      return {
        run_id: request.run_id,
        source_id: request.source_id,
        capability_id: this.id,
        status: 'success',
        items: [item],
        next_state: request.state || null,
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
        next_state: request.state || null,
        scan: 'unknown',
        errors: [
          {
            code: 'fetch_failed',
            message: err.message,
            retryable: !/HTTP (400|401|403|404|410)/.test(err.message || ''),
          },
        ],
        observed_at: observedAt,
        stats: { requests: 1, items_observed: 0, items_returned: 0 },
      };
    }
  }
}
