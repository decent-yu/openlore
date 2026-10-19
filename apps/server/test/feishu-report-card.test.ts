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
        header: { title: { content: title } },
        elements: [{ text: { content: summary } }],
      },
    });
  }
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
