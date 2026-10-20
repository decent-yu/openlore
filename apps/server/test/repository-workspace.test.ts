import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  ExecutorConfigSchema,
  RepositoryCheckoutSchema,
  RepositoryTargetSchema,
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
const metadata=JSON.parse(fs.readFileSync('input/repository.json','utf8'));
const citation=metadata.url+'/blob/'+metadata.commit+'/src/core.ts#L1';
const report='# Code research\\n'+source+'\\n'+caller+'\\n'+test+'\\n'+citation;

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

it("prepares default-branch source including callers and tests", async () => {
  const folder = workspace();
  await actualPrepare({ url: repositoryUrl, commit }, folder, mappedRun, 10000);
  expect(
    fs.readFileSync(path.join(folder, "input/repository/src/core.ts"), "utf8"),
  ).toContain("new-version");
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
  ).toMatchObject({ url: repositoryUrl });
  await actualPrepare(
    { url: repositoryUrl, commit },
    folder,
    mappedRun,
    10000,
    undefined,
    true,
  );
  fs.writeFileSync(path.join(folder, 'input/repository/src/core.ts'), 'modified');
  await expect(actualPrepare({ url: repositoryUrl }, folder, mappedRun, 10000, undefined, true)).resolves.toBeTruthy();
});

it("discovers and packages the standalone Skill for synced and local execution", () => {
  const found = scanSkillDirectory(path.resolve("../../skills")).find(
    (item) => item.skill.id === GITHUB_CODE_RESEARCH_SKILL,
  )!;
  expect(found.skill.type).toBe("research");
  expect(found.bundle.files.some((file) => file.path === "SKILL.md")).toBe(
    true,
  );
  expect(found.bundle.files.map(file => file.path)).toEqual(expect.arrayContaining(['SKILL.md', 'references/research-method.md', 'references/visual_and_assets_guide.md', 'scripts/audit-svg.sh']));
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
  expect(result.result).toContain("new-version");
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
  vi.spyOn(preparation, 'prepareRepositoryWorkspace').mockImplementation((repo, folder, _run, timeout, signal, resume) => actualPrepare(repo, folder, mappedRun, timeout, signal, resume));
  const cli = path.join(root, 'no-report-cli');
  fs.writeFileSync(cli, `#!${process.execPath}\nconsole.log(JSON.stringify({response:'I could not research the source.'}));`, {mode: 0o700});
  const result = await executeInWorkspace({...request(), cli_path: cli});
  expect(result.status).toBe('failed');
  expect(result.error?.message).toContain('未生成有效的 output/research.md');
});

it('accepts generated reports without a post-generation source or evidence audit', async () => {
  vi.spyOn(preparation, 'prepareRepositoryWorkspace').mockImplementation((repo, folder, _run, timeout, signal, resume) => actualPrepare(repo, folder, mappedRun, timeout, signal, resume));
  const cli = path.join(root, 'modifies-source-cli');
  fs.writeFileSync(cli, `#!${process.execPath}\nconst fs=require('fs');fs.writeFileSync('input/repository/src/core.ts','changed');fs.writeFileSync('output/research.md','# Report');console.log(JSON.stringify({response:'Done'}));`, {mode:0o700});
  const result = await executeInWorkspace({...request(), cli_path:cli});
  expect(result.status).toBe('success');
  expect(result.result).toBe('# Report');
});

it('resolves a changed remote default branch, refreshes cached objects and preserves existing research snapshots', async () => {
  const { repositoryCache } = await import('../src/infrastructure/ai/repository_cache.js');
  const cacheRoot = path.join(root, 'cache-default-test');
  const countedRun = vi.fn(mappedRun);
  const first = await repositoryCache(repositoryUrl, cacheRoot, countedRun, 10000);
  const folder = workspace();
  await actualPrepare({ url: repositoryUrl, commit: first.commit }, folder, mappedRun, 10000);
  await runProcess('git', ['checkout', '-b', 'architecture-next'], source, '', 10000);
  fs.writeFileSync(path.join(source, 'src/core.ts'), 'export const implementation = "latest-default";');
  const changed = await runProcess('git', ['commit', '--quiet', '-am', 'Ordinary fix, not a research topic'], source, '', 10000);
  expect(changed.code).toBe(0);
  const next = await repositoryCache(repositoryUrl, cacheRoot, countedRun, 10000);
  expect(next.cache).toBe(first.cache);
  expect(next.branch).toBe('architecture-next');
  expect(next.commit).not.toBe(first.commit);
  expect(fs.readFileSync(path.join(folder, 'input/repository/src/core.ts'), 'utf8')).toContain('new-version');
  const fetches = countedRun.mock.calls.filter(([, args]) => args.includes('fetch')).length;
  await repositoryCache(repositoryUrl, cacheRoot, countedRun, 10000);
  expect(countedRun.mock.calls.filter(([, args]) => args.includes('fetch'))).toHaveLength(fetches + 1);
});

it('delivers the user goal and full accepted history into the AI workspace and binds them to the session', async () => {
  vi.spyOn(preparation, 'prepareRepositoryWorkspace').mockImplementation((repo, folder, _run, timeout, signal, resume) => actualPrepare(repo, folder, mappedRun, timeout, signal, resume));
  const base = request();
  const context = { source_id: 'source', name: 'Example', repository_url: repositoryUrl, goal: '理解架构与执行机制', history: [{ id: 'earlier', article_id: 'article', title: '整体架构', commit, questions: ['入口怎样连接核心实现？'], report_markdown: '# 完整历史研报\n不能只依赖这篇结论', archived_at: '2026-10-20T00:00:00Z' }] };
  const input = { ...base, input: { ...base.input, repository_context: context } };
  const result = await executeInWorkspace(input);
  expect(result.status).toBe('success');
  expect(JSON.parse(fs.readFileSync(path.join(result.execution!.workspace, 'input/research-context.json'), 'utf8'))).toEqual(context);
  expect(sessionBinding(input, input.input.skillBundle)).not.toBe(sessionBinding({ ...input, input: { ...input.input, repository_context: { ...context, goal: '新的目标' } } }, input.input.skillBundle));
});

it('audits valid SVG variants without enforcing dimensions, layout or path syntax, and catches malformed XML', async () => {
  const folder = fs.mkdtempSync(path.join(root, 'svg-'));
  fs.writeFileSync(path.join(folder, 'free.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="400"><defs><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter><marker id="arrow" markerWidth="4" markerHeight="4"><path d="M0 0 L4 2 L0 4"/></marker></defs><g transform="scale(1,2)"><path d="M1 2L3 4 M5 6L7 8" marker-end="url(#arrow)"/><text letter-spacing="1">CUSTOM VIEW</text></g></svg>`);
  for (const skill of ['github-code-research', 'deep-research-expert']) {
    const script = path.resolve(`../../skills/${skill}/scripts/audit-svg.sh`);
    expect((await runProcess('bash', [script, folder], root, '', 10000)).code).toBe(0);
  }
  fs.writeFileSync(path.join(folder, 'broken.svg'), '<svg><g></svg>');
  expect((await runProcess('bash', [path.resolve('../../skills/github-code-research/scripts/audit-svg.sh'), folder], root, '', 10000)).code).toBe(1);
});


it('resolves the default branch on the executor, returns its actual Commit and pins a resumed workspace', async () => {
  const base = request();
  vi.spyOn(preparation, 'prepareRepositoryWorkspace').mockImplementation((repo, folder, _run, timeout, signal, resume) => actualPrepare(repo, folder, mappedRun, timeout, signal, resume));
  expect(RepositoryTargetSchema.safeParse({ url: repositoryUrl }).success).toBe(true);
  const result = await executeInWorkspace({ ...base, input: { ...base.input, repository: { url: repositoryUrl } } });
  expect(result.status).toBe('success');
  expect(result.repository?.url).toBe(repositoryUrl);
  expect(result.repository?.commit).toMatch(/^[a-f0-9]{40}$/);
  expect(result.repository?.commit).not.toBe(commit);
  expect(result.execution?.prompt).toBe(base.input.prompt);
  const folder = result.execution!.workspace;
  expect(fs.readFileSync(path.join(folder, 'input/article.md'), 'utf8')).toContain(result.repository!.commit);
  const resumed = await actualPrepare({ url: repositoryUrl }, folder, mappedRun, 10000, undefined, true);
  expect(resumed).toEqual(result.repository);
});


it('accepts a report even if the CLI exits with an error and no evidence file exists', async () => {
  vi.spyOn(preparation, 'prepareRepositoryWorkspace').mockImplementation((repo, folder, _run, timeout, signal, resume) => actualPrepare(repo, folder, mappedRun, timeout, signal, resume));
  const cli = path.join(root, 'saved-report-cli');
  fs.writeFileSync(cli, `#!${process.execPath}\nconst fs=require('fs');fs.writeFileSync('output/research.md','# Architecture\\nThe execution path is explained here.');console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:3,cached_input_tokens:6}}));process.exit(1);`, {mode:0o700});
  const result = await executeInWorkspace({...request(), provider:'codex_cli', cli_path:cli});
  expect(result.status).toBe('success');
  expect(result.usage).toMatchObject({promptTokens:10,completionTokens:3,totalTokens:13,cachedTokens:6});
  expect(result.notice).toContain('已接纳保存的研报');
  expect(result.result).toContain('Architecture');
  expect(result.diagnostics?.exit_code).toBe(1);
  expect(result.artifacts?.some(file=>file.path==='evidence.json')).toBe(false);
});
