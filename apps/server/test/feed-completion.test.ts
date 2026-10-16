import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {initDatabase,getSqliteDatabase} from '../src/infrastructure/persistence/sqlite/db.js';
import {groupsService} from '../src/modules/groups/service.js';
import {feedService} from '../src/modules/feed/service.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'openlore-feed-'));
beforeAll(async()=>{
 process.env.OPENLORE_DATA_DIR=directory;initDatabase();
 await groupsService.saveGroup({id:'task',name:'Task',repository_connection_id:'repo',base_path:'docs/task',source_ids:['source']});
 const db=getSqliteDatabase();
 db.prepare("INSERT INTO articles(id,title,created_at,published_at) VALUES ('article','Selected article','2026-10-15T17:00:00Z','2026-10-15T17:00:00Z')").run();
 db.prepare("INSERT INTO source_items(id,source_id,article_id) VALUES ('source-article','source','article')").run();
 db.prepare("INSERT INTO group_items(id,group_id,article_id,revision_hash,rules_revision,decision,updated_at) VALUES ('selected','task','article','rev','v1','selected','2026-10-15T17:00:00Z')").run();
 db.prepare("INSERT INTO runs(id,group_id,snapshot_json,status,stage,started_at,output_json) VALUES ('run','task','{}','running','research','2026-10-15T17:00:00Z',?)").run(JSON.stringify({entries:[{article_id:'article',title:'Selected article',summary:'Actual assessment summary',is_deep_analyzed:false}]}));
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-15T18:00:00Z'));
});
afterAll(()=>{vi.useRealTimers();getSqliteDatabase().close();fs.rmSync(directory,{recursive:true,force:true});});
it('shows in-progress work but publishes only completed results using workspace dates',async()=>{
 const working=await feedService.getDailyFeed('task');
 expect(working.date).toBe('2026-10-16');expect(working.current_run?.stage).toBe('research');
 expect(working.candidate_articles).toHaveLength(0);
 getSqliteDatabase().prepare("UPDATE runs SET status='succeeded',stage='completed',finished_at='2026-10-15T18:00:00Z' WHERE id='run'").run();
 const finished=await feedService.getDailyFeed('task');
 expect(finished.has_run_today).toBe(true);expect(finished.stats.total_selected_count).toBe(1);
 expect(finished.candidate_articles[0].summary).toBe('Actual assessment summary');
 expect((await feedService.getDailyFeed('task','2026-10-15')).stats.total_selected_count).toBe(0);
});
