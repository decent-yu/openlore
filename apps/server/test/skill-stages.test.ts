import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  AITaskInput,
  AIResult,
} from '../src/infrastructure/ai/adapter.js';
import * as ai from '../src/infrastructure/ai/fallback_runner.js';
import {
  getSqliteDatabase,
  initDatabase,
} from '../src/infrastructure/persistence/sqlite/db.js';
import { groupsService } from '../src/modules/groups/service.js';
import { collectionService } from '../src/modules/collection/service.js';
import { processingService } from '../src/modules/processing/service.js';
import { researchService } from '../src/modules/research/service.js';
import { skillsService } from '../src/modules/skills/service.js';

describe('Separate review and research Skills', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'openlore-skill-stages-'),
  );
  const execute = vi.fn<(input: AITaskInput) => Promise<AIResult>>();
  let articleId = '';
  beforeAll(async () => {
    process.env.OPENLORE_DATA_DIR = dataDir;
    initDatabase();
    vi.spyOn(skillsService, 'getSkill').mockImplementation(async (id) => ({
      id,
      name: id,
      type: id === 'review-only' ? 'extraction' : 'research',
      description: '',
      tags: [],
      file_path: '',
      system_prompt:
        id === 'review-only' ? 'REVIEW_BASE_PROMPT' : 'RESEARCH_BASE_PROMPT',
    }));
    vi.spyOn(ai, 'getAIAdapterWithFallback').mockReturnValue({
      execute,
      testConnection: async () => ({ ok: true, message: '' }),
    });
    await groupsService.saveGroup({
      id: 'task',
      name: 'Agent Learning',
      description: 'Engineering',
      preferences: 'Prefer reproducible implementations',
      research_instructions: 'Explain the tradeoffs',
      assessment_skill_id: 'review-only',
      research_skill_id: 'research-only',
      repository_connection_id: 'repo',
      base_path: 'docs/skills',
      max_selected: 1,
      deep_analysis_count: 1,
    });
    articleId = await collectionService.persistContentItem({
      source_item_id: 'source-1',
      source_id: 'source',
      title: 'Agents',
      published_at: new Date().toISOString(),
      canonical_url: 'https://example.com/agents',
      body: {
        value: 'Engineering evidence and code',
        format: 'text',
        completeness: 'full',
      },
      attachments: [],
      fetched_at: new Date().toISOString(),
      fetch_method: 'test',
      issues: [],
    });
  });
  beforeEach(() => {
    getSqliteDatabase().exec(
      'DELETE FROM group_items; DELETE FROM research_tasks; DELETE FROM article_assessments',
    );
    execute
      .mockReset()
      .mockImplementation(async (input) => ({
        status: 'success',
        provider: 'mock',
        model: 'mock',
        durationMs: 0,
        result:
          input.taskType === 'assess'
            ? {
                relevance: 95,
                quality: 90,
                reason: 'Relevant',
                summary: 'Summary',
                evidence_refs: ['Engineering evidence and code'],
              }
            : '# Actual AI research',
      }));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    getSqliteDatabase().close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('calls the review Skill first, then the research Skill, with distinct prompts and no task digest', async () => {
    const group = (await groupsService.getGroup('task'))!;
    const result = await processingService.runProcessingForGroup(group, 'run');
    expect(result.entries).toHaveLength(1);
    expect(result.researchArticleIds).toEqual([articleId]);
    expect(execute).toHaveBeenCalledTimes(1);
    const review = execute.mock.calls[0][0];
    expect(review.runId).toBe('run');
    expect(review.groupId).toBe(group.id);
    expect(review.articleId).toBe(articleId);
    expect(review.skillId).toBe('review-only');
    expect(review.prompt).toContain('$review-only');
    expect(review.prompt).not.toContain('REVIEW_BASE_PROMPT');
    expect(review.prompt).toContain('Prefer reproducible implementations');
    expect(review.prompt).not.toContain('RESEARCH_BASE_PROMPT');
    expect(result.aiLogs?.[0].prompt_preview).toBe(review.prompt);
    const research = await researchService.runResearchOnArticle(
      group.id,
      articleId,
      undefined,
      'run',
    );
    expect(research.status).toBe('succeeded');
    const request = execute.mock.calls[1][0];
    expect(request.runId).toBe('run');
    expect(request.groupId).toBe(group.id);
    expect(request.skillId).toBe('research-only');
    expect(request.prompt).toContain('$research-only');
    expect(request.prompt).not.toContain('RESEARCH_BASE_PROMPT');
    expect(request.prompt).toContain('Explain the tradeoffs');
    expect(request.prompt).not.toContain('REVIEW_BASE_PROMPT');
    expect(execute.mock.calls.map(([request]) => request.taskType)).toEqual([
      'assess',
      'research_report',
    ]);
    expect(group).not.toHaveProperty('generate_digest');
    expect(group).not.toHaveProperty('skill_ids');
  });
  it('rejects ungrounded scores and does not select marketing-quality content', async () => {
    execute.mockResolvedValue({status:'success',provider:'mock',model:'mock',durationMs:0,result:{relevance:95,quality:95,reason:'Claim',summary:'Claim',evidence_refs:['This quote is invented and absent from the article']}});
    await expect(processingService.runProcessingForGroup((await groupsService.getGroup('task'))!,'ungrounded')).rejects.toThrow('正文证据');
    execute.mockResolvedValue({status:'success',provider:'mock',model:'mock',durationMs:0,result:{relevance:95,quality:55,reason:'No implementation evidence',summary:'Announcement',evidence_refs:['Engineering evidence and code']}});
    const result=await processingService.runProcessingForGroup((await groupsService.getGroup('task'))!,'low-quality');
    expect(result.counts.selected).toBe(0);
    expect(getSqliteDatabase().prepare("SELECT decision FROM group_items WHERE article_id=?").get(articleId)).toEqual({decision:'excluded'});
  });

  it('does not manufacture a successful review when AI fails', async () => {
    execute.mockResolvedValue({
      status: 'failed',
      provider: 'mock',
      model: 'mock',
      durationMs: 0,
      error: { code: 'unavailable', message: 'AI unavailable' },
    });
    await expect(
      processingService.runProcessingForGroup(
        (await groupsService.getGroup('task'))!,
        'run',
      ),
    ).rejects.toThrow('AI unavailable');
  });
  it('does not substitute a generic template for failed research', async () => {
    execute.mockResolvedValue({
      status: 'failed',
      provider: 'mock',
      model: 'mock',
      durationMs: 0,
      error: { code: 'unavailable', message: 'AI unavailable' },
    });
    const task = await researchService.runResearchOnArticle('task', articleId);
    expect(task.status).toBe('failed');
    expect(task.report_markdown).toBe('');
    expect(task.error_message).toBe('AI unavailable');
  });
});
