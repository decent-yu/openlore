import fs from "node:fs";
import path from "node:path";
import {
  RepositoryCheckoutSchema,
  parseGitHubRepository,
  type RepositoryCheckout,
} from "@openlore/contracts";
import { repositoryCache } from "./repository_cache.js";
import { getAppPaths } from "../config/paths.js";
import type { runProcess } from "./workspace_runner.js";

/** Fetch the complete tracked source tree at a pinned commit before the AI starts. */
export async function prepareRepositoryWorkspace(
  repository: RepositoryCheckout,
  workspace: string,
  run: typeof runProcess,
  timeoutMs: number,
  signal?: AbortSignal,
  resume = false,
): Promise<void> {
  const checked = RepositoryCheckoutSchema.parse(repository);
  const url = parseGitHubRepository(checked.url)!.url;
  const target = path.join(workspace, "input", "repository");
  const metadataPath = path.join(workspace, "input", "repository.json");
  const deadline = Date.now() + timeoutMs;
  const hooks = path.join(workspace, ".disabled-git-hooks");
  fs.mkdirSync(hooks, { recursive: true });
  const git = async (args: string[]) => {
    if (signal?.aborted || Date.now() >= deadline)
      throw new Error("源码准备已取消或超时");
    const result = await run(
      "git",
      [
        "-c",
        `core.hooksPath=${hooks}`,
        "-c",
        "advice.detachedHead=false",
        ...args,
      ],
      target,
      "",
      Math.max(1, deadline - Date.now()),
      signal,
      {
        env: { GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
      },
    );
    if (result.code !== 0 || result.timedOut)
      throw new Error(
        "无法获取或校验固定 Commit 的完整源码，请检查执行机 Git、网络与仓库读取权限；私有仓库需要执行机自身的 Git 读取凭据",
      );
    return result.stdout.trim();
  };
  if (resume) {
    if (
      !fs.existsSync(target) ||
      fs.lstatSync(target).isSymbolicLink() ||
      fs.lstatSync(metadataPath).isSymbolicLink()
    )
      throw new Error("会话源码目录缺失或无效");
    const saved = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (saved.url !== url || saved.commit !== checked.commit)
      throw new Error("会话仓库或 Commit 已变化");
  } else {
    const cached = await repositoryCache(
      url,
      path.join(getAppPaths().dataDir, "repository-cache"),
      run,
      Math.max(1, deadline - Date.now()),
      checked.commit,
      signal,
    );
    const cloned = await run(
      "git",
      [
        "-c",
        `core.hooksPath=${hooks}`,
        "clone",
        "--quiet",
        "--no-checkout",
        "--local",
        cached.cache,
        target,
      ],
      workspace,
      "",
      Math.max(1, deadline - Date.now()),
      signal,
    );
    if (cloned.code !== 0 || cloned.timedOut)
      throw new Error("无法创建源码快照");
    await git([
      "-c",
      "filter.lfs.smudge=",
      "-c",
      "filter.lfs.required=false",
      "checkout",
      "--quiet",
      "--detach",
      checked.commit,
    ]);
  }
  if ((await git(["rev-parse", "HEAD"])) !== checked.commit)
    throw new Error("源码 Commit 与调研任务不匹配");
  if (await git(["status", "--porcelain", "--untracked-files=no"]))
    throw new Error("源码工作区已修改，拒绝使用非固定版本的代码");
  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        url,
        commit: checked.commit,
        directory: "input/repository",
        submodules_fetched: false,
        lfs_fetched: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
