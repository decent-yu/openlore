import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { completedResearchSql } from "../research/state.js";
import type { PipelineTaskType } from '@openlore/contracts';

/** All pool content in scope competes; only published research or an active claim excludes it. */
export function listPoolCandidates(
  sourceIds: string[],
  taskType?: PipelineTaskType,
): Array<{ id: string; processed: number; busy: number }> {
  return getSqliteDatabase()
    .prepare(
      `SELECT a.id,
    ${completedResearchSql("a.id")} AS processed,
    EXISTS(SELECT 1 FROM research_claims c WHERE c.article_id=a.id) AS busy
    FROM articles a
    WHERE 1=1
    ${taskType ? `AND json_extract(a.date_evidence_json,'$.repository_study') IS ${taskType === 'repository_research' ? 'NOT ' : ''}NULL` : ''}
    ${sourceIds.length ? `AND EXISTS(SELECT 1 FROM source_items si WHERE si.article_id=a.id AND si.source_id IN (${sourceIds.map(() => "?").join(",")}))` : ""}
    ORDER BY a.created_at, a.id`,
    )
    .all(...sourceIds) as Array<{
    id: string;
    processed: number;
    busy: number;
  }>;
}
