import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  initDatabase,
  getSqliteDatabase,
} from "../src/infrastructure/persistence/sqlite/db.js";
import { collectionService } from "../src/modules/collection/service.js";
import { groupsService } from "../src/modules/groups/service.js";
import { processingService } from "../src/modules/processing/service.js";
import { skillsService } from "../src/modules/skills/service.js";
import { releaseResearchClaims } from "../src/modules/research/state.js";
import * as ai from "../src/infrastructure/ai/fallback_runner.js";

const evidence =
  "Detailed implementation choices, measurable performance and reproducible experiments.";
const execute = vi.fn(async (input: any) => ({
  status: "success" as const,
  provider: "mock",
  model: "mock",
  durationMs: 0,
  result: {
    selected: JSON.parse(input.material)
      .sort(
        (a: any, b: any) =>
          Number(b.title.split(" ")[1]) - Number(a.title.split(" ")[1]),
      )
      .slice(0, 3)
      .map((item: any) => ({
        article_id: item.article_id,
        reason: "Matches this research direction",
      })),
  },
}));
beforeAll(() => initDatabase());
beforeEach(() => {
  const db = getSqliteDatabase();
  db.exec(
    "DELETE FROM research_claims; DELETE FROM research_tasks; DELETE FROM group_items; DELETE FROM source_items; DELETE FROM article_revisions; DELETE FROM articles; DELETE FROM groups",
  );
  execute.mockClear();
  vi.spyOn(ai, "getAIAdapterWithFallback").mockReturnValue({
    execute,
    testConnection: async () => ({ ok: true, message: "" }),
  });
  vi.spyOn(skillsService, "getSkill").mockImplementation(async (id) => ({
    id,
    name: id,
    type: "selection",
    description: "",
    tags: [],
    file_path: "",
    system_prompt: "",
  }));
});
afterEach(() => vi.restoreAllMocks());
function add(
  index: number,
  reviewed = true,
  summary = "Methods and measured conclusions",
) {
  const id = collectionService.persistContentItem({
    source_item_id: String(index),
    source_id: "source",
    canonical_url: `https://example.com/${index}`,
    title: `Article ${index}`,
    published_at: index % 2 ? "2020-01-01" : null,
    body: { value: evidence, format: "text", completeness: "full" },
    attachments: [],
    fetched_at: new Date().toISOString(),
    fetch_method: "test",
    issues: [],
  });
  if (reviewed)
    getSqliteDatabase()
      .prepare(
        "UPDATE article_reviews SET status='succeeded',result_json=? WHERE article_id=?",
      )
      .run(
        JSON.stringify({
          quality: 80,
          positioning: "Engineering",
          summary,
          tags: ["systems"],
          reason: "Evidence",
          evidence_refs: [evidence],
        }),
        id,
      );
  return id;
}
async function group(m = 3) {
  getSqliteDatabase().prepare("INSERT OR IGNORE INTO sources(id,name,url) VALUES ('source','Source','https://example.com/feed')").run();
  return groupsService.saveGroup({
    id: "task",
    name: "Engineering",
    repository_connection_id: "repo",
    base_path: "docs/engineering",
    source_ids: ["source"],
    deep_analysis_count: m,
  });
}

it("compares the entire reviewed pool in one AI call, excluding archived, busy and unreviewed articles without date caps", async () => {
  const ids = Array.from({ length: 53 }, (_, i) => add(i, i !== 52));
  const db = getSqliteDatabase();
  db.prepare(
    "INSERT INTO research_tasks(id,group_id,article_id,revision_hash,status,archived_at) VALUES ('archived','other',?,'r','succeeded','2026-10-19')",
  ).run(ids[50]);
  db.prepare(
    "INSERT INTO research_claims(article_id,group_id,owner_id,created_at) VALUES (?,'other','busy','2026-10-19')",
  ).run(ids[51]);
  const result = await processingService.runProcessingForGroup(
    await group(),
    "owner",
  );
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][0].taskType).toBe("select");
  expect(execute.mock.calls[0][0].outputSchema).toMatchObject({
    additionalProperties: false,
    properties: { selected: { items: { additionalProperties: false } } },
  });
  expect(JSON.parse(execute.mock.calls[0][0].material)).toHaveLength(50);
  expect(result.entries.map((entry) => entry.article_id)).toEqual([
    ids[49],
    ids[48],
    ids[47],
  ]);
  expect(result.counts).toMatchObject({
    observed: 53,
    candidate: 50,
    already_processed: 2,
    unreviewed: 1,
    planned: 3,
    deferred: 47,
  });
  expect(execute.mock.calls[0][0].material).not.toContain(evidence); // Only review digests go to selection.
  releaseResearchClaims("owner");
});

it("batches oversized candidate digests, then compares finalists without silently truncating candidates", async () => {
  const ids = Array.from({ length: 100 }, (_, i) =>
    add(i, true, "Relevant mechanisms and limitations. ".repeat(35)),
  );
  const result = await processingService.runProcessingForGroup(
    await group(),
    "owner",
  );
  expect(execute.mock.calls.length).toBeGreaterThan(2);
  const seen = new Set(
    execute.mock.calls.flatMap(([input]) =>
      JSON.parse(input.material).map((item: any) => item.article_id),
    ),
  );
  expect(seen.size).toBe(100);
  expect(result.entries.map((entry) => entry.article_id)).toEqual([
    ids[99],
    ids[98],
    ids[97],
  ]);
  expect(result.entries).toHaveLength(3);
  releaseResearchClaims("owner");
});

it.each([
  { selected: [{ article_id: "unknown", reason: "Unknown" }] },
  { duplicate: true },
  { tooMany: true },
])(
  "rejects an invalid selection before claiming any article: %j",
  async (invalid) => {
    const ids = [add(1), add(2)];
    const selected =
      "duplicate" in invalid
        ? [
            { article_id: ids[0], reason: "A" },
            { article_id: ids[0], reason: "B" },
          ]
        : "tooMany" in invalid
          ? ids.map((article_id) => ({ article_id, reason: "A" }))
          : invalid.selected;
    execute.mockResolvedValueOnce({
      status: "success",
      provider: "mock",
      model: "mock",
      durationMs: 0,
      result: { selected },
    } as any);
    await expect(
      processingService.runProcessingForGroup(await group(1), "owner"),
    ).rejects.toThrow("选文结果无效");
    expect(
      getSqliteDatabase()
        .prepare("SELECT count(*) n FROM research_claims")
        .get(),
    ).toEqual({ n: 0 });
  },
);

it("does not fill an empty AI selection or call AI when M is zero", async () => {
  add(1);
  execute.mockResolvedValueOnce({
    status: "success",
    provider: "mock",
    model: "mock",
    durationMs: 0,
    result: { selected: [] },
  });
  expect(
    (await processingService.runProcessingForGroup(await group(), "empty"))
      .entries,
  ).toEqual([]);
  execute.mockClear();
  expect(
    (await processingService.runProcessingForGroup(await group(0), "zero"))
      .entries,
  ).toEqual([]);
  expect(execute).not.toHaveBeenCalled();
});
