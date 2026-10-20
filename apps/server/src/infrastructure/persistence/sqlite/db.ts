import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { getAppPaths } from '../../config/paths.js';
import * as schema from './schema.js';

let sqliteDbInstance: Database.Database | null = null;
let drizzleDbInstance: ReturnType<typeof drizzle> | null = null;

export function getSqliteDatabase(dbPath?: string): Database.Database {
  if (sqliteDbInstance && !dbPath) {
    return sqliteDbInstance;
  }
  const resolvedPath = dbPath || getAppPaths().dbPath;
  const db = new Database(resolvedPath);

  // WAL, foreign keys, busy_timeout 5000ms
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  if (!dbPath) {
    sqliteDbInstance = db;
  }
  return db;
}

export function getDb(dbPath?: string) {
  if (drizzleDbInstance && !dbPath) {
    return drizzleDbInstance;
  }
  const sqlite = getSqliteDatabase(dbPath);
  const db = drizzle(sqlite, { schema });
  if (!dbPath) {
    drizzleDbInstance = db;
  }
  return db;
}

export function initDatabase(dbPath?: string): void {
  const sqlite = getSqliteDatabase(dbPath);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS repository_rotation (
      source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
      last_selected_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_execution_logs (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, run_id TEXT, group_id TEXT, report_plan_id TEXT,
      article_id TEXT, article_title TEXT, task_type TEXT NOT NULL, skill_id TEXT,
      started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER,
      status TEXT NOT NULL, error_message TEXT,
      input_json TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', attempts_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS ai_execution_logs_run ON ai_execution_logs(run_id, started_at);
    CREATE INDEX IF NOT EXISTS ai_execution_logs_started ON ai_execution_logs(started_at DESC);
    CREATE TABLE IF NOT EXISTS report_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      configuration_json TEXT NOT NULL,
      pending_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS repository_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      revision TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      credential_ref TEXT NOT NULL,
      wiki_base_url TEXT NOT NULL DEFAULT '',
      wiki_root_path TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notification_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      revision TEXT NOT NULL,
      url_secret_ref TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'generic_json',
      state TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      revision TEXT NOT NULL,
      provider TEXT NOT NULL,
      cli_path TEXT NOT NULL,
      model TEXT,
      state TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      capability_id TEXT NOT NULL DEFAULT 'web_feed',
      enabled INTEGER NOT NULL DEFAULT 1,
      options_json TEXT NOT NULL DEFAULT '{}',
      last_polled_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS source_states (
      source_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source_id, capability_id, revision)
    );

    CREATE TABLE IF NOT EXISTS groups (
      task_type TEXT NOT NULL DEFAULT 'article_research',
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      preferences TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      repository_connection_id TEXT NOT NULL,
      base_path TEXT NOT NULL,
      schedule_cron TEXT NOT NULL DEFAULT '0 8 * * *',
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      deep_analysis_count INTEGER NOT NULL DEFAULT 3,
      research_instructions TEXT NOT NULL DEFAULT '',
      ai_profile_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS group_sources (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      UNIQUE (group_id, source_id)
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      canonical_url TEXT,
      title TEXT,
      author TEXT,
      published_at TEXT,
      updated_at TEXT,
      latest_revision TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS article_revisions (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      revision_hash TEXT NOT NULL,
      content_ref TEXT NOT NULL,
      title TEXT,
      body_format TEXT NOT NULL DEFAULT 'html',
      body_completeness TEXT NOT NULL DEFAULT 'unknown',
      fetched_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS source_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      native_id TEXT,
      article_id TEXT NOT NULL,
      original_url TEXT,
      final_url TEXT,
      published_at TEXT,
      raw_ref TEXT,
      issues_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS group_items (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      revision_hash TEXT NOT NULL,
      rules_revision TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      matched_source_ids_json TEXT NOT NULL DEFAULT '[]',
      is_deep_analyzed INTEGER NOT NULL DEFAULT 0,
      selection_source TEXT NOT NULL DEFAULT 'ai_daily_auto',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT NOT NULL DEFAULT 'init',
      counts_json TEXT NOT NULL DEFAULT '{}',
      ai_logs_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      job_key TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      lease_token TEXT,
      leased_until TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      original_url TEXT NOT NULL,
      local_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      blob_ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'downloaded',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS research_claims (
      article_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research_tasks (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      revision_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      questions_json TEXT NOT NULL DEFAULT '[]',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      archived_at TEXT,
      request_hash TEXT NOT NULL DEFAULT '',
      report_markdown TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      date_sequence TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS article_locations (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      order_seq INTEGER NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS artifact_bundles (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      snapshot_ref TEXT NOT NULL,
      kind TEXT NOT NULL,
      bundle_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      commit_sha TEXT,
      commit_url TEXT,
      changed_paths_json TEXT NOT NULL DEFAULT '[]',
      response_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    sqlite.exec("ALTER TABLE sources ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}'");
  } catch {}
  try {
    sqlite.exec("ALTER TABLE groups ADD COLUMN deep_analysis_count INTEGER NOT NULL DEFAULT 3");
  } catch {}
  try {
    sqlite.exec("ALTER TABLE group_items ADD COLUMN is_deep_analyzed INTEGER NOT NULL DEFAULT 0");
  } catch {}
  try {
    sqlite.exec("ALTER TABLE group_items ADD COLUMN selection_source TEXT NOT NULL DEFAULT 'ai_daily_auto'");
  } catch {}
  try {
    sqlite.exec("ALTER TABLE articles ADD COLUMN user_interested INTEGER NOT NULL DEFAULT 0");
  } catch {}
  try {
    sqlite.exec("ALTER TABLE runs ADD COLUMN ai_logs_json TEXT NOT NULL DEFAULT '[]'");
  } catch {}
  const runColumns = sqlite.pragma('table_info(runs)') as Array<{ name: string }>;
  if (!runColumns.some((column) => column.name === 'output_json')) {
    sqlite.exec("ALTER TABLE runs ADD COLUMN output_json TEXT NOT NULL DEFAULT '{}'");
  }
  const researchColumns = sqlite.pragma('table_info(research_tasks)') as Array<{name:string}>;
  if (!researchColumns.some((column)=>column.name==='execution_json')) sqlite.exec("ALTER TABLE research_tasks ADD COLUMN execution_json TEXT NOT NULL DEFAULT '{}'");
  if (!researchColumns.some((column)=>column.name==='model')) sqlite.exec('ALTER TABLE research_tasks ADD COLUMN model TEXT');
  const aiColumns = sqlite.pragma('table_info(ai_profiles)') as Array<{name: string}>;
  for (const [column, definition] of Object.entries({ execution_json: "TEXT NOT NULL DEFAULT '{}'", worker_token_hash: 'TEXT', worker_last_seen: 'TEXT', worker_name: 'TEXT', worker_catalog_json: "TEXT NOT NULL DEFAULT '[]'" })) {
    if (!aiColumns.some((item) => item.name === column)) sqlite.exec(`ALTER TABLE ai_profiles ADD COLUMN ${column} ${definition}`);
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS ai_jobs (
    id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, request_json TEXT NOT NULL,
    status TEXT NOT NULL, lease_token TEXT, lease_until INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0, result_json TEXT,
    created_at INTEGER NOT NULL, deadline INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS ai_jobs_status ON ai_jobs(profile_id,status);`);
  const aiJobColumns = sqlite.pragma('table_info(ai_jobs)') as Array<{name: string}>;
  if (!aiJobColumns.some(column => column.name === 'progress_json')) sqlite.exec('ALTER TABLE ai_jobs ADD COLUMN progress_json TEXT');
  const logColumns = sqlite.pragma('table_info(ai_execution_logs)') as Array<{name:string}>;
  if (!logColumns.some(column => column.name === 'report_plan_id')) {
    sqlite.exec('ALTER TABLE ai_execution_logs ADD COLUMN report_plan_id TEXT');
    sqlite.exec("UPDATE ai_execution_logs SET report_plan_id=group_id,group_id=NULL WHERE task_type='digest' AND run_id IS NULL");
  }
  sqlite.exec('CREATE INDEX IF NOT EXISTS ai_execution_logs_job ON ai_execution_logs(job_id,started_at)');
  const repositoryColumns = sqlite.pragma('table_info(repository_connections)') as Array<{name: string}>;
  for (const column of ['wiki_base_url', 'wiki_root_path']) {
    if (!repositoryColumns.some((item) => item.name === column)) sqlite.exec(`ALTER TABLE repository_connections ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
  migratePipelineConfiguration(sqlite);
  migrateStageSkillsAndReports(sqlite);
  migrateCollectionQuality(sqlite);
  const pipelineColumns = sqlite.pragma('table_info(groups)') as Array<{name: string}>;
  if (!pipelineColumns.some(column => column.name === 'task_type')) sqlite.exec("ALTER TABLE groups ADD COLUMN task_type TEXT NOT NULL DEFAULT 'article_research'");
  for (const column of ['max_selected', 'enable_research']) {
    if (pipelineColumns.some(item => item.name === column)) sqlite.exec(`ALTER TABLE groups DROP COLUMN ${column}`);
  }
  const reportColumns = sqlite.pragma('table_info(research_tasks)') as Array<{name: string}>;
  if (!reportColumns.some(item => item.name === 'archived_at')) {
    sqlite.exec('ALTER TABLE research_tasks ADD COLUMN archived_at TEXT');
    // Preserve only reports supported by an acknowledged GitHub publication, not generation alone.
    sqlite.exec(`UPDATE research_tasks SET archived_at=(
      SELECT strftime('%Y-%m-%dT%H:%M:%fZ',d.updated_at) FROM deliveries d
      LEFT JOIN artifact_bundles b ON b.batch_id=d.batch_id AND b.group_id=d.group_id
      WHERE d.target_kind='github' AND d.group_id=research_tasks.group_id AND d.status IN ('updated','unchanged')
        AND julianday(d.updated_at)>=julianday(COALESCE(research_tasks.finished_at,research_tasks.created_at))
        AND (d.batch_id='research_'||research_tasks.id OR (json_valid(b.bundle_json) AND EXISTS (
          SELECT 1 FROM json_each(b.bundle_json,'$.entries') e JOIN json_each(b.bundle_json,'$.files') f
          WHERE json_extract(e.value,'$.article_id')=research_tasks.article_id
          AND json_extract(f.value,'$.path') LIKE '%/'||json_extract(e.value,'$.directory')||'/research.md'
        ))) ORDER BY d.updated_at DESC LIMIT 1
    ) WHERE status='succeeded'`);
  }
  if (!reportColumns.some(item => item.name === 'request_hash')) sqlite.exec("ALTER TABLE research_tasks ADD COLUMN request_hash TEXT NOT NULL DEFAULT ''");
  sqlite.exec("UPDATE group_items SET decision='qualified' WHERE decision IN ('selected','deferred')");


}

/** Move the former group ingestion rules and global push settings into their owners. */
function migratePipelineConfiguration(sqlite: Database.Database): void {
  const hasRules = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'group_source_rules'").get();
  if (!hasRules) return;
  sqlite.transaction(() => {
    const rules = sqlite.prepare('SELECT * FROM group_source_rules').all() as Array<{
      id: string; group_id: string; source_id: string; keywords_json: string; excluded_keywords_json: string;
    }>;
    for (const rule of rules) {
      sqlite.prepare('INSERT OR IGNORE INTO group_sources (id, group_id, source_id) VALUES (?, ?, ?)').run(rule.id, rule.group_id, rule.source_id);
      const source = sqlite.prepare('SELECT options_json FROM sources WHERE id = ?').get(rule.source_id) as { options_json: string } | undefined;
      if (!source) continue;
      const options = JSON.parse(source.options_json || '{}');
      options.poll_interval_mins ??= 30;
      options.keyword_mode ??= 'any';
      options.keywords = [...new Set([...(options.keywords || []), ...JSON.parse(rule.keywords_json || '[]')])];
      options.excluded_keywords = [...new Set([...(options.excluded_keywords || []), ...JSON.parse(rule.excluded_keywords_json || '[]')])];
      sqlite.prepare('UPDATE sources SET options_json = ? WHERE id = ?').run(JSON.stringify(options), rule.source_id);
      // A rule change must be applied even when the remote feed still returns 304.
      sqlite.prepare('DELETE FROM source_states WHERE source_id = ?').run(rule.source_id);
    }
    const settings = new Map((sqlite.prepare('SELECT key, value FROM workspace_settings').all() as Array<{key: string; value: string}>).map((r) => [r.key, r.value]));
    const groups = sqlite.prepare('SELECT id FROM groups').all() as Array<{id: string}>;
    for (const group of groups) {
      sqlite.prepare('UPDATE groups SET schedule_cron = ? WHERE id = ?').run(settings.get('pipeline_run_cron') || '0 8 * * *', group.id);
    }
    const report = {
      enabled: settings.get('daily_push_enabled') !== 'false' && Boolean(settings.get('daily_push_webhook_id')),
      schedule_cron: settings.get('daily_push_cron') || '0 9 * * *',
      timezone: settings.get('timezone') || 'Asia/Shanghai',
      notification_connection_id: settings.get('daily_push_webhook_id') || null,
      skill_id: settings.get('daily_digest_skill_id') || 'batch-digest-generator',
      pipeline_ids: JSON.parse(settings.get('daily_push_group_ids') || '[]').length ? JSON.parse(settings.get('daily_push_group_ids')!) : groups.map((g) => g.id),
    };
    sqlite.prepare('INSERT OR REPLACE INTO workspace_settings (key, value) VALUES (?, ?)').run('report_configuration', JSON.stringify(report));
    sqlite.exec('DROP TABLE group_source_rules');
    sqlite.exec("DELETE FROM workspace_settings WHERE key IN ('pipeline_run_cron', 'daily_push_enabled', 'daily_push_cron', 'daily_push_webhook_id', 'daily_digest_skill_id', 'daily_push_group_ids')");
    sqlite.exec('ALTER TABLE groups DROP COLUMN notification_connection_id');
  })();
}

function migrateStageSkillsAndReports(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    const columns = sqlite.pragma('table_info(groups)') as Array<{name: string}>;
    for (const [name, value] of Object.entries({ selection_skill_id: 'article-selector', research_skill_id: 'deep-research-expert' })) {
      if (!columns.some((column) => column.name === name)) sqlite.exec(`ALTER TABLE groups ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${value}'`);
    }
    if (columns.some((column) => column.name === 'skill_ids_json')) {
      const groups = sqlite.prepare('SELECT id, skill_ids_json FROM groups').all() as Array<{id: string; skill_ids_json: string}>;
      for (const group of groups) {
        const ids: string[] = JSON.parse(group.skill_ids_json || '[]');
        const research = ids.find((id) => /research/.test(id)) || 'deep-research-expert';
        sqlite.prepare('UPDATE groups SET research_skill_id = ? WHERE id = ?').run(research, group.id);
      }
      sqlite.exec('ALTER TABLE groups DROP COLUMN skill_ids_json');
    }
    for (const name of ['generate_digest', 'digest_skill_id', 'digest_instructions']) {
      if (columns.some((column) => column.name === name)) sqlite.exec(`ALTER TABLE groups DROP COLUMN ${name}`);
    }
    const legacy = sqlite.prepare("SELECT value FROM workspace_settings WHERE key = 'report_configuration'").get() as {value: string} | undefined;
    if (legacy) {
      const now = new Date().toISOString();
      const pending = sqlite.prepare("SELECT value FROM workspace_settings WHERE key = 'report_pending_date'").get() as {value: string} | undefined;
      sqlite.prepare('INSERT OR IGNORE INTO report_plans (id, name, configuration_json, pending_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('report_default', '每日工作汇报', legacy.value, pending?.value || null, now, now);
      sqlite.exec("DELETE FROM workspace_settings WHERE key IN ('report_configuration', 'report_pending_date')");
    }
  })();
}

function migrateCollectionQuality(sqlite: Database.Database): void {
  const columns = sqlite.pragma('table_info(articles)') as Array<{ name: string }>;
  for (const [name, value] of Object.entries({date_evidence_json: '{}'})) {
    if (!columns.some((column) => column.name === name)) sqlite.exec(`ALTER TABLE articles ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${value}'`);
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS collection_candidates (
      source_id TEXT NOT NULL, item_id TEXT NOT NULL, article_id TEXT NOT NULL,
      item_json TEXT NOT NULL, rule_revision TEXT NOT NULL, discovery_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '', last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT,
      updated_at TEXT NOT NULL, PRIMARY KEY(source_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS collection_receipts (
      source_id TEXT NOT NULL, item_id TEXT NOT NULL, discovery_hash TEXT NOT NULL,
      rule_revision TEXT NOT NULL, PRIMARY KEY(source_id,item_id)
    );
    CREATE INDEX IF NOT EXISTS candidates_pending ON collection_candidates(source_id, status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS candidates_article ON collection_candidates(article_id);

    CREATE TABLE IF NOT EXISTS collection_runs (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, rule_revision TEXT NOT NULL,
      options_json TEXT NOT NULL, implementation TEXT NOT NULL,
      stats_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS article_reviews (
      article_id TEXT NOT NULL, revision_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', result_json TEXT, error_message TEXT,
      log_id TEXT, created_at TEXT NOT NULL, assessed_at TEXT,
      PRIMARY KEY(article_id, revision_hash),
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS article_reviews_pending ON article_reviews(status, created_at);
  `);
  const reviewColumns = sqlite.pragma('table_info(article_reviews)') as Array<{name:string}>;
  if (!reviewColumns.some(column => column.name === 'material_issue')) sqlite.exec('ALTER TABLE article_reviews ADD COLUMN material_issue TEXT');
  sqlite.exec('DROP INDEX IF EXISTS articles_pool_date');
  for (const [table, removed] of [['articles',['pool_status','quality_reason','content_kind']],['groups',['lookback_days']]] as const) {
    const columns=sqlite.pragma(`table_info(${table})`) as Array<{name:string}>;
    for(const name of removed) if(columns.some(column=>column.name===name)) sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
  }
  const relationColumns = sqlite.pragma('table_info(group_items)') as Array<{name: string}>;
  if (relationColumns.some(column => column.name === 'scores_json')) sqlite.exec('ALTER TABLE group_items DROP COLUMN scores_json');
  const taskColumns = sqlite.pragma('table_info(groups)') as Array<{name: string}>;
  if (taskColumns.some(column => column.name === 'assessment_skill_id'))
    sqlite.exec('ALTER TABLE groups DROP COLUMN assessment_skill_id');
  const candidateColumns = sqlite.pragma('table_info(collection_candidates)') as Array<{name:string}>;
  if (!candidateColumns.some(column=>column.name==='last_error')) sqlite.exec('ALTER TABLE collection_candidates ADD COLUMN last_error TEXT');
}
