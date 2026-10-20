import fs from "node:fs";
import path from "node:path";
import {
  RepositoryCheckoutSchema,
  RepositoryTargetSchema,
  parseGitHubRepository,
  type RepositoryCheckout,
  type RepositoryTarget,
} from "@openlore/contracts";
import { repositoryCache } from "./repository_cache.js";
import { getAppPaths } from "../config/paths.js";
import type { runProcess } from "./workspace_runner.js";

/** Prepare readable default-branch source on the execution machine before research. */
export async function prepareRepositoryWorkspace(
  repository: RepositoryTarget,
  workspace: string,
  run: typeof runProcess,
  timeoutMs: number,
  signal?: AbortSignal,
  resume = false,
): Promise<RepositoryCheckout> {
  const checked = RepositoryTargetSchema.parse(repository);
  let prepared: RepositoryCheckout;
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
        "无法准备仓库源码，请检查执行机 Git、网络与仓库读取权限",
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
    if (saved.url !== url)
      throw new Error("会话仓库与当前任务不一致");
    prepared = RepositoryCheckoutSchema.parse(saved);
  } else {
    const cached = await repositoryCache(
      url,
      path.join(getAppPaths().dataDir, "repository-cache"),
      run,
      Math.max(1, deadline - Date.now()),
      signal,
    );
    prepared = RepositoryCheckoutSchema.parse({ url, commit: cached.commit, branch: cached.branch });
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
      cached.commit,
    ]);
  }
  fs.accessSync(target, fs.constants.R_OK);
  fs.readdirSync(target);
  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        url,
        commit: prepared.commit,
        branch: prepared.branch,
        directory: "input/repository",
        submodules_fetched: false,
        lfs_fetched: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return prepared;
}

/** Build source context on the execution machine, never on the control service. */
export function repositoryMaterial(workspace: string, repository: RepositoryCheckout, material: string): string {
  const root = path.join(workspace, "input/repository");
  const readme = fs.readdirSync(root).find(file => /^readme(?:\.md|\.rst|\.txt)?$/i.test(file) && fs.lstatSync(path.join(root, file)).isFile());
  const contents = readme && fs.statSync(path.join(root, readme)).size <= 1024 * 1024 ? fs.readFileSync(path.join(root, readme), "utf8") : "请在源码目录中查阅项目文档。";
  return `${material}\n\n默认分支：${repository.branch || "固定版本"}\nCommit：${repository.commit}\n完整源码：input/repository/\n\n## README\n${contents}`;
}
