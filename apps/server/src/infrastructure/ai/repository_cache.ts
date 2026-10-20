import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseGitHubRepository } from "@openlore/contracts";
import type { runProcess } from "./workspace_runner.js";

/** Git's immutable objects are shared locally; each research workspace has its own checkout. */
export async function repositoryCache(
  url: string,
  root: string,
  run: typeof runProcess,
  timeoutMs: number,
  commit?: string,
  signal?: AbortSignal,
): Promise<{ cache: string; commit: string; branch?: string }> {
  if (!parseGitHubRepository(url)) throw new Error("请输入 GitHub 仓库根地址");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const cache = path.join(
    root,
    crypto.createHash("sha256").update(url).digest("hex"),
  );
  const lock = `${cache}.lock`;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal?.aborted || Date.now() >= deadline)
      throw new Error("源码准备已取消或超时");
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner"), String(process.pid));
      break;
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = Number(fs.readFileSync(path.join(lock, "owner"), "utf8"));
        if (!Number.isInteger(owner) || owner <= 0)
          throw new Error("Invalid cache lock");
        try {
          process.kill(owner, 0);
        } catch (error: any) {
          if (error.code === "ESRCH")
            fs.rmSync(lock, { recursive: true, force: true });
        }
      } catch (error: any) {
        if (
          error.code === "ENOENT" &&
          fs.existsSync(lock) &&
          Date.now() - fs.statSync(lock).mtimeMs > 10000
        )
          fs.rmSync(lock, { recursive: true, force: true });
      }
      await delay(50, undefined, { signal });
    }
  }
  const git = async (args: string[], cwd = cache) => {
    if (signal?.aborted || Date.now() >= deadline)
      throw new Error("源码准备已取消或超时");
    const result = await run(
      "git",
      ["-c", "core.hooksPath=/dev/null", ...args],
      cwd,
      "",
      Math.max(1, deadline - Date.now()),
      signal,
      { env: { GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" } },
    );
    if (result.code !== 0 || result.timedOut)
      throw new Error(
        `无法获取或校验完整源码，请检查 Git、网络与仓库读取权限；私有仓库使用执行机自身的 Git 凭据：${result.stderr.slice(-500)}`,
      );
    return result.stdout.trim();
  };
  try {
    if (!fs.existsSync(path.join(cache, "HEAD"))) {
      fs.mkdirSync(cache, { recursive: true });
      await git(["init", "--bare", "--quiet"]);
    }
    if (commit) {
      const found = await run(
        "git",
        ["cat-file", "-e", `${commit}^{commit}`],
        cache,
        "",
        Math.max(1, deadline - Date.now()),
        signal,
      );
      if (found.code !== 0)
        await git([
          "fetch",
          "--quiet",
          "--depth=1",
          "--no-tags",
          "--no-recurse-submodules",
          url,
          commit,
        ]);
      await git(["update-ref", `refs/heads/openlore-${commit}`, commit]);
      return { cache, commit };
    }
    // Resolve remote HEAD on every new investigation, including default-branch changes.
    const head = await git(["ls-remote", "--symref", url, "HEAD"]);
    const branch = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(head)?.[1];
    if (!branch) throw new Error("无法确定仓库真实默认分支");
    await git([
      "fetch",
      "--quiet",
      "--depth=1",
      "--no-tags",
      "--no-recurse-submodules",
      url,
      `+refs/heads/${branch}:refs/heads/openlore-default`,
    ]);
    const sha = await git([
      "rev-parse",
      "refs/heads/openlore-default^{commit}",
    ]);
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("仓库返回了无效 Commit");
    return { cache, commit: sha, branch };
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
