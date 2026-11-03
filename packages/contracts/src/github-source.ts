import { z } from "zod";

export const GITHUB_CODE_RESEARCH_SKILL = "github-code-research";

export function parseGitHubRepository(
  value: string,
): { owner: string; repo: string; url: string; directory: string } | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return null;
    const match = /^\/([\w-]+)\/([\w.-]+?)\/?$/.exec(
      url.pathname.replace(/\.git\/?$/, ""),
    );
    if (!match || [".", ".."].includes(match[2])) return null;
    const [, owner, repo] = match;
    return {
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
      directory: `${owner.toLowerCase()}@${repo.toLowerCase()}`,
    };
  } catch {
    return null;
  }
}

export const RepositoryStudySchema = z.object({
  repository_url: z.string().url(),
  directory: z.string().regex(/^[\w-]+@[\w.-]+$/),
  commit: z.string().optional(),
  day: z.string(),
  focus: z.string(),
  run_id: z.string().optional(),
  source_id: z.string().optional(),
  study_id: z.string().optional(),
  questions: z.array(z.string()).default([]),
});
export const RepositoryTargetSchema = z.object({
  url: z
    .string()
    .refine(
      (value) => Boolean(parseGitHubRepository(value)),
      "请输入 GitHub 仓库根地址",
    ),
});
export const RepositoryCheckoutSchema = RepositoryTargetSchema.extend({
  commit: z.string().optional(),
  branch: z.string().optional(),
});
export type RepositoryTarget = z.infer<typeof RepositoryTargetSchema>;
export type RepositoryCheckout = z.infer<typeof RepositoryCheckoutSchema>;
export type RepositoryStudy = z.infer<typeof RepositoryStudySchema>;

export interface RepositoryHistory {
  id: string;
  article_id: string;
  title: string;
  status: "pending" | "running" | "failed" | "awaiting_archive" | "completed" | "cancelled";
  error?: string;
  commit: string;
  reports: Array<{
    id: string;
    group_id: string;
    archived_at?: string;
    report_markdown: string;
    questions?: string[];
    commit?: string;
    wiki_url?: string;
  }>;
}

export function repositoryStudy(
  evidence: Record<string, unknown>,
): RepositoryStudy | undefined {
  const parsed = RepositoryStudySchema.safeParse(evidence.repository_study);
  return parsed.success ? parsed.data : undefined;
}

export const RepositoryResearchContextSchema = z.object({
  source_id: z.string(),
  name: z.string(),
  repository_url: z.string().url(),
  goal: z.string(),
  history: z.array(
    z.object({
      id: z.string(),
      article_id: z.string(),
      title: z.string(),
      commit: z.string(),
      questions: z.array(z.string()),
      report_markdown: z.string(),
      archived_at: z.string().optional(),
    }),
  ),
});
export type RepositoryResearchContext = z.infer<
  typeof RepositoryResearchContextSchema
>;

export function repositoryResearchContext(
  source: {
    id: string;
    name: string;
    url: string;
    options: { research_focus: string };
    repository_history?: RepositoryHistory[];
  },
  excludeArticleId?: string,
): RepositoryResearchContext {
  return {
    source_id: source.id,
    name: source.name,
    repository_url: source.url,
    goal: source.options.research_focus,
    history: (source.repository_history || [])
      .filter((item) => item.article_id !== excludeArticleId)
      .flatMap((item) =>
        item.reports.map((report) => ({
          id: report.id,
          article_id: item.article_id,
          title: item.title,
          commit: report.commit || item.commit,
          questions: report.questions || [],
          report_markdown: report.report_markdown,
          archived_at: report.archived_at,
        })),
      ),
  };
}
