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
  commit: z.string().min(1),
  day: z.string(),
  focus: z.string(),
  files: z.array(z.string()),
});
export const RepositoryCheckoutSchema = z.object({
  url: z
    .string()
    .refine(
      (value) => Boolean(parseGitHubRepository(value)),
      "请输入 GitHub 仓库根地址",
    ),
  commit: z.string().regex(/^[a-f0-9]{40}$/, "仓库调研必须固定完整 Commit SHA"),
});
export type RepositoryCheckout = z.infer<typeof RepositoryCheckoutSchema>;
export type RepositoryStudy = z.infer<typeof RepositoryStudySchema>;

export function repositoryStudy(
  evidence: Record<string, unknown>,
): RepositoryStudy | undefined {
  const parsed = RepositoryStudySchema.safeParse(evidence.repository_study);
  return parsed.success ? parsed.data : undefined;
}
