import { z } from "zod";

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
export type RepositoryStudy = z.infer<typeof RepositoryStudySchema>;

export function repositoryStudy(
  evidence: Record<string, unknown>,
): RepositoryStudy | undefined {
  const parsed = RepositoryStudySchema.safeParse(evidence.repository_study);
  return parsed.success ? parsed.data : undefined;
}
