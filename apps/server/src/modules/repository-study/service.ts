import path from "node:path";
import type { RepositoryHistory, Source } from "@openlore/contracts";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { getAppPaths } from "../../infrastructure/config/paths.js";
import { repositoryCache } from "../../infrastructure/ai/repository_cache.js";
import { runProcess } from "../../infrastructure/ai/workspace_runner.js";
import { getPublishedWikiLinks } from "../delivery/wiki-links.js";

export interface RepositorySnapshot {
  commit: string;
  branch: string;
  files: string[];
  readme: string;
}
export async function refreshRepository(
  source: Pick<Source, "url">,
): Promise<RepositorySnapshot> {
  const snapshot = await repositoryCache(
    source.url,
    path.join(getAppPaths().dataDir, "repository-cache"),
    runProcess,
    600000,
  );
  const read = async (args: string[]) => {
    const result = await runProcess("git", args, snapshot.cache, "", 30000);
    if (result.code !== 0) throw new Error("读取本地仓库快照失败");
    return result.stdout;
  };
  const files = (await read(["ls-tree", "-rz", "--name-only", snapshot.commit]))
    .split("\0")
    .filter(Boolean);
  const readme = files.find((file) =>
    /^readme(?:\.md|\.rst|\.txt)?$/i.test(file),
  );
  return {
    commit: snapshot.commit,
    branch: snapshot.branch!,
    files,
    readme: readme ? await read(["show", `${snapshot.commit}:${readme}`]) : "",
  };
}

export class RepositoryStudyService {
  history(sourceId: string): RepositoryHistory[] {
    const db = getSqliteDatabase();
    const studies = db
      .prepare(
        `SELECT DISTINCT a.id,a.id AS article_id,a.title,a.date_evidence_json FROM source_items s
      JOIN articles a ON a.id=s.article_id WHERE s.source_id=? AND json_extract(a.date_evidence_json,'$.repository_study') IS NOT NULL ORDER BY a.rowid DESC`,
      )
      .all(sourceId) as Array<{
      id: string;
      article_id: string;
      title: string;
      date_evidence_json: string;
    }>;
    const links = getPublishedWikiLinks(studies.map((s) => s.article_id));
    return studies.map((study) => {
      const tasks = db
        .prepare(
          `SELECT id,group_id,status,error_message,archived_at,report_markdown,questions_json,repository_study_json FROM research_tasks
        WHERE article_id=? ORDER BY created_at DESC,rowid DESC`,
        )
        .all(study.article_id) as Array<{
        id: string;
        group_id: string;
        status: string;
        error_message?: string;
        archived_at?: string;
        report_markdown: string;
        questions_json: string;
        repository_study_json: string;
      }>;
      const busy = db
        .prepare("SELECT 1 FROM research_claims WHERE article_id=?")
        .get(study.article_id);
      const archiveFailure = db
        .prepare(
          `SELECT d.error_message FROM deliveries d JOIN artifact_bundles b ON b.batch_id=d.batch_id
        WHERE d.target_kind='github' AND d.status='failed' AND EXISTS(SELECT 1 FROM json_each(b.bundle_json,'$.entries') e WHERE json_extract(e.value,'$.article_id')=?)
        ORDER BY d.rowid DESC LIMIT 1`,
        )
        .get(study.article_id) as { error_message?: string } | undefined;
      const runFailure = db
        .prepare(
          `SELECT error_message FROM runs WHERE status='failed'
        AND EXISTS(SELECT 1 FROM json_each(output_json,'$.entries') e WHERE json_extract(e.value,'$.article_id')=?)
        ORDER BY rowid DESC LIMIT 1`,
        )
        .get(study.article_id) as { error_message?: string } | undefined;
      const approved = tasks.find((task) => task.status === "succeeded");
      const commit = approved
        ? JSON.parse(approved.repository_study_json || "{}").commit ||
          JSON.parse(study.date_evidence_json).repository_study?.commit ||
          ""
        : JSON.parse(study.date_evidence_json).repository_study?.commit || "";
      return {
        id: study.id,
        article_id: study.article_id,
        title: study.title,
        status: busy
          ? "running"
          : tasks[0]?.status === "failed"
            ? "failed"
            : approved?.archived_at
              ? "completed"
              : approved
                ? "awaiting_archive"
                : "pending",
        error:
          tasks[0]?.status === "failed"
            ? tasks[0].error_message
            : approved && !approved.archived_at
              ? archiveFailure?.error_message ||
                runFailure?.error_message ||
                undefined
              : undefined,
        commit,
        reports: (approved ? [approved] : []).map((t) => ({
          id: t.id,
          group_id: t.group_id,
          archived_at: t.archived_at || undefined,
          report_markdown: t.report_markdown,
          questions: JSON.parse(t.questions_json || "[]"),
          commit,
          wiki_url: t.archived_at
            ? links.get(`${t.group_id}:${study.article_id}`)?.research_url
            : undefined,
        })),
      };
    });
  }
}
export const repositoryStudyService = new RepositoryStudyService();
