import type { NotificationResult } from '@openlore/contracts';

export interface WebhookPayload {
  event: 'collection.completed' | 'research.completed' | 'daily_push.completed';
  event_id: string;
  group?: { id: string; name: string };
  status: 'success' | 'partial' | 'failed';
  counts?: { selected: number; failed: number; deferred: number };
  summary: string;
  repository_url?: string;
  commit_sha?: string;
  document_path?: string;
  articles?: Array<{
    title: string;
    url?: string;
    summary: string;
    is_deep_analyzed?: boolean;
  }>;
}

export function formatWebhookMessage(webhookUrl: string, payload: WebhookPayload): unknown {
  const hostname = new URL(webhookUrl).hostname;
  if (['open.feishu.cn', 'open.larksuite.com', 'open.xfchat.iflytek.com'].includes(hostname)) {
    return {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: 'OpenLore · 技术知识汇报' }, template: 'blue' },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: payload.summary } }],
      },
    };
  }
  return payload;
}

export class GenericWebhookSender {
  static async send(
    webhookUrl: string,
    payload: WebhookPayload,
    timeoutMs: number = 10000,
  ): Promise<NotificationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': payload.event_id,
          'User-Agent': 'OpenLore-WebhookSender/0.1',
        },
        body: JSON.stringify(formatWebhookMessage(webhookUrl, payload)),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const respText = await res.text();
      if (res.ok) {
        let provider: any;
        try { provider = JSON.parse(respText); } catch { /* Generic webhooks may return plain text. */ }
        const code = provider?.code ?? provider?.StatusCode ?? provider?.errcode;
        if (code !== undefined && Number(code) !== 0) {
          return {
            status: 'failed', platform_response: respText.slice(0, 500),
            error: { code: `provider_${String(code)}`, message: String(provider.msg || provider.StatusMessage || provider.errmsg || '通知平台拒绝消息') },
          };
        }
        return {
          status: 'sent',
          platform_response: respText.slice(0, 500),
        };
      }

      return {
        status: 'failed',
        platform_response: respText.slice(0, 500),
        error: {
          code: `http_${res.status}`,
          message: `Webhook returned status code ${res.status}`,
        },
      };
    } catch (err: any) {
      clearTimeout(timer);
      return {
        status: 'failed',
        error: {
          code: err.name === 'AbortError' ? 'timeout' : 'network_error',
          message: err.message,
        },
      };
    }
  }
}
