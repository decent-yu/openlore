import { getSqliteDatabase } from '../../infrastructure/persistence/sqlite/db.js';

/** The pool has already passed admission. Selection only removes completed work. */
export function listPoolCandidates(sourceIds: string[]): Array<{id:string; processed:number}> {
  return getSqliteDatabase().prepare(`SELECT a.id,
    (EXISTS(SELECT 1 FROM group_items gi WHERE gi.article_id=a.id AND (gi.decision='selected' OR gi.is_deep_analyzed=1))
      OR EXISTS(SELECT 1 FROM research_tasks rt WHERE rt.article_id=a.id AND rt.status='succeeded')) processed
    FROM articles a
    ${sourceIds.length ? `WHERE EXISTS(SELECT 1 FROM source_items si WHERE si.article_id=a.id AND si.source_id IN (${sourceIds.map(()=>'?').join(',')}))` : ''}
    ORDER BY a.created_at, a.id`).all(...sourceIds) as Array<{id:string;processed:number}>;
}
