import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  ExecutorConfigSchema,
  RepositoryCheckoutSchema,
  GITHUB_CODE_RESEARCH_SKILL,
} from "@openlore/contracts";
import {
  runProcess,
  executeInWorkspace,
} from "../src/infrastructure/ai/workspace_runner.js";
import * as preparation from "../src/infrastructure/ai/repository_workspace.js";
import {
  readSkillBundle,
  scanSkillDirectory,
} from "../src/infrastructure/ai/skill_bundle.js";
import { sessionBinding } from "../src/infrastructure/ai/workspace_session.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "openlore-code-study-"));
const source = path.join(root, "source repo");
const repositoryUrl = "https://github.com/example/source";
const actualPrepare = preparation.prepareRepositoryWorkspace;
const mappedRun: typeof runProcess = (command, args, ...rest) =>
  runProcess(
    command,
    args.map((value) => (value === repositoryUrl ? source : value)),
    ...rest,
  );
let commit: string;
let fakeCli: string;
beforeAll(async () => {
  fs.mkdirSync(source);
  const git = async (args: string[]) => {
    const result = await runProcess("git", args, source, "", 10000);
    expect(result.code).toBe(0);
    return result.stdout.trim();
  };
  await git(["init", "--quiet"]);
  await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.com"]);
  fs.mkdirSync(path.join(source, "src"));
  fs.mkdirSync(path.join(source, "tests"));
  fs.writeFileSync(
    path.join(source, "src/core.ts"),
    'export const implementation = "pinned-original";',
  );
  fs.writeFileSync(
    path.join(source, "src/caller.ts"),
    'import { implementation } from "./core";',
  );
  fs.writeFileSync(
    path.join(source, "tests/core.test.ts"),
    'assert(implementation === "pinned-original");',
  );
  await git(["add", "."]);
  await git(["commit", "--quiet", "-m", "Initial implementation"]);
  commit = await git(["rev-parse", "HEAD"]);
  fs.writeFileSync(
    path.join(source, "src/core.ts"),
    'export const implementation = "new-version";',
  );
  await git(["commit", "--quiet", "-am", "Later change"]);
  fakeCli = path.join(root, "fake-gemini");
  fs.writeFileSync(
    fakeCli,
    `#!${process.execPath}
const fs=require('fs');
const source=fs.readFileSync('input/repository/src/core.ts','utf8');
const caller=fs.readFileSync('input/repository/src/caller.ts','utf8');
const test=fs.readFileSync('input/repository/tests/core.test.ts','utf8');
const report='# Code research\\n'+source+'\\n'+caller+'\\n'+test;
fs.writeFileSync('output/research.md',report);
console.log(JSON.stringify({response:'The report is saved.'}));
`,
    { mode: 0o700 },
  );
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const workspace = () => {
  const folder = fs.mkdtempSync(path.join(root, "work-"));
  fs.mkdirSync(path.join(folder, "input"));
  return folder;
};

it("prepares the pinned source tree including callers and tests, rather than the branch head or supplied sample", async () => {
  const folder = workspace();
  await actualPrepare({ url: repositoryUrl, commit }, folder, mappedRun, 10000);
  expect(
    fs.readFileSync(path.join(folder, "input/repository/src/core.ts"), "utf8"),
  ).toContain("pinned-original");
  expect(
    fs.existsSync(path.join(folder, "input/repository/src/caller.ts")),
  ).toBe(true);
  expect(
    fs.existsSync(path.join(folder, "input/repository/tests/core.test.ts")),
  ).toBe(true);
  expect(
    JSON.parse(
      fs.readFileSync(path.join(folder, "input/repository.json"), "utf8"),
    ),
  ).toMatchObject({ url: repositoryUrl, commit });
  await actualPrepare(
    { url: repositoryUrl, commit },
    folder,
    mappedRun,
    10000,
    undefined,
    true,
  );
  fs.writeFileSync(
    path.join(folder, "input/repository/src/core.ts"),
    "modified",
  );
  await expect(
    actualPrepare(
      { url: repositoryUrl, commit },
      folder,
      mappedRun,
      10000,
      undefined,
      true,
    ),
  ).rejects.toThrow("源码工作区已修改");
});

it("rejects unpinned and non-GitHub targets before fetching", async () => {
  expect(
    RepositoryCheckoutSchema.safeParse({ url: repositoryUrl, commit: "main" })
      .success,
  ).toBe(false);
  expect(
    RepositoryCheckoutSchema.safeParse({ url: "file:///tmp/source", commit })
      .success,
  ).toBe(false);
  const run = vi.fn();
  await expect(
    actualPrepare(
      { url: repositoryUrl, commit: "main" },
      workspace(),
      run,
      10000,
    ),
  ).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});

it("stops on an unavailable commit and propagates cancellation", async () => {
  await expect(
    actualPrepare(
      { url: repositoryUrl, commit: "f".repeat(40) },
      workspace(),
      mappedRun,
      10000,
    ),
  ).rejects.toThrow("无法获取或校验");
  const abort = new AbortController();
  abort.abort();
  const run = vi.fn();
  await expect(
    actualPrepare(
      { url: repositoryUrl, commit },
      workspace(),
      run,
      10000,
      abort.signal,
    ),
  ).rejects.toThrow("已取消或超时");
  expect(run).not.toHaveBeenCalled();
});

it("discovers and packages the standalone Skill for synced and local execution", () => {
  const found = scanSkillDirectory(path.resolve("../../skills")).find(
    (item) => item.skill.id === GITHUB_CODE_RESEARCH_SKILL,
  )!;
  expect(found.skill.type).toBe("research");
  expect(found.bundle.files.some((file) => file.path === "SKILL.md")).toBe(
    true,
  );
  expect(found.bundle.files).toHaveLength(1);
});

function request() {
  return {
    provider: "gemini_cli" as const,
    cli_path: fakeCli,
    config: ExecutorConfigSchema.parse({
      workspace_root: path.join(root, "runner"),
      timeout_seconds: 10,
    }),
    input: {
      jobId: "code",
      profileId: "test",
      taskType: "research_report" as const,
      skillId: GITHUB_CODE_RESEARCH_SKILL,
      skillBundle: readSkillBundle(
        GITHUB_CODE_RESEARCH_SKILL,
        path.resolve("../../skills/github-code-research"),
      ),
      prompt: "Read the pinned implementation, caller and test.",
      material: "Only README sampling hints.",
      repository: { url: repositoryUrl, commit },
    },
  };
}

it("makes full source available before the CLI and collects the dedicated research document", async () => {
  vi.spyOn(preparation, "prepareRepositoryWorkspace").mockImplementation(
    (repo, folder, _run, timeout, signal, resume) =>
      actualPrepare(repo, folder, mappedRun, timeout, signal, resume),
  );
  const input = request();
  const result = await executeInWorkspace(input);
  expect(result.status).toBe("success");
  expect(result.execution?.skill_id).toBe(GITHUB_CODE_RESEARCH_SKILL);
  expect(result.result).toContain("pinned-original");
  expect(result.result).not.toContain("new-version");
  expect(result.result).toContain("import { implementation }");
  expect(result.artifacts?.some((file) => file.path === "research.md")).toBe(
    true,
  );
  expect(sessionBinding(input, input.input.skillBundle)).not.toBe(
    sessionBinding(
      {
        ...input,
        input: {
          ...input.input,
          repository: { url: repositoryUrl, commit: "f".repeat(40) },
        },
      },
      input.input.skillBundle,
    ),
  );
});

it("does not invoke the AI when full source preparation fails or the article Skill is used for code", async () => {
  vi.spyOn(preparation, "prepareRepositoryWorkspace").mockRejectedValue(
    new Error("repository inaccessible"),
  );
  const result = await executeInWorkspace(request());
  expect(result.status).toBe("failed");
  expect(result.error?.message).toContain("repository inaccessible");
  const mismatched = request();
  mismatched.input.skillId = "deep-research-expert";
  mismatched.input.skillBundle = readSkillBundle(
    "deep-research-expert",
    path.resolve("../../skills/deep-research-expert"),
  );
  expect((await executeInWorkspace(mismatched)).error?.message).toContain(
    "代码深研必须使用",
  );
});

it('requires a written research document instead of accepting a conversational response as a code report', async () => {
  vi.spyOn(preparation, 'prepareRepositoryWorkspace').mockResolvedValue();
  const cli = path.join(root, 'no-report-cli');
  fs.writeFileSync(cli, `#!${process.execPath}\nconsole.log(JSON.stringify({response:'I could not research the source.'}));`, {mode: 0o700});
  const result = await executeInWorkspace({...request(), cli_path: cli});
  expect(result.status).toBe('failed');
  expect(result.error?.message).toContain('未生成有效的 output/research.md');
});
