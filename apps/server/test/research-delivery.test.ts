import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import { initDatabase, getSqliteDatabase } from '../src/infrastructure/persistence/sqlite/db.js';
import { groupsService } from '../src/modules/groups/service.js';
import { deliveryService } from '../src/modules/delivery/service.js';
import { feedService } from '../src/modules/feed/service.js';
import { researchService } from '../src/modules/research/service.js';
import { GitHubClient } from '../src/infrastructure/repositories/github/client.js';
import { secretsStore } from '../src/infrastructure/secrets/local_file/secrets_store.js';

beforeAll(async () => {
  initDatabase();
  await groupsService.saveGroup({id:'task',name:'Task',repository_connection_id:'repo',base_path:'docs/task'});
  const db=getSqliteDatabase(), now=new Date().toISOString();
  db.prepare("INSERT INTO repository_connections(id,name,revision,owner,repo,default_branch,credential_ref) VALUES ('repo','Repository','v1','example','archive','main','test-token')").run();
  secretsStore.setSecret('test-token','test_token');
  db.prepare("INSERT INTO articles(id,title,latest_revision) VALUES ('article','Selected article','revision')").run();
  db.prepare("INSERT INTO group_items(id,group_id,article_id,revision_hash,rules_revision,decision,is_deep_analyzed,updated_at) VALUES ('item','task','article','revision','v1','selected',1,?)").run(now);
  db.prepare("INSERT INTO collections(id,group_id,date_sequence) VALUES ('collection','task','20261016-01')").run();
  db.prepare("INSERT INTO article_locations(id,group_id,article_id,collection_id,order_seq,slug,directory) VALUES ('location','task','article','collection',1,'article','20261016-01/01-article')").run();
  db.prepare("INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status,report_markdown,created_at,finished_at) VALUES ('research','task','article','revision','succeeded','Generated research',?,?)").run(now,now);
  db.prepare("INSERT INTO runs(id,group_id,snapshot_json,status,stage,started_at,finished_at,output_json) VALUES ('run','task','{}','succeeded','completed',?,?,?)").run(now,now,JSON.stringify({entries:[{article_id:'article',title:'Selected article',summary:'Summary',is_deep_analyzed:true}],commit_url:'https://github.com/example/archive/commit/old'}));
});
afterEach(()=>vi.restoreAllMocks());

it('records a standalone research archive and displays its commit instead of the older batch',async()=>{
  const sync=vi.spyOn(GitHubClient,'syncFiles').mockResolvedValue({status:'updated',commitSha:'new',commitUrl:'https://github.com/example/archive/commit/new',changedPaths:['docs/task/20261016-01/01-article/research.md']});
  const group=(await groupsService.getGroup('task'))!;
  const task=(await researchService.listResearchTasks('task'))[0];
  await deliveryService.deliverResearchReport(group,task);
  const report=sync.mock.calls[0][0].files.find(file=>file.path.endsWith('/research.md'))!;
  expect(Buffer.from(report.content,'base64').toString()).toBe('# Selected article\n\n> 来源：未知  \n> 作者：未知 · 发布时间：未知  \n> 正文：[阅读原文](article.md)\n\nGenerated research');
  expect(Buffer.from(report.content,'base64').toString()).not.toContain('article-zh-CN.md');
  expect(getSqliteDatabase().prepare("SELECT status,commit_sha FROM deliveries WHERE batch_id='research_research'").get()).toEqual({status:'updated',commit_sha:'new'});
  const feed=await feedService.getDailyFeed('task');
  expect(feed.deep_articles[0].delivery?.commit_url).toBe('https://github.com/example/archive/commit/new');
});

it('reports archive failure and preserves the generated report for recovery',async()=>{
  vi.spyOn(GitHubClient,'syncFiles').mockResolvedValue({status:'failed',errorMessage:'Repository rejected archive',changedPaths:[]});
  const task=(await researchService.listResearchTasks('task'))[0];
  vi.spyOn(researchService,'runResearchOnArticle').mockResolvedValue(task);
  await expect(feedService.researchArticle('task','article')).rejects.toThrow('Repository rejected archive');
  expect((await researchService.listResearchTasks('task'))[0].report_markdown).toBe('Generated research');
  expect((await feedService.getDailyFeed('task')).deep_articles[0].delivery).toBeUndefined();
});
