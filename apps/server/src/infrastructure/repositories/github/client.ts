export interface GitHubSyncOptions {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  basePath: string; // e.g. "docs/agent-leaning"
  files: Array<{
    path: string; // relative to repo root, e.g. "docs/agent-leaning/README.md"
    content: string; // text or base64
    encoding: 'utf-8' | 'binary';
    sha256: string;
  }>;
  commitMessage: string;
}

export interface GitHubSyncResult {
  status: 'updated' | 'unchanged' | 'conflict' | 'failed';
  commitSha?: string;
  commitUrl?: string;
  changedPaths: string[];
  errorMessage?: string;
}

export class GitHubClient {
  static async request(
    url: string,
    token: string,
    options: RequestInit = {},
  ): Promise<any> {
    const res = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'OpenLore-GitSync/0.1',
        ...(options.headers || {}),
      },
    });

    if (res.status === 404) {
      throw new Error(`GitHub resource not found (404): ${url}`);
    }
    if (res.status === 401 || res.status === 403) {
      const body = await res.text();
      throw new Error(`GitHub authorization error (${res.status}): ${body}`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API error (${res.status}): ${body}`);
    }

    if (res.status === 204) {
      return null;
    }
    return res.json();
  }

  static async testConnection(
    owner: string,
    repo: string,
    token: string,
  ): Promise<{ ok: boolean; defaultBranch: string; message: string }> {
    try {
      const repoData = await this.request(
        `https://api.github.com/repos/${owner}/${repo}`,
        token,
      );
      return {
        ok: true,
        defaultBranch: repoData.default_branch || 'main',
        message: 'Successfully connected to repository',
      };
    } catch (e: any) {
      return {
        ok: false,
        defaultBranch: 'main',
        message: e.message,
      };
    }
  }

  static async syncFiles(options: GitHubSyncOptions): Promise<GitHubSyncResult> {
    const { owner, repo, branch, token, files, commitMessage } = options;

    try {
      // 1. Get branch reference
      const refData = await this.request(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
        token,
      );
      const headCommitSha = refData.object.sha;

      // 2. Get head commit to find base_tree
      const commitData = await this.request(
        `https://api.github.com/repos/${owner}/${repo}/git/commits/${headCommitSha}`,
        token,
      );
      const baseTreeSha = commitData.tree.sha;

      // 3. Create blobs for each file
      const treeEntries: Array<{
        path: string;
        mode: string;
        type: string;
        sha: string;
      }> = [];

      for (const file of files) {
        const blobData = await this.request(
          `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
          token,
          {
            method: 'POST',
            body: JSON.stringify({
              content: file.content,
              encoding: 'base64',
            }),
          },
        );

        treeEntries.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        });
      }

      // 4. Create new tree
      const newTreeData = await this.request(
        `https://api.github.com/repos/${owner}/${repo}/git/trees`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: treeEntries,
          }),
        },
      );
      const newTreeSha = newTreeData.sha;

      // Check if tree has actually changed
      if (newTreeSha === baseTreeSha) {
        return {
          status: 'unchanged',
          commitSha: headCommitSha,
          changedPaths: [],
        };
      }

      // 5. Create commit
      const newCommit = await this.request(
        `https://api.github.com/repos/${owner}/${repo}/git/commits`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            message: commitMessage,
            tree: newTreeSha,
            parents: [headCommitSha],
          }),
        },
      );
      const newCommitSha = newCommit.sha;

      // 6. Update reference (force: false)
      await this.request(
        `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({
            sha: newCommitSha,
            force: false,
          }),
        },
      );

      const commitUrl = `https://github.com/`;

      return {
        status: 'updated',
        commitSha: newCommitSha,
        commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommitSha}`,
        changedPaths: files.map((f) => f.path),
      };
    } catch (err: any) {
      if (err.message && err.message.includes('409')) {
        return {
          status: 'conflict',
          changedPaths: [],
          errorMessage: 'Remote branch has concurrent changes (409 Conflict)',
        };
      }
      return {
        status: 'failed',
        changedPaths: [],
        errorMessage: err.message,
      };
    }
  }
}
