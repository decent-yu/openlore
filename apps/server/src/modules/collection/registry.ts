import type { CollectionRequest, CollectionResult } from '@openlore/contracts';

export interface CollectorAdapter {
  id: string;
  supportedOperations: Array<'discover' | 'fetch'>;
  collect(request: CollectionRequest): Promise<CollectionResult>;
}

export class CollectorRegistry {
  private adapters = new Map<string, CollectorAdapter>();

  register(adapter: CollectorAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Collector capability '${adapter.id}' already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(capabilityId: string): CollectorAdapter | undefined {
    return this.adapters.get(capabilityId);
  }

  listCapabilities(): string[] {
    return Array.from(this.adapters.keys());
  }
}

export const collectorRegistry = new CollectorRegistry();
