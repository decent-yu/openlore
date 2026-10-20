import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import type { RepositoryCheckout } from "@openlore/contracts";
import { safeRelativePath } from "./skill_bundle.js";

const evidenceSchema = z.object({
  complete: z.literal(true),
  commit: z.string(),
  questions: z.array(z.string().trim().min(1)).min(1),
  citations: z
    .array(
      z.object({
        claim: z.string().trim().min(1),
        file: z.string().min(1),
        start_line: z.number().int().positive(),
        end_line: z.number().int().positive(),
        quote: z.string().min(1),
      }),
    )
    .min(1),
});
/** Validate delivered evidence against the same tracked snapshot used by the researcher. */
export function validateRepositoryEvidence(
  repository: RepositoryCheckout,
  workspace: string,
  report: string,
): void {
  const evidencePath = path.join(workspace, "output/evidence.json");
  if (
    !fs.existsSync(evidencePath) ||
    fs.lstatSync(evidencePath).isSymbolicLink()
  )
    throw new Error("代码研读缺少源码证据 output/evidence.json");
  const parsed = evidenceSchema.safeParse(
    JSON.parse(fs.readFileSync(evidencePath, "utf8")),
  );
  if (!parsed.success)
    throw new Error("关键源码证据不足或格式无效，研读不能标记完成");
  const evidence = parsed.data;
  if (evidence.commit !== repository.commit)
    throw new Error("源码证据 Commit 不匹配");
  const root = fs.realpathSync(path.join(workspace, "input/repository"));
  let implementation = false;
  for (const citation of evidence.citations) {
    const relative = safeRelativePath(citation.file);
    // Check only the cited Git object. Enumerating all paths can overflow buffers
    // in mature repositories (Orca currently has more than 38,000 tracked files).
    let tracked = false;
    try {
      tracked =
        execFileSync(
          "git",
          [
            "-c",
            "core.hooksPath=/dev/null",
            "cat-file",
            "-t",
            `${repository.commit}:${relative}`,
          ],
          {
            cwd: root,
            encoding: "utf8",
            timeout: 10000,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ).trim() === "blob";
    } catch {
      /* Missing paths are reported as invalid evidence below. */
    }
    if (!tracked) throw new Error("引用文件不属于本次跟踪源码");
    if (relative.split("/").some((part) => part === ".git"))
      throw new Error("不能引用 Git 元数据");
    const file = path.join(root, relative);
    const resolved = fs.realpathSync(file);
    if (
      resolved !== file ||
      !resolved.startsWith(`${root}${path.sep}`) ||
      !fs.statSync(resolved).isFile()
    )
      throw new Error("源码证据路径无效");
    const lines = fs.readFileSync(resolved, "utf8").split("\n");
    if (
      citation.end_line < citation.start_line ||
      citation.end_line > lines.length ||
      lines.slice(citation.start_line - 1, citation.end_line).join("\n") !==
        citation.quote
    )
      throw new Error(`源码证据行号或原文不匹配：${relative}`);
    const url = `${repository.url}/blob/${repository.commit}/${relative.split("/").map(encodeURIComponent).join("/")}#L${citation.start_line}`;
    if (!report.includes(url))
      throw new Error(`研报缺少对应源码行号链接：${relative}`);
    if (
      !/\.(md|mdx|rst|txt|json|ya?ml|toml|lock)$/i.test(relative) &&
      !/(^|\/)(docs?|tests?|__tests__)(\/|$)|\.(test|spec)\./i.test(relative)
    )
      implementation = true;
  }
  if (!implementation)
    throw new Error("关键证据不足：需要核心实现源码，不能仅引用文档或测试");
}
