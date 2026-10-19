// Explicit opt-in: runs real local AI against existing article fixtures in an isolated database.
// GitHub and webhook delivery are mocked. The application's real data is never modified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
if(!process.env.OPENLORE_REAL_AI_PROFILE||!process.env.OPENLORE_REAL_AI_ARTICLES)throw new Error('Provide OPENLORE_REAL_AI_PROFILE and OPENLORE_REAL_AI_ARTICLES fixture files');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'openlore-real-worker-'));
process.env.OPENLORE_DATA_DIR=path.join(root,'data');process.env.LOG_LEVEL='silent';
const {initDatabase,getSqliteDatabase}=await import('../dist/infrastructure/persistence/sqlite/db.js');
const {settingsService}=await import('../dist/modules/settings/service.js');
const {groupsService}=await import('../dist/modules/groups/service.js');
const {collectionService}=await import('../dist/modules/collection/service.js');
const {executorService}=await import('../dist/modules/executors/service.js');
const {createServer}=await import('../dist/http/server.js');
const {appScheduler}=await import('../dist/modules/scheduler/scheduler.js');
const {GitHubClient}=await import('../dist/infrastructure/repositories/github/client.js');
const {GenericWebhookSender}=await import('../dist/infrastructure/notifications/generic_webhook/sender.js');
const {secretsStore}=await import('../dist/infrastructure/secrets/local_file/secrets_store.js');
const {reportService}=await import('../dist/modules/reports/service.js');
const profile=JSON.parse(fs.readFileSync(process.env.OPENLORE_REAL_AI_PROFILE,'utf8'));
initDatabase();
const db=getSqliteDatabase();
await settingsService.saveAIProfile({id:'real-gemini',name:'Real Gemini Worker',provider:'gemini_cli',cliPath:profile.cli_path,is_primary:true,execution:{transport:'worker',workspace_root:path.join(root,'workspace'),timeout_seconds:300,queue_timeout_seconds:120,concurrency:1}});
const pair=executorService.pair('real-gemini');
db.prepare("INSERT INTO repository_connections(id,name,revision,owner,repo,default_branch,credential_ref,state) VALUES ('repo','Test','v1','test','knowledge','main','test-token','ready')").run();
db.prepare("INSERT INTO notification_connections(id,name,revision,url_secret_ref,state) VALUES ('channel','Test group','v1','test-webhook','ready')").run();
secretsStore.getSecret=(key)=>key==='test-webhook'?'https://example.invalid/webhook':'test-token';
GitHubClient.syncFiles=async(options)=>{fs.writeFileSync(path.join(root,'archive-files.json'),JSON.stringify(options.files,null,2));return {status:'updated',commitSha:'test-commit',commitUrl:'https://github.com/test/knowledge/commit/test',changedPaths:options.files.map((file)=>file.path)};};
GenericWebhookSender.send=async(url,payload)=>{fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(payload,null,2));return {status:'sent',platform_response:'mock-delivery'};};
const fixtures=JSON.parse(fs.readFileSync(process.env.OPENLORE_REAL_AI_ARTICLES,'utf8'));
const chosen=fixtures.filter((article)=>/Context Engineering with Deep|Building Long-Running|evidence-grounded|Revamping Skills/.test(article.title)).slice(0,4);
if(chosen.length<3)throw new Error('At least three real article fixtures required');
for(const [index,article]of chosen.entries()){
 const id=await collectionService.persistContentItem({source_item_id:`fixture-${index}`,source_id:'fixture',canonical_url:article.canonical_url,title:article.title,published_at:article.published_at,body:{value:article.content,format:'html',completeness:'full'},attachments:[],fetched_at:new Date().toISOString(),fetch_method:'fixture',issues:[]});
}
await groupsService.saveGroup({id:'test-task',name:'Agent 工程实践',description:'Agent 上下文管理、记忆、工具调用、评估与可靠性',preferences:'优先有技术机制和实现证据的工程实践，排除没有实现内容的营销。',source_ids:['fixture'],deep_analysis_count:3,assessment_skill_id:'tech-article-extractor',research_skill_id:'deep-research-expert',research_instructions:'生成一篇约1000至1500字的独立中文工程文章，说明机制、适用边界和实践建议。只使用提供的原文证据，保留原文链接，不需要配图。',repository_connection_id:'repo',base_path:'docs/agent',ai_profile_id:'real-gemini'});
const app=await createServer();const address=await app.listen({host:'127.0.0.1',port:0});
const file=path.join(root,'worker.json');fs.writeFileSync(file,JSON.stringify({server_url:address,profile_id:'real-gemini',token:pair.token,name:'Real Gemini Test'}),{mode:0o600});
const child=spawn(process.execPath,[path.resolve('apps/server/dist/cli/index.js'),'worker',file],{env:{...process.env,OPENLORE_ADMIN_TOKEN:''},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',(data)=>process.stdout.write(data));child.stderr.on('data',(data)=>process.stderr.write(data));
console.log('ARTIFACT_ROOT='+root);
fs.writeFileSync('/tmp/openlore-real-worker-root.txt',root);
appScheduler.addSseListener((event)=>console.log(JSON.stringify(event)));
try{
 const run=await appScheduler.triggerGroupRun('test-task');
 const deadline=Date.now()+25*60*1000;let result;
 while(Date.now()<deadline){result=await appScheduler.getRun(run.id);if(result.status!=='running')break;await new Promise((resolve)=>setTimeout(resolve,2000));}
 fs.writeFileSync(path.join(root,'run.json'),JSON.stringify(result,null,2));
 if(result.status!=='succeeded')throw new Error(result.error_message||'Pipeline timed out');
 console.log('PIPELINE_COUNTS='+JSON.stringify(result.counts));
 const research=db.prepare('SELECT article_id,status,report_markdown,error_message FROM research_tasks').all();
 for(const [index,task]of research.entries())fs.writeFileSync(path.join(root,`research-${index+1}.md`),task.report_markdown);
 console.log('RESEARCH_RESULTS='+JSON.stringify(research.map((task)=>({status:task.status,length:task.report_markdown.length}))));
 if(!research.length)throw new Error('No research articles produced');
 await reportService.savePlan({id:'report-test',name:'Agent 工程测试汇报',pipeline_ids:['test-task'],notification_connection_id:'channel',enabled:false});
 const sent=await reportService.send('report-test');console.log('REPORT='+JSON.stringify(sent));
 if(!sent.ok)throw new Error(sent.message);
 const archived=JSON.parse(fs.readFileSync(path.join(root,'archive-files.json'),'utf8'));
 console.log('ARCHIVED_RESEARCH_FILES='+archived.filter((file)=>file.path.endsWith('/research.md')).length);
}finally{child.kill('SIGTERM');await new Promise((resolve)=>child.on('close',resolve));await app.close();db.close();}
