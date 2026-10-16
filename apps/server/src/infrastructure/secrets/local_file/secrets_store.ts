import fs from 'node:fs';
import { getAppPaths } from '../../config/paths.js';

export class LocalSecretsStore {
  private secretsPath: string;

  constructor(secretsPath?: string) {
    this.secretsPath = secretsPath || getAppPaths().secretsPath;
  }

  private readAll(): Record<string, string> {
    if (!fs.existsSync(this.secretsPath)) {
      return {};
    }
    try {
      const content = fs.readFileSync(this.secretsPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private writeAll(data: Record<string, string>): void {
    const json = JSON.stringify(data, null, 2);
    // Write with 0600 permission
    fs.writeFileSync(this.secretsPath, json, { mode: 0o600 });
    try {
      fs.chmodSync(this.secretsPath, 0o600);
    } catch {
      // ignore on non-posix
    }
  }

  getSecret(key: string): string | null {
    const all = this.readAll();
    return all[key] ?? null;
  }

  setSecret(key: string, value: string): void {
    const all = this.readAll();
    all[key] = value;
    this.writeAll(all);
  }

  deleteSecret(key: string): void {
    const all = this.readAll();
    if (key in all) {
      delete all[key];
      this.writeAll(all);
    }
  }
}

export const secretsStore = new LocalSecretsStore();
