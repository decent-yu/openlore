import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SafeHttpClient, isPrivateIp } from '../src/infrastructure/http/client.js';
import { initDatabase } from '../src/infrastructure/persistence/sqlite/db.js';
import { groupsService, normalizeRoutePath } from '../src/modules/groups/service.js';
import { settingsService } from '../src/modules/settings/service.js';
import { sourcesService } from '../src/modules/sources/service.js';
import { createServer } from '../src/http/server.js';
import { slugify } from '../src/modules/processing/service.js';
import { skillsService } from '../src/modules/skills/service.js';

describe('OpenLore Server Core Tests', () => {
  beforeAll(async () => {
    initDatabase();
    await sourcesService.seedDefaultSources();
  });

  describe('Skills Dynamic Loading & Parsing', () => {
    it('discovers and loads skills from project skills/ directory', async () => {
      const skills = await skillsService.listSkills();
      expect(skills.length).toBeGreaterThanOrEqual(3);

      const techExtractor = skills.find((s) => s.id === 'tech-article-extractor');
      expect(techExtractor).toBeDefined();
      expect(techExtractor?.type).toBe('extraction');
      expect(techExtractor?.system_prompt).toContain('evidence_refs');

      const batchDigest = skills.find((s) => s.id === 'batch-digest-generator');
      expect(batchDigest).toBeDefined();
      expect(batchDigest?.type).toBe('digest');
      expect(batchDigest?.system_prompt).toContain('批次全局综述');

      const deepResearch = skills.find((s) => s.id === 'deep-research-expert');
      expect(deepResearch).toBeDefined();
      expect(deepResearch?.type).toBe('research');
      expect(deepResearch?.system_prompt).toContain('不重新挑选文章');
    });

    it('retrieves specific skill by ID and falls back safely', async () => {
      const skill = await skillsService.getSkill('tech-article-extractor');
      expect(skill).toBeDefined();
      expect(skill?.id).toBe('tech-article-extractor');

      const digestSkill = await skillsService.getSkill('batch-digest-generator');
      expect(digestSkill?.id).toBe('batch-digest-generator');

      const researchSkill = await skillsService.getSkill('deep-research-expert');
      expect(researchSkill?.id).toBe('deep-research-expert');

      const nonExistent = await skillsService.getSkill('unknown-skill');
      expect(nonExistent).toBeNull();
    });
  });

  describe('HTTP & Security Tests', () => {
    it('detects private and localhost IPs correctly', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('localhost')).toBe(true);
      expect(isPrivateIp('10.0.0.5')).toBe(true);
      expect(isPrivateIp('192.168.1.1')).toBe(true);
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('8.8.8.8')).toBe(false);
      expect(isPrivateIp('104.21.5.1')).toBe(false);
    });

    it('blocks internal hostnames in SafeHttpClient', async () => {
      await expect(
        SafeHttpClient.checkUrlSafety('http://localhost:8080/secret'),
      ).rejects.toThrow();
      await expect(
        SafeHttpClient.checkUrlSafety('http://127.0.0.1/admin'),
      ).rejects.toThrow();
    });
  });

  describe('Groups Routing and Path Normalization', () => {
    it('normalizes leading and trailing slashes', () => {
      expect(normalizeRoutePath('/docs/agent-leaning/')).toBe('docs/agent-leaning');
      expect(normalizeRoutePath('docs/backend-perf')).toBe('docs/backend-perf');
    });

    it('rejects path traversal or empty roots', () => {
      expect(() => normalizeRoutePath('../escape')).toThrow();
      expect(() => normalizeRoutePath('   ')).toThrow();
      expect(() => normalizeRoutePath('/..')).toThrow();
    });

    it('generates clean URL slugs', () => {
      expect(slugify('Agent Recovery & State Persistence')).toBe(
        'agent-recovery-state-persistence',
      );
      expect(slugify('Cloudflare Workers & MCP 2026!')).toBe(
        'cloudflare-workers-mcp-2026',
      );
    });
  });

  describe('Sources & Settings Service', () => {
    it('seeds default sources Cloudflare and Simon Willison', async () => {
      const sources = await sourcesService.listSources();
      expect(sources.length).toBeGreaterThanOrEqual(2);
      const cloudflare = sources.find((s) => s.id === 'cloudflare');
      const simonw = sources.find((s) => s.id === 'simonw');
      expect(cloudflare).toBeDefined();
      expect(cloudflare?.url).toBe('https://blog.cloudflare.com/rss/');
      expect(simonw).toBeDefined();
      expect(simonw?.url).toBe('https://simonwillison.net/atom/everything/');
    });

    it('keeps workspace settings separate from task and report schedules', async () => {
      await settingsService.updateSettings({ timezone: 'Asia/Shanghai' });
      const settings = await settingsService.getSettings();
      expect(settings.timezone).toBe('Asia/Shanghai');
      expect(settings).not.toHaveProperty('pipeline_run_cron');
      expect(settings).not.toHaveProperty('daily_push_cron');
    });

    it('parses repository URL and saves repository connection seamlessly', async () => {
      const { parseGitRepoUrl } = await import('../src/modules/settings/service.js');
      expect(parseGitRepoUrl('https://github.com/raven-ai-labs/openlore-knowledge-vault.git')).toEqual({
        owner: 'raven-ai-labs',
        repo: 'openlore-knowledge-vault',
      });
      expect(parseGitRepoUrl('git@github.com:decent/my-repo.git')).toEqual({
        owner: 'decent',
        repo: 'my-repo',
      });
      expect(parseGitRepoUrl('decent/openlore')).toEqual({
        owner: 'decent',
        repo: 'openlore',
      });

      const repo = await settingsService.saveRepositoryConnection({
        url: 'https://github.com/raven-ai-labs/openlore-knowledge-vault.git',
        token: 'test_token',
      });
      expect(repo.owner).toBe('raven-ai-labs');
      expect(repo.repo).toBe('openlore-knowledge-vault');
      expect(repo.name).toBe('raven-ai-labs/openlore-knowledge-vault');
    });

    it('falls back to backup AI executor when primary fails', async () => {
      const { FallbackAIAdapter } = await import('../src/infrastructure/ai/fallback_runner.js');
      const calls: string[] = [];

      const mockPrimary = {
        async execute() {
          calls.push('primary');
          return {
            status: 'failed' as const,
            provider: 'gemini_cli',
            durationMs: 10,
            error: { code: 'cli_error', message: 'Primary failed' },
          };
        },
        async testConnection() {
          return { ok: false, message: 'Primary down' };
        },
      };

      const mockBackup = {
        async execute() {
          calls.push('backup');
          return {
            status: 'success' as const,
            provider: 'codex_cli',
            durationMs: 15,
            result: { relevance: 90 },
          };
        },
        async testConnection() {
          return { ok: true, message: 'Backup ok' };
        },
      };

      const runner = new FallbackAIAdapter([
        {
          target: { id: 'p1', name: 'Primary', provider: 'gemini_cli', cliPath: 'gemini', isPrimary: true },
          adapter: mockPrimary,
        },
        {
          target: { id: 'p2', name: 'Backup', provider: 'codex_cli', cliPath: 'codex', isPrimary: false },
          adapter: mockBackup,
        },
      ]);

      const res = await runner.execute({
        jobId: 'job_1',
        profileId: 'p1',
        taskType: 'assess',
        prompt: 'test',
        material: 'content',
      });

      expect(calls).toEqual(['primary', 'backup']);
      expect(res.status).toBe('success');
      expect(res.result).toEqual({ relevance: 90 });
    });

    it('supports deleting repository, notification, and AI profiles', async () => {
      // 1. Repo delete
      const repo = await settingsService.saveRepositoryConnection({
        url: 'https://github.com/decent/temporary-repo.git',
      });
      const deleteRepoRes = await settingsService.deleteRepositoryConnection(repo.id);
      expect(deleteRepoRes.ok).toBe(true);
      const repos = await settingsService.listRepositoryConnections();
      expect(repos.find((r) => r.id === repo.id)).toBeUndefined();

      // 2. Notification delete
      const notif = await settingsService.saveNotificationConnection({
        name: 'Temp Webhook',
        webhookUrl: 'https://example.com/hook',
      });
      const deleteNotifRes = await settingsService.deleteNotificationConnection(notif.id);
      expect(deleteNotifRes.ok).toBe(true);
      const notifs = await settingsService.listNotificationConnections();
      expect(notifs.find((n) => n.id === notif.id)).toBeUndefined();

      // 3. AI profile delete
      const ai = await settingsService.saveAIProfile({
        name: 'Temp AI',
        provider: 'codex_cli',
        cliPath: 'codex',
      });
      const deleteAiRes = await settingsService.deleteAIProfile(ai.id);
      expect(deleteAiRes.ok).toBe(true);
      const aiProfiles = await settingsService.listAIProfiles();
      expect(aiProfiles.find((p) => p.id === ai.id)).toBeUndefined();
    });
  });

  describe('Scheduler & Decoupled Cron Matching', () => {
    it('matches cron expressions accurately', async () => {
      const { matchesCron, matchesCronPart } = await import('../src/modules/scheduler/scheduler.js');
      expect(matchesCronPart('*', 10)).toBe(true);
      expect(matchesCronPart('*/5', 10)).toBe(true);
      expect(matchesCronPart('*/5', 11)).toBe(false);
      expect(matchesCronPart('9,18', 9)).toBe(true);
      expect(matchesCronPart('9,18', 12)).toBe(false);
      expect(matchesCronPart('8', 8)).toBe(true);

      const testDate = new Date('2026-10-16T09:00:00+08:00');
      expect(matchesCron('0 9 * * *', testDate, 'Asia/Shanghai')).toBe(true);
      expect(matchesCron('0 8 * * *', testDate, 'Asia/Shanghai')).toBe(false);
    });
  });

  describe('Fastify REST API & Endpoints', () => {
    it('handles GET /api/v1/sources and GET /api/v1/settings', async () => {
      const app = await createServer();
      const resSources = await app.inject({
        method: 'GET',
        url: '/api/v1/sources',
      });
      expect(resSources.statusCode).toBe(200);
      const sourcesData = resSources.json();
      expect(Array.isArray(sourcesData)).toBe(true);

      const resSettings = await app.inject({
        method: 'GET',
        url: '/api/v1/settings',
      });
      expect(resSettings.statusCode).toBe(200);
      expect(resSettings.json().timezone).toBe('Asia/Shanghai');

      const resDoctor = await app.inject({
        method: 'GET',
        url: '/api/v1/settings/doctor',
      });
      expect(resDoctor.statusCode).toBe(200);
      expect(resDoctor.json().ok).toBe(true);

      const resFeed = await app.inject({
        method: 'GET',
        url: '/api/v1/feed',
      });
      expect(resFeed.statusCode).toBe(200);
      const feedData = resFeed.json();
      expect(feedData.stats).toBeDefined();
      expect(Array.isArray(feedData.deep_articles)).toBe(true);
      expect(Array.isArray(feedData.candidate_articles)).toBe(true);
      expect(feedData.stats.total_selected_count).toBeLessThanOrEqual(feedData.group?.max_selected || 10);
      if (feedData.deep_articles.length > 0) {
        expect(feedData.deep_articles[0].group_id).toBeDefined();
        expect(feedData.deep_articles[0].group_name).toBeDefined();
      }

      const resSkills = await app.inject({
        method: 'GET',
        url: '/api/v1/skills',
      });
      expect(resSkills.statusCode).toBe(200);
      const skillsList = resSkills.json();
      expect(Array.isArray(skillsList)).toBe(true);
      expect(skillsList.some((s: any) => s.id === 'tech-article-extractor')).toBe(true);

      const resSkillDetail = await app.inject({
        method: 'GET',
        url: '/api/v1/skills/tech-article-extractor',
      });
      expect(resSkillDetail.statusCode).toBe(200);
      expect(resSkillDetail.json().id).toBe('tech-article-extractor');

      const resLibrary = await app.inject({
        method: 'GET',
        url: '/api/v1/library?page=1&page_size=10',
      });
      expect(resLibrary.statusCode).toBe(200);
      const libData = resLibrary.json();
      expect(Array.isArray(libData.items)).toBe(true);
      expect(libData.pagination).toBeDefined();
      expect(libData.pagination.page).toBe(1);
      expect(libData.pagination.page_size).toBe(10);
      expect(libData.filter_meta).toBeDefined();
      expect(typeof libData.filter_meta.total_count).toBe('number');
      expect(typeof libData.filter_meta.today_count).toBe('number');
      expect(typeof libData.filter_meta.three_days_count).toBe('number');

      const resPushTest = await app.inject({
        method: 'GET',
        url: '/api/v1/reports',
      });
      expect(resPushTest.statusCode).toBe(200);
      const pushResult = resPushTest.json();
      expect(Array.isArray(pushResult)).toBe(true);

      const resPushes = await app.inject({
        method: 'GET',
        url: '/api/v1/runs/pushes',
      });
      expect(resPushes.statusCode).toBe(200);
      const pushesData = resPushes.json();
      expect(Array.isArray(pushesData)).toBe(true);

      await app.close();
    });
  });
});
