import fs from 'node:fs';
import path from 'node:path';
import type { ContentItem } from '@openlore/contracts';
import { getSqliteDatabase } from '../../infrastructure/persistence/sqlite/db.js';
import { getAppPaths } from '../../infrastructure/config/paths.js';

export const terminalStates = new Set(['history', 'excluded', 'failed']);
export function withoutBody(item: ContentItem): ContentItem {
  return {...item, body:{value:'',format:'text',completeness:'empty'}, attachments:[], raw_ref:null};
}
/** Only unlink exact content-addressed files with no live references. */
export function removeUnusedBlobs(refs: Array<string | null | undefined>): void {
  const db = getSqliteDatabase();
  const root = getAppPaths().blobsDir;
  for (const ref of new Set(refs.filter(Boolean) as string[])) {
    if (path.dirname(ref)!==root || !/^[a-f0-9]{64}$/.test(path.basename(ref))) continue;
    const used = db.prepare(`SELECT 1 FROM article_revisions WHERE content_ref=?
      UNION ALL SELECT 1 FROM source_items WHERE raw_ref=?
      UNION ALL SELECT 1 FROM media_assets WHERE blob_ref=? OR local_path=?
      UNION ALL SELECT 1 FROM collection_candidates WHERE json_extract(item_json,'$.raw_ref')=?
      UNION ALL SELECT 1 FROM source_states WHERE json_extract(state_json,'$.pending_items_ref')=? LIMIT 1`).get(ref,ref,ref,ref,ref,ref);
    if (!used) fs.rmSync(ref,{force:true});
  }
}
/** Keep diagnostic details 30 days, then retain only an identity/hash receipt for deduplication. */
export function expireCollectionDetails(now = new Date()): void {
  const db=getSqliteDatabase();
  const cutoff=new Date(now.getTime()-30*86400000).toISOString();
  const rows=db.prepare("SELECT source_id,item_id,article_id,item_json,discovery_hash,rule_revision,status FROM collection_candidates WHERE status IN ('history','excluded','failed','review') AND updated_at<?").all(cutoff) as any[];
  const refs:string[]=[];
  db.transaction(()=>{
    for(const row of rows) {
      db.prepare('INSERT OR REPLACE INTO collection_receipts(source_id,item_id,discovery_hash,rule_revision) VALUES (?,?,?,?)').run(row.source_id,row.item_id,row.discovery_hash,row.rule_revision);
      const item=JSON.parse(row.item_json);if(item.raw_ref)refs.push(item.raw_ref);
      db.prepare('DELETE FROM collection_candidates WHERE source_id=? AND item_id=?').run(row.source_id,row.item_id);
    }
    db.prepare('DELETE FROM collection_runs WHERE created_at<?').run(cutoff);
  })();
  removeUnusedBlobs(refs);
}
