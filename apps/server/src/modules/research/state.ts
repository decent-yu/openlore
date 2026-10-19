import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";

export const completedResearchSql = (article: string) => `EXISTS (
  SELECT 1 FROM research_tasks rt WHERE rt.article_id=${article} AND rt.archived_at IS NOT NULL
)`;

/** Holds an article across generation and publication, including concurrent pipelines. */
export function claimResearchArticle(
  articleId: string,
  groupId: string,
  ownerId: string,
  allowPublished = false,
): boolean {
  const db = getSqliteDatabase();
  return db.transaction(() => {
    if (
      !allowPublished &&
      db
        .prepare(
          "SELECT 1 FROM research_tasks WHERE article_id=? AND archived_at IS NOT NULL",
        )
        .get(articleId)
    )
      return false;
    const claim = db
      .prepare("SELECT owner_id FROM research_claims WHERE article_id=?")
      .get(articleId) as { owner_id: string } | undefined;
    if (claim) return claim.owner_id === ownerId;
    return (
      db
        .prepare("INSERT OR IGNORE INTO research_claims VALUES (?,?,?,?)")
        .run(articleId, groupId, ownerId, new Date().toISOString()).changes ===
      1
    );
  })();
}
export function releaseResearchClaims(ownerId: string): void {
  getSqliteDatabase()
    .prepare("DELETE FROM research_claims WHERE owner_id=?")
    .run(ownerId);
}

export function markResearchArchived(taskIds: string[]): void {
  const db = getSqliteDatabase();
  db.transaction(() => {
    const now = new Date().toISOString();
    for (const id of taskIds) {
      db.prepare(
        "UPDATE research_tasks SET archived_at=? WHERE id=? AND status='succeeded'",
      ).run(now, id);
      db.prepare(
        `UPDATE group_items SET is_deep_analyzed=1 WHERE EXISTS (
        SELECT 1 FROM research_tasks r WHERE r.id=? AND r.archived_at IS NOT NULL
        AND r.group_id=group_items.group_id AND r.article_id=group_items.article_id
      )`,
      ).run(id);
    }
  })();
}
