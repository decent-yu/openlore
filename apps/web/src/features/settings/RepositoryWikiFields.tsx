import React from "react";
import { buildWikiUrl, WikiDisplayConfigSchema } from "@openlore/contracts";
import { Input } from "../../components/ui/input.js";

interface WikiFields {
  wikiBaseUrl: string;
  wikiRootPath: string;
}
export function RepositoryWikiFields({
  value,
  onChange,
}: {
  value: WikiFields;
  onChange: (value: WikiFields) => void;
}) {
  const wikiConfig = WikiDisplayConfigSchema.safeParse({
    wiki_base_url: value.wikiBaseUrl,
    wiki_root_path: value.wikiRootPath,
  });
  const wikiExamplePath =
    `${value.wikiRootPath.trim().replace(/^\/+|\/+$/g, "")}/agent-learning/articles/20261015-deno-is-joining-cloudflare/research.md`.replace(
      /^\//,
      "",
    );
  const wikiPreview = buildWikiUrl(
    { wiki_base_url: value.wikiBaseUrl, wiki_root_path: value.wikiRootPath },
    wikiExamplePath,
  );
  return (
    <section
      className="mx-5 mb-5 space-y-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3"
      aria-label="Wiki 展示配置"
    >
      <div>
        <h4 className="text-sm font-semibold text-neutral-800">Wiki 展示</h4>
        <p className="mt-1 text-xs text-neutral-500">
          为已归档的正文和研报生成 Wiki 阅读链接，留空 Base URL 可关闭。
        </p>
      </div>
      <label className="block text-xs font-medium text-neutral-700">
        Wiki Base URL
        <Input
          className="mt-1"
          type="url"
          placeholder="https://wiki.mua5201314.com/raven/openlore-knowledge-vault"
          value={value.wikiBaseUrl}
          onChange={(event) =>
            onChange({ ...value, wikiBaseUrl: event.target.value })
          }
        />
      </label>
      <label className="block text-xs font-medium text-neutral-700">
        Wiki 展示路由（仓库目录）
        <Input
          className="mt-1"
          placeholder="docs"
          value={value.wikiRootPath}
          onChange={(event) =>
            onChange({ ...value, wikiRootPath: event.target.value })
          }
        />
      </label>
      <p className="text-[11px] text-neutral-500">
        例如 docs 表示将仓库 docs/ 下的文件映射到 Base URL，移除 docs/ 和
        .md；目录留空表示仓库根目录。
      </p>
      {wikiPreview && (
        <div className="space-y-1 rounded border border-blue-100 bg-white p-2 text-[11px] break-all">
          <p className="text-neutral-500">链接预览：{wikiExamplePath}</p>
          <a
            href={wikiPreview}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline"
          >
            {wikiPreview}
          </a>
        </div>
      )}
      {!wikiConfig.success && (
        <p role="alert" className="text-xs text-red-700">
          {wikiConfig.error.issues[0].message}
        </p>
      )}
    </section>
  );
}
