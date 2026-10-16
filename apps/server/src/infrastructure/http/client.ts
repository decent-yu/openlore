import dns from 'node:dns/promises';
import { URL } from 'node:url';

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  data: Buffer;
  text: string;
  url: string;
  notModified: boolean;
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export function isPrivateIp(ip: string): boolean {
  // IPv4 checks
  if (
    ip === '127.0.0.1' ||
    ip === 'localhost' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('169.254.')
  ) {
    return true;
  }
  if (ip.startsWith('172.')) {
    const parts = ip.split('.');
    const second = parseInt(parts[1], 10);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }
  return false;
}

export class SafeHttpClient {
  static async checkUrlSafety(targetUrl: string): Promise<string> {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    const hostname = parsed.hostname;
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0'
    ) {
      throw new Error(`Private/local hostnames are blocked: ${hostname}`);
    }

    try {
      const lookup = await dns.lookup(hostname, { all: true });
      for (const entry of lookup) {
        if (isPrivateIp(entry.address)) {
          throw new Error(
            `Destination resolves to private IP ${entry.address}, blocked`,
          );
        }
      }
    } catch (err: any) {
      if (err.message && err.message.includes('blocked')) {
        throw err;
      }
      // DNS error or other
    }

    return targetUrl;
  }

  static async fetch(
    targetUrl: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse> {
    const {
      headers = {},
      etag,
      lastModified,
      timeoutMs = 30000,
      maxBytes = 10 * 1024 * 1024,
      maxRedirects = 5,
    } = options;

    let currentUrl = targetUrl;
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      await this.checkUrlSafety(currentUrl);

      const reqHeaders: Record<string, string> = {
        'User-Agent':
          'OpenLore/0.1 (+https://github.com/decent/openlore; knowledge-collector)',
        ...headers,
      };

      if (etag) {
        reqHeaders['If-None-Match'] = etag;
      }
      if (lastModified) {
        reqHeaders['If-Modified-Since'] = lastModified;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(currentUrl, {
          method: 'GET',
          headers: reqHeaders,
          signal: controller.signal,
          redirect: 'manual',
        });
        if (response.status === 304) {
          clearTimeout(timer);
          return {
            status: 304,
            headers: Object.fromEntries(response.headers.entries()),
            data: Buffer.alloc(0),
            text: '',
            url: currentUrl,
            notModified: true,
          };
        }

        if (
          [301, 302, 303, 307, 308].includes(response.status) &&
          response.headers.get('location')
        ) {
          clearTimeout(timer);
          const loc = response.headers.get('location')!;
          currentUrl = new URL(loc, currentUrl).toString();
          redirectCount++;
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        clearTimeout(timer);
        if (arrayBuffer.byteLength > maxBytes) {
          throw new Error(
            `Response exceeded maxBytes limit of ${maxBytes} (got ${arrayBuffer.byteLength})`,
          );
        }

        const buf = Buffer.from(arrayBuffer);
        const text = buf.toString('utf-8');

        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          data: buf,
          text,
          url: currentUrl,
          notModified: false,
        };
      } catch (err: any) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw err;
      }
    }

    throw new Error(`Too many redirects (exceeded ${maxRedirects})`);
  }
}
