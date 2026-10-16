#!/usr/bin/env node

import { runWorker, executeOnce, writeWorkerConfiguration } from '../modules/executors/worker.js';

async function serve() {
  const {initDatabase,getSqliteDatabase}=await import('../infrastructure/persistence/sqlite/db.js');
  const {createServer}=await import('../http/server.js');
  const {jobsQueue}=await import('../modules/jobs/queue.js');
  const {appScheduler}=await import('../modules/scheduler/scheduler.js');
  const {sourcesService}=await import('../modules/sources/service.js');
  console.log('Initializing OpenLore...');
  initDatabase();
  await sourcesService.seedDefaultSources();
  const db = getSqliteDatabase();
  // A server restart invalidates in-flight leases. Retrying starts a new run from its saved inputs.
  db.transaction(() => {
    const interrupted = db.prepare("SELECT id,group_id,output_json FROM runs WHERE status='running'").all() as Array<{id:string;group_id:string;output_json:string}>;
    for (const run of interrupted) {
      const output = JSON.parse(run.output_json || '{}');
      for (const entry of output.entries || []) db.prepare("DELETE FROM group_items WHERE group_id=? AND article_id=? AND decision='selected'").run(run.group_id,entry.article_id);
    }
    db.prepare("UPDATE runs SET status='failed',error_message='服务重启导致任务中断，请重新运行',finished_at=? WHERE status='running'").run(new Date().toISOString());
    db.prepare("UPDATE ai_jobs SET status='cancelled',lease_token=NULL WHERE status IN ('queued','running')").run();
  })();
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.OPENLORE_ADMIN_TOKEN) throw new Error('服务器对外监听前请配置 OPENLORE_ADMIN_TOKEN');
  const server = await createServer();
  const port = parseInt(process.env.PORT || '8767', 10);

  jobsQueue.startHeartbeat(15000);
  appScheduler.start(30000);

  const address = await server.listen({ host, port });
  console.log(`OpenLore server listening at ${address}`);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    jobsQueue.stopHeartbeat();
    appScheduler.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function doctor() {
  const {initDatabase}=await import('../infrastructure/persistence/sqlite/db.js');
  const {settingsService}=await import('../modules/settings/service.js');
  console.log('Running OpenLore Doctor diagnostics...\n');
  initDatabase();
  const result = await settingsService.runDoctor();

  for (const check of result.checks) {
    const symbol =
      check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗';
    console.log(`[${symbol}] ${check.name}: ${check.message}`);
  }

  console.log(`\nDiagnostic summary: ${result.ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS REQUIRE ATTENTION'}`);
  process.exit(result.ok ? 0 : 1);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'serve';

  switch (command) {
    case 'worker':
      if (!args[1]) throw new Error('用法：openlore worker <config.json>');
      await runWorker(args[1]);
      break;
    case 'worker-init':
      if (!args[1] || !args[2] || !args[3]) throw new Error('用法：openlore worker-init <config.json> <server-url> <profile-id>');
      await writeWorkerConfiguration(args[1], args[2], args[3]);
      break;
    case 'execute-once':
      await executeOnce();
      break;
    case 'serve':
      await serve();
      break;
    case 'doctor':
      await doctor();
      break;
    case 'service':
      console.log('Service command placeholder. For macOS/Linux launchd/systemd.');
      break;
    default:
      console.log(`Unknown command: ${command}. Available commands: serve, doctor, service`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
