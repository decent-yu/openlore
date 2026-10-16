import fs from 'node:fs';
import path from 'node:path';
import {beforeAll,describe,expect,it,vi} from 'vitest';
import {initDatabase,getSqliteDatabase} from '../src/infrastructure/persistence/sqlite/db.js';
import {getAppPaths} from '../src/infrastructure/config/paths.js';
import {collectionService} from '../src/modules/collection/service.js';
import {sourcesService} from '../src/modules/sources/service.js';
import {collectorRegistry} from '../src/modules/collection/registry.js';
import {expireCollectionDetails} from '../src/modules/collection/retention.js';
import type {ContentItem} from '@openlore/contracts';

const body='A reproducible agent architecture with detailed execution traces, retries, sandbox isolation, and benchmark results.';
const item=(id:string):ContentItem=>({source_id:'pool-source',source_item_id:id,canonical_url:`https://example.com/${id}`,title:`Agent ${id}`,published_at:new Date().toISOString(),date_evidence:{verified:true},body:{value:body,format:'text',completeness:'full'},attachments:[],fetched_at:new Date().toISOString(),fetch_method:'web_page',issues:[]});

describe('Pool contains admitted articles only',()=>{
 beforeAll(()=>initDatabase());
 it('expires diagnostic details without touching admitted articles or their shared blobs',async()=>{
  const db=getSqliteDatabase();
  const id=collectionService.persistContentItem(item('admitted'));
  const ref=(db.prepare('SELECT content_ref FROM article_revisions WHERE article_id=?').get(id) as any).content_ref;
  const rejected={...item('expired'),raw_ref:ref,body:{value:'',format:'text',completeness:'empty'}};
  db.prepare("INSERT INTO collection_candidates(source_id,item_id,article_id,item_json,rule_revision,discovery_hash,status,reason,updated_at) VALUES ('pool-source','expired',?,?,'v','h','history','outside_window','2000-01-01T00:00:00Z')").run(id,JSON.stringify(rejected));
  expireCollectionDetails();
  expect(db.prepare("SELECT 1 FROM collection_candidates WHERE item_id='expired'").get()).toBeUndefined();
  expect(db.prepare("SELECT discovery_hash FROM collection_receipts WHERE item_id='expired'").get()).toEqual({discovery_hash:'h'});
  expect(db.prepare('SELECT 1 FROM articles WHERE id=?').get(id)).toBeDefined();
  expect(fs.existsSync(ref)).toBe(true);
 });
 it('pending and permanent failure never create pool articles or content revisions',async()=>{
  await sourcesService.saveSource({id:'fetch-source',name:'Fetch',url:'https://example.com/rss'});
  const pending={...item('waiting'),source_id:'fetch-source',date_evidence:{verified:false},fetch_method:'web_feed',body:{value:'Agent summary',format:'text' as const,completeness:'summary' as const}};
  const db=getSqliteDatabase();
  const before=(db.prepare('SELECT count(*) n FROM articles').get() as any).n;
  let calls=0;
  vi.spyOn(collectorRegistry,'get').mockImplementation(id=>({id,supportedOperations:['discover','fetch'],collect:async request=>{
   if(id==='web_page') {
    expect(db.prepare("SELECT 1 FROM articles WHERE canonical_url='https://example.com/waiting'").get()).toBeUndefined();
    return {run_id:request.run_id,source_id:'fetch-source',capability_id:id,status:'failed',items:[],errors:[{code:'http',message:'HTTP 403',retryable:false}],scan:'complete',observed_at:new Date().toISOString(),stats:{requests:1,items_observed:0,items_returned:0}};
   }
   calls++;
   return {run_id:request.run_id,source_id:'fetch-source',capability_id:id,status:'success',items:[pending],errors:[],scan:'complete',observed_at:new Date().toISOString(),stats:{requests:1,items_observed:1,items_returned:1}};
  }} as any));
  await collectionService.discoverSource('fetch-source');
  const failed=db.prepare("SELECT * FROM collection_candidates WHERE source_id='fetch-source'").get() as any;
  expect(failed.status).toBe('failed');expect(JSON.parse(failed.item_json).body.value).toBe('');
  expect(db.prepare('SELECT count(*) n FROM articles').get()).toEqual({n:before});
  const second=await collectionService.discoverSource('fetch-source');
  expect(second.stats.requests).toBe(1);expect(second.stats.items_new).toBe(0);
  expect(calls).toBe(2);vi.restoreAllMocks();
 });
});
