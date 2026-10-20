import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RepositoryWikiFields } from "../features/settings/RepositoryWikiFields.js";
import { WikiReadingLinks } from "../components/WikiReadingLinks.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DailyFeedArticleSchema } from "@openlore/contracts";
import { DailyFeedPage } from "../features/feed/DailyFeedPage.js";

const base = "https://wiki.mua5201314.com/raven/openlore-knowledge-vault";
it("shows editable repository Wiki fields and the requested full URL preview", () => {
  const html = renderToStaticMarkup(
    <RepositoryWikiFields
      value={{ wikiBaseUrl: base, wikiRootPath: "docs" }}
      onChange={() => {}}
    />,
  );
  expect(html).toContain("Wiki Base URL");
  expect(html).toContain("Wiki 展示路由（仓库目录）");
  expect(html).toContain(
    `href="${base}/agent-learning/articles/20261015-deno-is-joining-cloudflare/research"`,
  );
  expect(html).toContain('value="docs"');
});

it("shows validation instead of an unsafe clickable preview", () => {
  const html = renderToStaticMarkup(
    <RepositoryWikiFields
      value={{ wikiBaseUrl: "javascript:alert(1)", wikiRootPath: "docs" }}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('role="alert"');
  expect(html).not.toContain("<a ");
});

it("keeps the report and article reading destinations separate and omits absent links", () => {
  const html = renderToStaticMarkup(
    <WikiReadingLinks
      articleUrl={`${base}/article`}
      researchUrl={`${base}/research`}
    />,
  );
  expect(html).toContain(`href="${base}/research"`);
  expect(html).toContain(`href="${base}/article"`);
  expect(html).toContain("Wiki 研报");
  expect(html).toContain("Wiki 正文");
  expect(renderToStaticMarkup(<WikiReadingLinks />)).toBe("");
});

it("uses the content pool card reading links and actions on the daily feed", () => {
  const client = new QueryClient();
  const article = DailyFeedArticleSchema.parse({
    id: "article",
    title: "Wiki research title",
    slug: "article",
    summary: "Summary",
    group_id: "task",
    group_name: "Task",
    original_url: "https://example.com/original",
    wiki_url: `${base}/article`,
    research: {
      id: "report",
      status: "succeeded",
      report_markdown: "# Report",
      wiki_url: `${base}/research`,
    },
  });
  client.setQueryData(["settings"], { timezone: "Asia/Shanghai" });
  client.setQueryData(["daily-feed", "", ""], {
    group: { id: "task", name: "Task", schedule_cron: "0 8 * * *" },
    groups: [{ id: "task", name: "Task" }],
    date: "2026-10-19",
    available_dates: ["2026-10-19"],
    stats: {
      pool_count: 2,
      deep_analyzed_count: 2,
      pending_count: 0,
    },
    deep_articles: [article],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DailyFeedPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(html.match(new RegExp(`href="${base}/research"`, "g"))).toHaveLength(
    3,
  );
  expect(html).toContain("更多操作：Wiki research title");
  expect(html).toContain(`href="${base}/article"`);
  expect(html).not.toMatch(/<a\b[^>]*>\s*<a\b/);
  client.clear();
});
