import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const workspaceSettingsTable = sqliteTable('workspace_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const repositoryConnectionsTable = sqliteTable('repository_connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  revision: text('revision').notNull(),
  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
  defaultBranch: text('default_branch').notNull(),
  credentialRef: text('credential_ref').notNull(),
  wikiBaseUrl: text('wiki_base_url').notNull().default(''),
  wikiRootPath: text('wiki_root_path').notNull().default(''),
  state: text('state').notNull().default('ready'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const notificationConnectionsTable = sqliteTable('notification_connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  revision: text('revision').notNull(),
  urlSecretRef: text('url_secret_ref').notNull(),
  protocol: text('protocol').notNull().default('generic_json'),
  state: text('state').notNull().default('ready'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const aiProfilesTable = sqliteTable('ai_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  revision: text('revision').notNull(),
  provider: text('provider').notNull(), // 'codex_cli' | 'gemini_cli'
  cliPath: text('cli_path').notNull(),
  model: text('model'),
  executionJson: text('execution_json').notNull().default('{}'),
  workerTokenHash: text('worker_token_hash'),
  workerLastSeen: text('worker_last_seen'),
  workerName: text('worker_name'),
  workerCatalogJson: text('worker_catalog_json').notNull().default('[]'),
  state: text('state').notNull().default('ready'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sourcesTable = sqliteTable('sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  description: text('description').notNull().default(''),
  capabilityId: text('capability_id').notNull().default('web_feed'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  optionsJson: text('options_json').notNull().default('{}'),
  lastPolledAt: text('last_polled_at'),
  lastSuccessAt: text('last_success_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sourceStatesTable = sqliteTable('source_states', {
  sourceId: text('source_id').notNull(),
  capabilityId: text('capability_id').notNull(),
  revision: text('revision').notNull(),
  stateJson: text('state_json').notNull().default('{}'),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const groupsTable = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  preferences: text('preferences').notNull().default(''),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  repositoryConnectionId: text('repository_connection_id').notNull(),
  basePath: text('base_path').notNull(),
  scheduleCron: text('schedule_cron').notNull().default('0 8 * * *'),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),
  deepAnalysisCount: integer('deep_analysis_count').notNull().default(3),
  researchInstructions: text('research_instructions').notNull().default(''),
  selectionSkillId: text('selection_skill_id').notNull().default('article-selector'),
  researchSkillId: text('research_skill_id').notNull().default('deep-research-expert'),
  aiProfileId: text('ai_profile_id'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const groupSourcesTable = sqliteTable('group_sources', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  sourceId: text('source_id').notNull(),
});

export const articlesTable = sqliteTable('articles', {
  contentKind: text('content_kind').notNull().default('unknown'),
  dateEvidenceJson: text('date_evidence_json').notNull().default('{}'),
  id: text('id').primaryKey(),
  canonicalUrl: text('canonical_url'),
  title: text('title'),
  author: text('author'),
  publishedAt: text('published_at'),
  updatedAt: text('updated_at'),
  latestRevision: text('latest_revision'),
  userInterested: integer('user_interested', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const articleRevisionsTable = sqliteTable('article_revisions', {
  id: text('id').primaryKey(),
  articleId: text('article_id').notNull(),
  revisionHash: text('revision_hash').notNull(),
  contentRef: text('content_ref').notNull(),
  title: text('title'),
  bodyFormat: text('body_format').notNull().default('html'),
  bodyCompleteness: text('body_completeness').notNull().default('unknown'),
  fetchedAt: text('fetched_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const articleReviewsTable = sqliteTable('article_reviews', {
  articleId: text('article_id').notNull().references(() => articlesTable.id, { onDelete: 'cascade' }),
  revisionHash: text('revision_hash').notNull(),
  status: text('status').notNull().default('queued'),
  resultJson: text('result_json'),
  errorMessage: text('error_message'),
  logId: text('log_id'),
  createdAt: text('created_at').notNull(),
  assessedAt: text('assessed_at'),
}, (table) => [primaryKey({columns: [table.articleId, table.revisionHash]})]);

export const sourceItemsTable = sqliteTable('source_items', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull(),
  nativeId: text('native_id'),
  articleId: text('article_id').notNull(),
  originalUrl: text('original_url'),
  finalUrl: text('final_url'),
  publishedAt: text('published_at'),
  rawRef: text('raw_ref'),
  issuesJson: text('issues_json').notNull().default('[]'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const groupItemsTable = sqliteTable('group_items', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  articleId: text('article_id').notNull(),
  revisionHash: text('revision_hash').notNull(),
  rulesRevision: text('rules_revision').notNull(),
  decision: text('decision').notNull(), // 'qualified' | 'excluded'
  reason: text('reason').notNull().default(''),
  matchedSourceIdsJson: text('matched_source_ids_json').notNull().default('[]'),
  isDeepAnalyzed: integer('is_deep_analyzed', { mode: 'boolean' }).notNull().default(false),
  selectionSource: text('selection_source').notNull().default('ai_daily_auto'),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const runsTable = sqliteTable('runs', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  status: text('status').notNull().default('queued'),
  stage: text('stage').notNull().default('init'),
  countsJson: text('counts_json').notNull().default('{}'),
  aiLogsJson: text('ai_logs_json').notNull().default('[]'),
  outputJson: text('output_json').notNull().default('{}'),
  startedAt: text('started_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text('finished_at'),
  errorMessage: text('error_message'),
});

export const jobsTable = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  runId: text('run_id'),
  jobKey: text('job_key').notNull().unique(),
  type: text('type').notNull(),
  status: text('status').notNull().default('queued'),
  payloadJson: text('payload_json').notNull().default('{}'),
  resultJson: text('result_json'),
  leaseToken: text('lease_token'),
  leasedUntil: text('leased_until'),
  attempt: integer('attempt').notNull().default(0),
  availableAt: text('available_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mediaAssetsTable = sqliteTable('media_assets', {
  id: text('id').primaryKey(),
  articleId: text('article_id').notNull(),
  originalUrl: text('original_url').notNull(),
  localPath: text('local_path').notNull(),
  sha256: text('sha256').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  blobRef: text('blob_ref').notNull(),
  status: text('status').notNull().default('downloaded'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const researchTasksTable = sqliteTable('research_tasks', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  articleId: text('article_id').notNull(),
  revisionHash: text('revision_hash').notNull(),
  status: text('status').notNull().default('queued'),
  questionsJson: text('questions_json').notNull().default('[]'),
  evidenceJson: text('evidence_json').notNull().default('[]'),
  executionJson: text('execution_json').notNull().default('{}'),
  model: text('model'),
  archivedAt: text('archived_at'),
  requestHash: text('request_hash').notNull().default(''),
  reportMarkdown: text('report_markdown').notNull().default(''),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text('finished_at'),
  errorMessage: text('error_message'),
});

export const collectionsTable = sqliteTable('collections', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  dateSequence: text('date_sequence').notNull(), // e.g. '20261015-01'
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const articleLocationsTable = sqliteTable('article_locations', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  articleId: text('article_id').notNull(),
  collectionId: text('collection_id').notNull(),
  orderSeq: integer('order_seq').notNull(),
  slug: text('slug').notNull(),
  directory: text('directory').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const artifactBundlesTable = sqliteTable('artifact_bundles', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  runId: text('run_id').notNull(),
  collectionId: text('collection_id').notNull(),
  batchId: text('batch_id').notNull(),
  snapshotRef: text('snapshot_ref').notNull(),
  kind: text('kind').notNull(),
  bundleJson: text('bundle_json').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const deliveriesTable = sqliteTable('deliveries', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  batchId: text('batch_id').notNull(),
  targetKind: text('target_kind').notNull(), // 'github' | 'webhook'
  status: text('status').notNull().default('pending'),
  commitSha: text('commit_sha'),
  commitUrl: text('commit_url'),
  changedPathsJson: text('changed_paths_json').notNull().default('[]'),
  responseJson: text('response_json'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reportPlansTable = sqliteTable('report_plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  configurationJson: text('configuration_json').notNull(),
  pendingDate: text('pending_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
