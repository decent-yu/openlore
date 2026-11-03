import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';

afterEach(() => vi.unstubAllGlobals());
describe('API request bodies', () => {
  it('does not label empty action requests as JSON', async () => {
    const fetch = vi.fn().mockResolvedValue({ok:true,json:async()=>({})});
    vi.stubGlobal('fetch',fetch);
    await api.triggerGroupRun('task');
    await api.pollAllSources();
    await api.retryRunDelivery('failed-run');
    for (const [, options] of fetch.mock.calls) {
      expect(options.method).toBe('POST');
      expect(options.body).toBeUndefined();
      expect(new Headers(options.headers).has('content-type')).toBe(false);
    }
  });
  it('explicitly allows repeated manual report sends', async () => {
    const fetch = vi.fn().mockResolvedValue({ok:true,json:async()=>({})});
    vi.stubGlobal('fetch',fetch);
    await api.sendReport('report');
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/reports/report/send');
    expect(options.method).toBe('POST');
    expect(new Headers(options.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({force:true});
  });
  it('labels requests with a JSON body correctly', async () => {
    const fetch = vi.fn().mockResolvedValue({ok:true,json:async()=>({})});
    vi.stubGlobal('fetch',fetch);
    await api.toggleGroup('task',true);
    const options=fetch.mock.calls[0][1];
    expect(new Headers(options.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({enabled:true});
  });
});
