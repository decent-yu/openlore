import crypto from "node:crypto";
import type { Group, StructuredEntry } from "@openlore/contracts";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import type { ProcessedBatchResult } from "@openlore/contracts";

export function createProcessedBatch(observed: number): ProcessedBatchResult {
  return {
    decisions: [],
    entries: [],
    aiLogs: [],
    counts: {
      observed,
      already_processed: 0,
      candidate: 0,
      planned: 0,
      excluded: 0,
      deferred: 0,
      unreviewed: 0,
    },
  };
}
export function saveProcessedBatch(
  runId: string,
  result: ProcessedBatchResult,
): void {
  getSqliteDatabase()
    .prepare("UPDATE runs SET counts_json=?,ai_logs_json=? WHERE id=?")
    .run(JSON.stringify(result.counts), JSON.stringify(result.aiLogs), runId);
}
export function recordProcessedEntry(
  group: Group,
  entry: StructuredEntry,
  reason: string,
  sources: string[],
  result: ProcessedBatchResult,
): void {
  result.entries.push(entry);
  result.decisions.push({
    article_id: entry.article_id,
    revision: entry.revision,
    decision: "qualified",
    reason,
    matched_source_ids: sources,
  });
  const db = getSqliteDatabase();
  const previous = db
    .prepare("SELECT id FROM group_items WHERE group_id=? AND article_id=?")
    .get(group.id, entry.article_id) as { id: string } | undefined;
  const values = [
    entry.revision,
    group.task_type,
    reason,
    JSON.stringify(sources),
    new Date().toISOString(),
  ];
  if (previous)
    db.prepare(
      "UPDATE group_items SET revision_hash=?,rules_revision=?,decision='qualified',reason=?,matched_source_ids_json=?,updated_at=? WHERE id=?",
    ).run(...values, previous.id);
  else
    db.prepare(
      "INSERT INTO group_items(id,group_id,article_id,revision_hash,rules_revision,decision,reason,matched_source_ids_json,updated_at) VALUES (?,?,?,?,?,'qualified',?,?,?)",
    ).run(`gi_${crypto.randomUUID()}`, group.id, entry.article_id, ...values);
}
