import { execFile } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { initDatabase, getSqliteDatabase } from '../src/infrastructure/persistence/sqlite/db.js';

it('does not interrupt existing work when another server already owns the port', async () => {
  initDatabase();
  const db = getSqliteDatabase();
  db.prepare("INSERT INTO sources(id,name,url,enabled) VALUES ('disabled','Disabled','https://example.com/feed',0)").run();
  db.prepare("INSERT INTO runs(id,group_id,snapshot_json,status,stage,started_at) VALUES ('active','task','{}','running','research',?)").run(new Date().toISOString());
  db.prepare("INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status) VALUES ('research','task','article','rev','running')").run();
  db.prepare("INSERT INTO research_claims(article_id,group_id,owner_id,created_at) VALUES ('article','task','active',?)").run(new Date().toISOString());
  const occupied = net.createServer();
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  try {
    const port = (occupied.address() as net.AddressInfo).port;
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', path.resolve('src/cli/index.ts'), 'serve'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), LOG_LEVEL: 'silent' },
      timeout: 10000,
    }).catch(error => error);
    expect(result.stderr).toContain('EADDRINUSE');
    expect(db.prepare("SELECT status,error_message FROM runs WHERE id='active'").get()).toEqual({status: 'running', error_message: null});
    expect(db.prepare("SELECT status,error_message FROM research_tasks WHERE id='research'").get()).toEqual({status: 'running', error_message: null});
    expect(db.prepare("SELECT owner_id FROM research_claims WHERE article_id='article'").get()).toEqual({owner_id: 'active'});
  } finally {
    await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()));
  }
});
