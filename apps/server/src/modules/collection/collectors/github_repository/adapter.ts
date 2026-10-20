import type { CollectionRequest, CollectionResult } from '@openlore/contracts';
import { refreshRepository } from '../../../repository-study/service.js';
import type { CollectorAdapter } from '../../registry.js';

/** Source polling refreshes the local repository; only a pipeline allocates research. */
export class GithubRepositoryCollectorAdapter implements CollectorAdapter {
  id = 'github_repository';
  supportedOperations: Array<'discover' | 'fetch'> = ['discover'];
  async collect(request: CollectionRequest): Promise<CollectionResult> {
    const result: CollectionResult = {
      run_id: request.run_id, source_id: request.source_id, capability_id: this.id,
      status: 'success', items: [], next_state: request.state, scan: 'complete', errors: [],
      observed_at: new Date().toISOString(), stats: { requests: 0, items_observed: 0, items_returned: 0 },
    };
    try {
      const snapshot = await refreshRepository({ url: request.target.url });
      result.next_state = { commit: snapshot.commit, branch: snapshot.branch, files: snapshot.files.length };
    } catch (error: any) {
      result.status = 'failed';
      result.errors = [{ code: 'github_repository_failed', message: error.message, retryable: true }];
    }
    return result;
  }
}
