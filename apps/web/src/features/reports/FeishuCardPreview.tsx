import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildFeishuCard } from "@openlore/contracts";

export function FeishuCardPreview({
  title,
  markdown,
}: {
  title: string;
  markdown: string;
}) {
  const card = buildFeishuCard(title, markdown);
  return (
    <section
      aria-label="飞书卡片模拟"
      className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
    >
      <header
        aria-label="卡片标题"
        className="border-b border-blue-100 bg-blue-50 px-5 py-3 text-base font-semibold text-blue-950 break-words"
      >
        {card.header.title.content}
      </header>
      <div
        aria-label="卡片正文"
        className="prose prose-sm max-w-none break-words px-5 py-4 text-neutral-700 [&_a]:text-blue-700 [&_a]:underline [&_p]:my-2 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_ul]:pl-5"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, ...props }) => (
              <a {...props} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {card.elements[0].text.content}
        </ReactMarkdown>
      </div>
    </section>
  );
}
