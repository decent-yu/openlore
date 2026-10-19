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
it('keeps the newest successful summary and its own archive link',async()=>{
 const db=getSqliteDatabase();
 db.prepare("UPDATE runs SET status='succeeded',stage='completed',finished_at='2026-10-15T18:00:00Z' WHERE id='run'").run();
 db.prepare("INSERT INTO runs(id,group_id,snapshot_json,status,stage,started_at,finished_at,output_json) VALUES ('newer','task','{}','succeeded','completed','2026-10-15T18:01:00Z','2026-10-15T18:02:00Z',?)").run(JSON.stringify({entries:[{article_id:'article',title:'Selected article',summary:'Newest summary',is_deep_analyzed:false}],commit_url:'https://github.com/example/archive/commit/newer'}));
 const feed=await feedService.getDailyFeed('task');
 expect(feed.candidate_articles[0].summary).toBe('Newest summary');
 expect(feed.candidate_articles[0].delivery?.commit_url).toBe('https://github.com/example/archive/commit/newer');
});
it('keeps the original archive date after an article is updated on a later day',async()=>{
 vi.setSystemTime(new Date('2026-10-16T18:00:00Z'));
 getSqliteDatabase().prepare("UPDATE group_items SET updated_at='2026-10-16T18:00:00Z' WHERE id='selected'").run();
 expect((await feedService.getDailyFeed('task')).available_dates).toContain('2026-10-16');
});
it('keeps all successful batches from the same day visible beyond the per-run selection limit',async()=>{
 vi.setSystemTime(new Date('2026-10-15T19:00:00Z'));
 const db=getSqliteDatabase();
 db.prepare("UPDATE groups SET max_selected=1 WHERE id='task'").run();
 db.prepare("INSERT INTO articles(id,title) VALUES ('another','Another selected article')").run();
 db.prepare("INSERT INTO source_items(id,source_id,article_id) VALUES ('another-source','source','another')").run();
 db.prepare("INSERT INTO group_items(id,group_id,article_id,revision_hash,rules_revision,decision,updated_at) VALUES ('another-item','task','another','rev','v1','selected','2026-10-15T18:03:00Z')").run();
 db.prepare("INSERT INTO runs(id,group_id,snapshot_json,status,stage,started_at,finished_at,output_json) VALUES ('additional','task','{}','succeeded','completed','2026-10-15T18:03:00Z','2026-10-15T18:04:00Z',?)").run(JSON.stringify({entries:[{article_id:'another',title:'Another selected article',summary:'New batch summary',is_deep_analyzed:false}]}));
 const feed=await feedService.getDailyFeed('task');
 expect(feed.stats.total_selected_count).toBe(2);
 expect(feed.candidate_articles).toHaveLength(2);
});
it('counts all finished reports even when only one is placed in the leading section',async()=>{
 const db=getSqliteDatabase();
 db.prepare("UPDATE groups SET deep_analysis_count=1 WHERE id='task'").run();
 db.prepare("UPDATE group_items SET is_deep_analyzed=1 WHERE group_id='task'").run();
 for(const article of ['article','another']) db.prepare("INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status,report_markdown) VALUES (?,'task',?,'rev','succeeded','Completed report')").run(`report-${article}`,article);
 const feed=await feedService.getDailyFeed('task');
 expect(feed.deep_articles).toHaveLength(1);
 expect(feed.stats.deep_analyzed_count).toBe(2);
});
