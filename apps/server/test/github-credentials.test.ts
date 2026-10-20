import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import {
  initDatabase,
  getSqliteDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";
import { createServer } from "../src/http/server.js";
import { secretsStore } from "../src/infrastructure/secrets/local_file/secrets_store.js";
import {
  DEFAULT_GITHUB_TOKEN_REF,
  getGitHubToken,
  gitHubAuthentication,
} from "../src/infrastructure/repositories/github/credentials.js";
import { GitHubClient } from "../src/infrastructure/repositories/github/client.js";
import { settingsService } from "../src/modules/settings/service.js";
import { runProcess } from "../src/infrastructure/ai/workspace_runner.js";
import { repositoryCache } from "../src/infrastructure/ai/repository_cache.js";

let app: Awaited<ReturnType<typeof createServer>>;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "openlore-github-auth-"));
beforeAll(async () => {
  initDatabase();
  app = await createServer();
});
beforeEach(() => {
  secretsStore.deleteSecret(DEFAULT_GITHUB_TOKEN_REF);
  getSqliteDatabase()
    .prepare(
      "DELETE FROM workspace_settings WHERE key='default_github_token_connection_id'",
    )
    .run();
  vi.spyOn(GitHubClient, "testConnection").mockResolvedValue({
    ok: true,
    defaultBranch: "trunk",
    message: "connected",
  });
});
afterEach(() => {
  secretsStore.deleteSecret(DEFAULT_GITHUB_TOKEN_REF);
  vi.restoreAllMocks();
});
afterAll(async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it("marks an existing connection as the default without returning or copying its token into workspace settings", async () => {
  const repo = await settingsService.saveRepositoryConnection({
    url: "https://github.com/example/vault",
    token: "connection-test-token",
  });
  const save = await app.inject({
    method: "POST",
    url: `/api/v1/settings/connections/repository/${repo.id}/default-token`,
  });
  expect(save.statusCode).toBe(200);
  expect(save.json()).toMatchObject({
    github_token_configured: true,
    default_github_token_connection_id: repo.id,
  });
  expect(getGitHubToken()).toBe("connection-test-token");
  expect(save.body).not.toContain("connection-test-token");
  expect(
    JSON.stringify(
      getSqliteDatabase().prepare("SELECT * FROM workspace_settings").all(),
    ),
  ).not.toContain("connection-test-token");
  const settings = await app.inject({ method: "GET", url: "/api/v1/settings" });
  expect(settings.json().default_github_token_connection_id).toBe(repo.id);
  expect(settings.body).not.toContain("connection-test-token");
});

it("updates the selected default when its token changes, supports connection overrides and clears it on deletion", async () => {
  const first = await settingsService.saveRepositoryConnection({
    url: "https://github.com/example/first",
    token: "first-test-token",
  });
  const second = await settingsService.saveRepositoryConnection({
    url: "https://github.com/example/second",
    token: "second-test-token",
  });
  await settingsService.setDefaultGitHubToken(first.id);
  expect(getGitHubToken(second.credential_ref)).toBe("second-test-token");
  await settingsService.saveRepositoryConnection({
    id: first.id,
    url: "https://github.com/example/first",
    token: "replacement-test-token",
  });
  expect(getGitHubToken()).toBe("replacement-test-token");
  const inherited = await settingsService.saveRepositoryConnection({
    url: "https://github.com/example/inherited",
  });
  expect(GitHubClient.testConnection).toHaveBeenLastCalledWith(
    "example",
    "inherited",
    "replacement-test-token",
  );
  expect(secretsStore.getSecret(inherited.credential_ref)).toBeNull();
  await settingsService.testRepositoryConnection(inherited.id);
  expect(GitHubClient.testConnection).toHaveBeenLastCalledWith(
    "example",
    "inherited",
    "replacement-test-token",
  );
  await settingsService.setDefaultGitHubToken(second.id);
  expect(getGitHubToken()).toBe("second-test-token");
  await settingsService.deleteRepositoryConnection(first.id);
  expect(getGitHubToken()).toBe("second-test-token");
  await settingsService.deleteRepositoryConnection(second.id);
  expect(getGitHubToken()).toBeNull();
  expect(
    (await settingsService.getSettings()).default_github_token_connection_id,
  ).toBeNull();
});

it("rejects selecting a missing or inherited-only token and ignores forged default settings", async () => {
  const inherited = await settingsService.saveRepositoryConnection({
    url: "https://github.com/example/no-token",
  });
  for (const id of ["missing", inherited.id]) {
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/settings/connections/repository/${id}/default-token`,
        })
      ).statusCode,
    ).toBe(400);
  }
  expect(
    (
      await settingsService.updateSettings({
        github_token_configured: true,
        default_github_token_connection_id: inherited.id,
      })
    ).github_token_configured,
  ).toBe(false);
  expect(
    (await settingsService.getSettings()).default_github_token_connection_id,
  ).toBeNull();
});

it("uses the default token in process-only Git HTTPS headers and overrides SSH rewrites without persisting credentials", async () => {
  secretsStore.setSecret(DEFAULT_GITHUB_TOKEN_REF, "git-test-token");
  const url = "https://github.com/example/source";
  const cwd = path.join(root, "git");
  fs.mkdirSync(cwd);
  const git = async (args: string[], authenticated = false) => {
    const result = await runProcess("git", args, cwd, "", 10000, undefined, {
      env: authenticated ? gitHubAuthentication(url) : {},
    });
    expect(result.code).toBe(0);
    return result.stdout.trim();
  };
  await git(["init", "--quiet"]);
  await git(["config", "url.git@github.com:.insteadOf", "https://github.com/"]);
  await git(["remote", "add", "origin", url]);
  expect(await git(["remote", "get-url", "origin"])).toBe(
    "git@github.com:example/source",
  );
  expect(await git(["remote", "get-url", "origin"], true)).toBe(url);
  const header = `Authorization: Basic ${Buffer.from("x-access-token:git-test-token").toString("base64")}`;
  expect(
    await git(["config", "--get-urlmatch", "http.extraHeader", url], true),
  ).toBe(header);
  const config = fs.readFileSync(path.join(cwd, ".git/config"), "utf8");
  expect(config).not.toContain("git-test-token");
  expect(config).not.toContain(header);
});

it("authenticates remote cache operations without exposing the token through argv or failures", async () => {
  secretsStore.setSecret(DEFAULT_GITHUB_TOKEN_REF, "cache-test-token");
  const run = vi.fn(async (_command: string, args: string[]) => ({
    code: args.includes("ls-remote") ? 1 : 0,
    stdout: "",
    stderr: "cache-test-token authorization denied",
    timedOut: false,
    stderrTruncated: false,
  }));
  await expect(
    repositoryCache(
      "https://github.com/example/source",
      path.join(root, "cache"),
      run,
      10000,
    ),
  ).rejects.toThrow("无法获取或校验");
  const remote = run.mock.calls.find(([, args]) => args.includes("ls-remote"))!;
  expect(JSON.stringify(remote.slice(0, 2))).not.toContain("cache-test-token");
  expect((remote as any)[6].env.GIT_CONFIG_VALUE_3).toContain(
    "Authorization: Basic",
  );
  secretsStore.deleteSecret(DEFAULT_GITHUB_TOKEN_REF);
  expect(gitHubAuthentication("https://github.com/example/source")).toEqual({});
});

it('uses the default token for existing GitHub API collection without forwarding it through redirects', async () => {
  const { GithubApiCollectorAdapter } = await import('../src/modules/collection/collectors/github_api/adapter.js');
  const { SafeHttpClient } = await import('../src/infrastructure/http/client.js');
  secretsStore.setSecret(DEFAULT_GITHUB_TOKEN_REF, 'release-test-token');
  const fetch = vi.spyOn(SafeHttpClient, 'fetch').mockResolvedValue({ status: 200, text: '[]', data: Buffer.from('[]'), url: 'https://api.github.com/repos/example/source/releases', headers: {}, notModified: false });
  const result = await new GithubApiCollectorAdapter().collect({ run_id: 'test', source_id: 'source', source_revision: 'v1', capability_id: 'github_api', operation: 'discover', target: { url: 'https://github.com/example/source' }, scope: { limit: 10 }, state: null, options: {}, budget: { max_requests: 10, timeout_seconds: 10 } });
  expect(result.status).toBe('success');
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer release-test-token' }), maxRedirects: 0 }));
});
