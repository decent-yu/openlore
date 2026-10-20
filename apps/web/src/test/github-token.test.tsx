import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import {
  RepositoryConnectionSchema,
  WorkspaceSettingsSchema,
} from "@openlore/contracts";
import { SettingsPage } from "../features/settings/SettingsPage.js";

it("shows a default Token badge and a simple action on the other GitHub connection", () => {
  const client = new QueryClient();
  client.setQueryData(
    ["settings"],
    WorkspaceSettingsSchema.parse({
      default_github_token_connection_id: "first",
      github_token_configured: true,
    }),
  );
  client.setQueryData(
    ["repos"],
    ["first", "second"].map((id) =>
      RepositoryConnectionSchema.parse({
        id,
        name: `Repo ${id}`,
        revision: "v1",
        owner: "example",
        repo: id,
        default_branch: "trunk",
        credential_ref: `secret_${id}`,
        state: "ready",
      }),
    ),
  );
  for (const key of ["notifs", "aiProfiles"]) client.setQueryData([key], []);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(html).toContain("默认 Token");
  expect(html.match(/设为默认 Token<\/button>/g)).toHaveLength(1);
  expect(html).not.toContain("设置默认 Token");
  expect(html).not.toContain("更换默认 Token");
  client.clear();
});
