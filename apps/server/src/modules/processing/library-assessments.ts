import type { LibraryArticle } from "@openlore/contracts";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";

/** A validated cache entry remains an assessment even if the rest of a run failed. */
export const LIBRARY_ASSESSMENTS_CTE = `
  score_records AS (
    SELECT article_id, group_id,
      CASE WHEN json_valid(scores_json) THEN scores_json ELSE '{}' END AS scores,
      reason, updated_at AS assessed_at, rowid AS record_order, 1 AS origin_order
    FROM group_items
    UNION ALL
    SELECT article_id, group_id,
      CASE WHEN json_valid(result_json) THEN result_json ELSE '{}' END AS scores,
      NULL AS reason, created_at AS assessed_at, rowid AS record_order, 0 AS origin_order
    FROM article_assessments
  ), valid_scores AS (
    SELECT article_id, group_id, assessed_at, record_order, origin_order,
      MIN(100, MAX(0, ROUND(json_extract(scores, '$.relevance')))) AS relevance,
      MIN(100, MAX(0, ROUND(json_extract(scores, '$.quality')))) AS quality,
      COALESCE(NULLIF(reason, ''), CASE WHEN json_type(scores, '$.reason')='text' THEN json_extract(scores, '$.reason') ELSE '' END) AS reason
    FROM score_records
    WHERE json_type(scores, '$.relevance') IN ('integer', 'real')
      AND json_type(scores, '$.quality') IN ('integer', 'real')
      AND ABS(json_extract(scores, '$.relevance')) <= 1.7976931348623157e308
      AND ABS(json_extract(scores, '$.quality')) <= 1.7976931348623157e308
  ), ranked_scores AS (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY article_id, group_id
      ORDER BY julianday(assessed_at) DESC, origin_order DESC, record_order DESC
    ) AS score_rank FROM valid_scores
  ), library_assessments AS (
    SELECT *, ROUND(0.7 * relevance + 0.3 * quality, 1) AS overall
    FROM ranked_scores WHERE score_rank=1
  )`;

export function getLibraryAssessments(
  articleIds: string[],
  groupId?: string,
): Map<string, LibraryArticle["assessments"]> {
  const result = new Map<string, LibraryArticle["assessments"]>();
  if (!articleIds.length) return result;
  const rows = getSqliteDatabase()
    .prepare(
      `WITH ${LIBRARY_ASSESSMENTS_CTE}
    SELECT a.article_id, a.group_id, COALESCE(g.name, a.group_id) AS group_name,
      a.relevance, a.quality, a.overall, a.reason, a.assessed_at
    FROM library_assessments a LEFT JOIN groups g ON g.id=a.group_id
    WHERE a.article_id IN (${articleIds.map(() => "?").join(",")}) ${groupId ? "AND a.group_id=?" : ""}
    ORDER BY julianday(a.assessed_at) DESC, a.group_id
  `,
    )
    .all(...articleIds, ...(groupId ? [groupId] : [])) as Array<
    LibraryArticle["assessments"][number] & { article_id: string }
  >;
  for (const { article_id, ...assessment } of rows) {
    const items = result.get(article_id) || [];
    items.push(assessment);
    result.set(article_id, items);
  }
  return result;
}
