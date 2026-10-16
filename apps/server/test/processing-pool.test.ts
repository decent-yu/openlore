import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AITaskInput } from '../src/infrastructure/ai/adapter.js';
import * as ai from '../src/infrastructure/ai/fallback_runner.js';
import { getSqliteDatabase, initDatabase } from '../src/infrastructure/persistence/sqlite/db.js';
import { collectionService } from '../src/modules/collection/service.js';
import { groupsService } from '../src/modules/groups/service.js';
import { processingService } from '../src/modules/processing/service.js';
import { skillsService } from '../src/modules/skills/service.js';
import { listPoolCandidates } from '../src/modules/processing/candidates.js';

describe('All unprocessed pool articles participate', () => {
  const previousDataDir=process.env.OPENLORE_DATA_DIR;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'openlore-pool-'));
  const ids:string[]=[];
  const execute=vi.fn(async (input:AITaskInput)=>{
    const index=Number(input.material.match(/Article (\d+)/)?.[1]);
    const score=index>=42?100:80;
    return {status:'success' as const,provider:'test',model:'test',durationMs:0,result:{relevance:score,quality:score,summary:'Summary',reason:'Evidence',evidence_refs:['Agent engineering and evaluation']}};
  });
  beforeAll(async()=>{
    process.env.OPENLORE_DATA_DIR=dir;initDatabase();
    vi.spyOn(ai,'getAIAdapterWithFallback').mockReturnValue({execute,testConnection:async()=>({ok:true,message:'test'})});
    vi.spyOn(skillsService,'getSkill').mockResolvedValue({id:'tech-article-extractor',name:'Review',type:'extraction',description:'',tags:[],file_path:'',system_prompt:'REVIEW_PROMPT_ONLY'});
    for(let i=0;i<50;i++) ids.push(collectionService.persistContentItem({source_item_id:`source:${i}`,source_id:'source',canonical_url:`https://example.com/${i}`,title:`Article ${i}`,
      // Admission is complete. Even old/missing publication metadata cannot re-filter the pool.
      published_at:i%2?'2020-01-01':null,
      body:{value:'Agent engineering and evaluation',format:'text',completeness:'full'},attachments:[],fetched_at:new Date().toISOString(),fetch_method:'test',issues:[]}));
    const db=getSqliteDatabase();
    db.prepare("INSERT INTO group_items(id,group_id,article_id,revision_hash,rules_revision,decision) VALUES ('already','another-group',?,'r','v','selected')").run(ids[48]);
    db.prepare("INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status) VALUES ('deep','another-group',?,'r','succeeded')").run(ids[49]);
    db.prepare("INSERT INTO source_items(id,source_id,article_id) VALUES ('second-link','second-source',?)").run(ids[0]);
    db.transaction(()=>{for(let i=0;i<1000;i++) db.prepare("INSERT INTO collection_candidates(source_id,item_id,article_id,item_json,rule_revision,status,updated_at) VALUES ('source',?,?,'{}','v','history',?)").run(`rejected${i}`,`not-an-article${i}`,new Date().toISOString());})();
  });
  afterAll(()=>{vi.restoreAllMocks();getSqliteDatabase().close();if(previousDataDir===undefined)delete process.env.OPENLORE_DATA_DIR;else process.env.OPENLORE_DATA_DIR=previousDataDir;fs.rmSync(dir,{recursive:true,force:true});});
  it('assesses all 48 remaining articles once before selecting 10, without date/status gates or candidate caps',async()=>{
    const group=await groupsService.saveGroup({id:'group',name:'Agent Engineering',repository_connection_id:'repo',base_path:'docs/agents',max_selected:10,deep_analysis_count:3,source_ids:['source','second-source']});
    const result=await processingService.runProcessingForGroup(group,'full-pool');
    expect(execute).toHaveBeenCalledTimes(48);
    expect(result.counts).toEqual({observed:50,already_processed:2,candidate:48,selected:10,excluded:0,deferred:38});
    expect(new Set(execute.mock.calls.map(([input])=>input.material.match(/Title: Article (\d+)/)?.[1])).size).toBe(48);
    expect(result.entries.some(entry=>entry.article_id===ids[47])).toBe(true);
    expect(group).not.toHaveProperty('lookback_days');
    expect(listPoolCandidates([])).toHaveLength(50);
    expect(listPoolCandidates(['second-source']).map(row=>row.id)).toEqual([ids[0]]);
  });
  it('reports a storage error instead of silently excluding a pool article',async()=>{
    const db=getSqliteDatabase();
    db.prepare("INSERT INTO articles(id,title) VALUES ('broken','Broken article')").run();
    db.prepare("INSERT INTO source_items(id,source_id,article_id) VALUES ('broken-link','broken-source','broken')").run();
    const group=await groupsService.saveGroup({id:'broken-group',name:'Broken',repository_connection_id:'repo',base_path:'docs/broken',source_ids:['broken-source']});
    await expect(processingService.runProcessingForGroup(group,'broken')).rejects.toThrow('缺少正文版本');
  });
  it('preserves a research quota of zero',async()=>{
    const group=await groupsService.saveGroup({id:'zero',name:'Zero',repository_connection_id:'repo',base_path:'docs/zero',deep_analysis_count:0});
    expect(group.deep_analysis_count).toBe(0);
  });
});
