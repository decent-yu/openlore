import { z } from "zod";

export const WikiDisplayConfigSchema = z.object({
  wiki_base_url: z
    .string()
    .trim()
    .default("")
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, "Wiki Base URL 必须是 HTTP(S) 地址，不能包含凭据、查询参数或锚点")
    .transform((value) => value.replace(/\/+$/, "")),
  wiki_root_path: z
    .string()
    .trim()
    .default("")
    .transform((value) => value.replace(/^\/+|\/+$/g, ""))
    .refine(
      (value) =>
        !value ||
        value
          .split("/")
          .every(
            (part) =>
              part &&
              part !== "." &&
              part !== ".." &&
              !/[\\?#%\u0000-\u001f]/.test(part),
          ),
      "Wiki 展示目录必须是仓库内目录，如 docs，不能包含 ..、反斜杠或 URL 参数",
    ),
});

/** Remove the configured repository directory and Markdown extension, then encode each segment. */
export function buildWikiUrl(
  configuration: { wiki_base_url?: string; wiki_root_path?: string },
  repositoryPath: string,
): string | undefined {
  const parsed = WikiDisplayConfigSchema.safeParse(configuration);
  if (!parsed.success || !parsed.data.wiki_base_url) return undefined;
  const { wiki_base_url: base, wiki_root_path: root } = parsed.data;
  const file = repositoryPath.replace(/^\/+/, "");
  if (
    !/\.md$/i.test(file) ||
    file
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[\\\u0000-\u001f]/.test(part),
      )
  )
    return undefined;
  if (root && !file.startsWith(`${root}/`)) return undefined;
  const relative = (root ? file.slice(root.length + 1) : file).replace(
    /\.md$/i,
    "",
  );
  if (!relative) return undefined;
  return `${base}/${relative.split("/").map(encodeURIComponent).join("/")}`;
}
