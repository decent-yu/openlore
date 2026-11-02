import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  RepositoryCheckoutSchema,
  parseGitHubRepository,
  type RepositoryCheckout,
} from "@openlore/contracts";
import type { runProcess } from "./workspace_runner.js";

/** Fetch the complete tracked source tree at a pinned commit before the AI starts. */
export async function prepareRepositoryWorkspace(
  repository: RepositoryCheckout,
  workspace: string,
  run: typeof runProcess,
  timeoutMs: number,
  signal?: AbortSignal,
  resume = false,
  cacheDir?: string,
): Promise<void> {
  const checked = RepositoryCheckoutSchema.parse(repository);
  const url = parseGitHubRepository(checked.url)!.url;
  const target = path.join(workspace, "input", "repository");
  const metadataPath = path.join(workspace, "input", "repository.json");
  const deadline = Date.now() + timeoutMs;
  const hooks = path.join(workspace, ".disabled-git-hooks");
  const cache = cacheDir
    ? path.join(
        cacheDir,
        crypto
          .createHash("sha256")
          .update(url + checked.commit)
          .digest("hex"),
      )
    : undefined;
  let cached = false;
  fs.mkdirSync(hooks, { recursive: true });
  const git = async (args: string[], limit = deadline - Date.now()) => {
    if (signal?.aborted || Date.now() >= deadline)
      throw new Error("源码准备已取消或超时");
    const result = await run(
      "git",
      [
        "-c",
        `core.hooksPath=${hooks}`,
        "-c",
        "advice.detachedHead=false",
        "-c",
        "http.lowSpeedLimit=1000",
        "-c",
        "http.lowSpeedTime=30",
        ...args,
      ],
      target,
      "",
      Math.max(1, Math.min(limit, deadline - Date.now())),
      signal,
      {
        env: { GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
      },
    );
    if (result.code !== 0 || result.timedOut)
      throw Object.assign(
        new Error(
          `无法获取或校验固定 Commit 的完整源码（git ${args.find((arg) => ["init", "fetch", "checkout", "rev-parse", "status", "clone"].includes(arg))}${result.timedOut ? " 超时" : ` 退出码 ${result.code}`}）：${result.stderr.trim().slice(-1500) || "命令未完成"}；请检查执行机 Git、网络与读取权限`,
        ),
        {
          code: "repository_prepare_failed",
          retryable:
            result.timedOut ||
            /timed out|timeout|connection|resolve host|remote end hung up|early EOF|RPC failed|HTTP (?:429|5\d\d)/i.test(
              result.stderr,
            ),
        },
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
    fs.mkdirSync(target);
    await git(["init", "--quiet"]);
    if (
      cache &&
      fs.existsSync(cache) &&
      !fs.lstatSync(cache).isSymbolicLink()
    ) {
      try {
        await git([
          "fetch",
          "--quiet",
          "--depth=1",
          "--update-shallow",
          "--no-tags",
          "--no-recurse-submodules",
          cache,
          checked.commit,
        ]);
        cached = true;
      } catch {
        // A damaged cache must not strand the task; fetch the pinned source again.
      }
    }
    const fetchArgs = [
      "fetch",
      "--quiet",
      "--depth=1",
      "--no-tags",
      "--no-recurse-submodules",
      url,
      checked.commit,
    ];
    if (!cached) {
      for (let attempt = 0; ; attempt++) {
        try {
          await git(fetchArgs, 60000);
          break;
        } catch (error: any) {
          if (
            !error.retryable ||
            attempt >= 2 ||
            signal?.aborted ||
            Date.now() >= deadline
          )
            throw error;
        }
      }
    }
    await git([
      "-c",
      "filter.lfs.smudge=",
      "-c",
      "filter.lfs.required=false",
      "checkout",
      "--quiet",
      "--detach",
      "FETCH_HEAD",
    ]);
  }
  if ((await git(["rev-parse", "HEAD"])) !== checked.commit)
    throw new Error("源码 Commit 与调研任务不匹配");
  if (await git(["status", "--porcelain", "--untracked-files=no"]))
    throw new Error("源码工作区已修改，拒绝使用非固定版本的代码");
  if (cache && !cached && !fs.existsSync(cache)) {
    fs.mkdirSync(cacheDir!, { recursive: true, mode: 0o700 });
    const temporary = `${cache}-${crypto.randomUUID()}.tmp`;
    try {
      await git([
        "clone",
        "--quiet",
        "--bare",
        "--no-hardlinks",
        target,
        temporary,
      ]);
      // Concurrent attempts may have already published the same fixed snapshot.
      if (!fs.existsSync(cache)) fs.renameSync(temporary, cache);
    } catch {
      // Cache failure must not reject a source tree that has already passed validation.
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
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
