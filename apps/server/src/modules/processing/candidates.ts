import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { completedResearchSql } from "../research/state.js";

/** All pool content in scope competes; only published research or an active claim excludes it. */
export function listPoolCandidates(
  sourceIds: string[],
): Array<{ id: string; processed: number; busy: number }> {
  return getSqliteDatabase()
    .prepare(
      `SELECT a.id,
    ${completedResearchSql("a.id")} AS processed,
    EXISTS(SELECT 1 FROM research_claims c WHERE c.article_id=a.id) AS busy
    FROM articles a
    ${sourceIds.length ? `WHERE EXISTS(SELECT 1 FROM source_items si WHERE si.article_id=a.id AND si.source_id IN (${sourceIds.map(() => "?").join(",")}))` : ""}
    ORDER BY a.created_at, a.id`,
    )
    .all(...sourceIds) as Array<{
    id: string;
    processed: number;
    busy: number;
  }>;
}
