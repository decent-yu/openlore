import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { GroupSchema, DailyFeedArticleSchema } from "@openlore/contracts";
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
