import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getAppPaths } from '../config/paths.js';
import { SafeHttpClient } from '../http/client.js';

export interface ArchivedAsset {
  assetId: string;
  originalUrl: string;
  relativePath: string; // e.g. "assets/diagram-60396a85deb4.svg"
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  blobRef: string;
  status: 'downloaded' | 'failed' | 'pending';
}

export class MediaAssetsArchiver {
  private blobsDir: string;

  constructor(blobsDir?: string) {
    this.blobsDir = blobsDir || getAppPaths().blobsDir;
  }

  cleanSvg(content: string): string {
    // Basic SVG sanitization: remove <script>, onclick, onload, javascript: hrefs
    let sanitized = content.replace(
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      '',
    );
    sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');
    return sanitized;
  }

  getMimeExtension(mimeType: string, urlPath: string): string {
    const extMatch = urlPath.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
    if (extMatch) {
      const ext = extMatch[1].toLowerCase();
      if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
      }
    }
    if (mimeType.includes('svg')) return 'svg';
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('gif')) return 'gif';
    return 'jpg';
  }

  archiveSvgContent(
    svgString: string,
    filename: string = 'architecture-topology.svg',
  ): ArchivedAsset {
    const assetId = crypto.randomUUID();
    const cleaned = this.cleanSvg(svgString);
    const buf = Buffer.from(cleaned, 'utf-8');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const blobRef = path.join(this.blobsDir, sha256);

    if (!fs.existsSync(this.blobsDir)) {
      fs.mkdirSync(this.blobsDir, { recursive: true });
    }
    if (!fs.existsSync(blobRef)) {
      fs.writeFileSync(blobRef, buf);
    }

    return {
      assetId,
      originalUrl: `generated://${filename}`,
      relativePath: `assets/${filename}`,
      sha256,
      mimeType: 'image/svg+xml',
      sizeBytes: buf.length,
      blobRef,
      status: 'downloaded',
    };
  }

  async archiveImage(
    imageUrl: string,
    semanticName: string = 'image',
  ): Promise<ArchivedAsset> {
    const assetId = crypto.randomUUID();

    try {
      if (imageUrl.startsWith('data:')) {
        // Data URI
        const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
          throw new Error('Invalid data URI format');
        }
        const mimeType = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        const hash12 = sha256.substring(0, 12);
        const ext = this.getMimeExtension(mimeType, '');
        const filename = `${semanticName}-${hash12}.${ext}`;
        const blobRef = path.join(this.blobsDir, sha256);

        if (!fs.existsSync(blobRef)) {
          fs.writeFileSync(blobRef, buffer);
        }

        return {
          assetId,
          originalUrl: imageUrl.substring(0, 60) + '...',
          relativePath: `assets/${filename}`,
          sha256,
          mimeType,
          sizeBytes: buffer.length,
          blobRef,
          status: 'downloaded',
        };
      }

      // HTTP(S) image
      const res = await SafeHttpClient.fetch(imageUrl, {
        timeoutMs: 15000,
        maxBytes: 20 * 1024 * 1024, // 20 MiB per image
      });

      let buf = res.data;
      const mime = res.headers['content-type'] || 'image/jpeg';
      const isSvg = mime.includes('svg') || imageUrl.endsWith('.svg');

      if (isSvg) {
        const cleaned = this.cleanSvg(buf.toString('utf-8'));
        buf = Buffer.from(cleaned, 'utf-8');
      }

      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const hash12 = sha256.substring(0, 12);
      const ext = this.getMimeExtension(mime, imageUrl);
      const filename = `${semanticName}-${hash12}.${ext}`;
      const blobRef = path.join(this.blobsDir, sha256);

      if (!fs.existsSync(blobRef)) {
        fs.writeFileSync(blobRef, buf);
      }

      return {
        assetId,
        originalUrl: imageUrl,
        relativePath: `assets/${filename}`,
        sha256,
        mimeType: mime,
        sizeBytes: buf.length,
        blobRef,
        status: 'downloaded',
      };
    } catch (err: any) {
      return {
        assetId,
        originalUrl: imageUrl,
        relativePath: '',
        sha256: '',
        mimeType: '',
        sizeBytes: 0,
        blobRef: '',
        status: 'failed',
      };
    }
  }

  rewriteMarkdownImageUrls(
    markdown: string,
    urlMap: Map<string, string>,
  ): string {
    let result = markdown;
    for (const [origUrl, localPath] of urlMap.entries()) {
      // Escape for regex
      const escaped = origUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), localPath);
    }
    return result;
  }
}

export const mediaAssetsArchiver = new MediaAssetsArchiver();
