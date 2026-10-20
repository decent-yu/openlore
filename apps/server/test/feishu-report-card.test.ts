import { expect, it } from "vitest";
import { buildFeishuCard } from "@openlore/contracts";
import { formatWebhookMessage } from "../src/infrastructure/notifications/generic_webhook/sender.js";

it("sends the same separate title and body used by the preview for every supported Feishu/Lark host", () => {
  const title = "Agent 工程日报";
  const summary =
    "日期：2026-10-19\n\n[深度研报](https://wiki.example.com/agent/research)";
  for (const hostname of [
    "open.feishu.cn",
    "open.larksuite.com",
    "open.xfchat.iflytek.com",
  ]) {
    const payload = formatWebhookMessage(`https://${hostname}/hook/test`, {
      event: "daily_push.completed",
      event_id: "test",
      status: "success",
      summary,
      card_title: title,
    });
    expect(payload).toEqual({
      msg_type: "interactive",
      card: buildFeishuCard(title, summary),
    });
    expect(payload).toMatchObject({
      card: {
        schema: "2.0",
        header: { title: { content: title } },
        body: { elements: [{ tag: "markdown", content: summary }] },
      },
    });
  }
});

it("uses card Markdown for article lists and formats section headings without changing links or evidence", () => {
  const title = "技术知识汇报";
  const markdown = "### Agent 相关知识\n\n- [评测实践](https://wiki.example.com/agent/research)\n  面向健康辅导，提供评测架构参考。\n\n- [推理优化](https://wiki.example.com/inference/research)\n  关注成本与质量取舍。";
  const payload = formatWebhookMessage('https://open.feishu.cn/hook/test', {
    event: 'daily_push.completed', event_id: 'markdown-report', status: 'success', card_title: title, summary: markdown,
  });
  expect(payload).toEqual({
    msg_type: 'interactive',
    card: {
      schema: '2.0', config: {width_mode: 'fill'},
      header: {title: {tag: 'plain_text', content: title}, template: 'blue'},
      body: {elements: [{tag: 'markdown', content: markdown.replace('### Agent 相关知识', '**Agent 相关知识**')}]},
    },
  });
  expect(buildFeishuCard(title, markdown)).not.toHaveProperty('elements');
});

it("preserves heading-like source code and literal hash text", () => {
  const markdown = '### **Agent 工程**\r\n\r\n```md\r\n# Example\r\n```\r\n\r\n~~~\r\n## Example\r\n~~~\r\n\r\nC# 与 URL https://example.com/#section';
  const content = buildFeishuCard('标题', markdown).body.elements[0].content;
  expect(content).toBe('**Agent 工程**\n\n```md\n# Example\n```\n\n~~~\n## Example\n~~~\n\nC# 与 URL https://example.com/#section');
  expect(buildFeishuCard('标题', '## C#\n## Agent ###').body.elements[0].content).toBe('**C#**\n**Agent**');
});

it("keeps the configured card title in generic webhook payloads too", () => {
  const payload = {
    event: "daily_push.completed" as const,
    event_id: "test",
    status: "success" as const,
    summary: "正文",
    card_title: "方案标题",
  };
  expect(formatWebhookMessage("https://example.com/webhook", payload)).toEqual(
    payload,
  );
});
