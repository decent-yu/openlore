import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { GroupSchema, DailyFeedArticleSchema, SourceSchema } from "@openlore/contracts";
import { DailyFeedPage } from "../features/feed/DailyFeedPage.js";
import { PipelinesPage } from "../features/pipelines/PipelinesPage.js";

const task = GroupSchema.parse({
  id: "task",
  name: "Agent Engineering",
  route: { repository_connection_id: "repo", base_path: "docs/agent" },
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
  deep_analysis_count: 1,
});
function render(component: React.ReactNode, client: QueryClient) {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>{component}</MemoryRouter>
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}

it("shows only archived research and keeps all daily publications beyond the per-run M quota", () => {
  const client = new QueryClient();
  const article = (id: string) =>
    DailyFeedArticleSchema.parse({
      id,
      title: `Archived ${id}`,
      slug: id,
      summary: "Research summary",
      group_id: "task",
      group_name: task.name,
      is_deep_analyzed: true,
      research: {
        id: `report-${id}`,
        status: "succeeded",
        report_markdown: "# Complete research",
      },
    });
  client.setQueryData(["daily-feed", "", ""], {
    group: task,
    groups: [task],
    date: "2026-10-19",
    available_dates: ["2026-10-19"],
    stats: { pool_count: 10, pending_count: 8, deep_analyzed_count: 2 },
    deep_articles: [article("one"), article("two")],
    candidate_articles: [
      {
        ...article("unused"),
        title: "Unresearched selection must not be shown",
      },
    ],
  });
  const html = render(<DailyFeedPage />, client);
  expect(html).toContain("每日研报");
  expect(html).toContain("Archived one");
  expect(html).toContain("Archived two");
  expect(html).not.toContain("Unresearched selection must not be shown");
  expect(html).not.toContain("备选扩展");
});

it("describes a single M research quota rather than an N-then-M selection pipeline", () => {
  const client = new QueryClient();
  client.setQueryData(["groups"], [task]);
  client.setQueryData(["runs"], []);
  const html = render(<PipelinesPage />, client);
  expect(html).toContain("AI 批量选文");
  expect(html).toContain("每次最多深度调研");
  expect(html).not.toContain("精选最多");
  expect(html).not.toContain("精选篇数");
});

it('shows the dedicated code Skill for repository pipelines and keeps article pipelines separate', () => {
  const client = new QueryClient();
  const code = SourceSchema.parse({id:'code',name:'Code',url:'https://github.com/stablyai/orca',capability_id:'github_repository'});
  const article = SourceSchema.parse({id:'article',name:'Articles',url:'https://example.com/rss'});
  client.setQueryData(['sources'], [code,article]);
  client.setQueryData(['groups'], [{...task,task_type:'repository_research',source_ids:['code']}]);
  client.setQueryData(['runs'], []);
  const html = render(<PipelinesPage />, client);
  expect(html).toContain('每日仓库研读');
  expect(html).toContain('github-code-research');
  expect(html).not.toContain('deep-research-expert');
  const mixedClient = new QueryClient();
  mixedClient.setQueryData(['sources'], [code,article]);
  mixedClient.setQueryData(['groups'], [task,{...task,id:'repository',name:'仓库研读',task_type:'repository_research',source_ids:['code']}]);
  mixedClient.setQueryData(['runs'], []);
  const mixed = render(<PipelinesPage />, mixedClient);
  expect(mixed).toContain('代码调研：github-code-research');
  expect(mixed).toContain('文章调研：deep-research-expert');
});

it('renders user goals and automatically associated research history without an AI plan editor', async () => {
  const { RepositoryHistory } = await import('../features/sources/RepositoryHistory.js');
  const source = SourceSchema.parse({
    id: 'orca', name: 'Orca', url: 'https://github.com/stablyai/orca', capability_id: 'github_repository',
    options: { research_focus: '理解执行器和状态恢复' },
    repository_history: [
      { id: 'one', article_id: 'one', title: '工作区隔离', status: 'completed', commit: 'a'.repeat(40), reports: [{ id: 'report', group_id: 'task', archived_at: '2026-10-20T00:00:00Z', report_markdown: '# 中文研报', wiki_url: 'https://wiki.example/orca/01-workspace' }] },
      { id: 'two', article_id: 'two', title: '失败恢复', status: 'failed', error: '关键源码证据不足', commit: 'b'.repeat(40), reports: [] },
    ],
  });
  const html = renderToStaticMarkup(<RepositoryHistory source={source} />);
  expect(html).toContain('理解执行器和状态恢复');
  expect(html).toContain('工作区隔离');
  expect(html).toContain('1 篇已归档');
  expect(html).toContain('关键源码证据不足');
  expect(html).toContain('https://wiki.example/orca/01-workspace');
  expect(html).toContain('中文研报');
  expect(html).not.toContain('生成计划');
  expect(html).not.toContain('优先级');
});
