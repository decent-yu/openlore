import type { ExecutionResult } from '@openlore/contracts';

type Failure = {
  status: ExecutionResult['status'];
  error: NonNullable<ExecutionResult['error']>;
};

// Classify the failing subsystem, rather than treating all 429s as account quota exhaustion.
export function classifyCliFailure(text: string): Failure | undefined {
  if (
    /Policy (?:generation|enforcement) failed:|conseca-policy-(?:generation|enforcement)/i.test(
      text,
    ) &&
    /RESOURCE_EXHAUSTED|429|exhausted your capacity|Too Many Requests/i.test(
      text,
    )
  ) {
    return {
      status: 'failed',
      error: {
        code: 'gemini_policy_unavailable',
        message:
          'Gemini CLI 内部策略检查服务限流（429）；不代表主模型或整个账号额度耗尽。已结束本次尝试，可由备用执行器接管。',
      },
    };
  }
  if (/invalid_json_schema|Invalid schema for response_format/.test(text)) {
    return {
      status: 'failed',
      error: {
        code: 'invalid_json_schema',
        message:
          '执行请求的 JSON Schema 不符合模型要求，请检查对象的 additionalProperties 和 required。',
      },
    };
  }
  if (
    /RESOURCE_EXHAUSTED|Too Many Requests|(?:status|code|HTTP)["'\s:=]+429\b/i.test(
      text,
    )
  ) {
    return {
      status: 'failed',
      error: {
        code: 'model_rate_limited',
        message:
          '模型请求被限流或该模型暂不可用（429）；不能据此判断整个账号额度耗尽。请查看执行器错误日志。',
      },
    };
  }
  return undefined;
}

export function classifyProcessFailure(
  stdout: string,
  stderr: string,
): Failure | undefined {
  const stderrFailure = classifyCliFailure(stderr);
  if (stderrFailure) return stderrFailure;
  // User messages and tool output may contain arbitrary article text, including error examples.
  for (const line of stdout.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (
        event.type === 'error' ||
        event.type === 'turn.failed' ||
        (event.type === 'result' && event.status === 'error')
      ) {
        const failure = classifyCliFailure(JSON.stringify(event));
        if (failure) return failure;
      }
    } catch {
      /* A streaming line may still be incomplete. */
    }
  }
  return undefined;
}

export function parseGeminiOutput(stdout: string): any {
  const events = stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  // Accept a standard JSON response envelope as well as a JSONL event stream.
  if (events.length === 1 && !events[0].type) return events[0];
  const terminal = [...events]
    .reverse()
    .find((event) => event.type === 'result');
  if (!terminal)
    throw new Error('Gemini CLI 未返回完成事件，不能把中间输出视为成功');
  if (terminal.status !== 'success' || terminal.error) {
    throw new Error(
      terminal.error?.message ||
        terminal.error ||
        'Gemini CLI 返回失败完成事件',
    );
  }
  let response = '';
  for (const event of events) {
    if (event.type === 'tool_use') response = '';
    if (
      event.type === 'message' &&
      event.role === 'assistant' &&
      typeof event.content === 'string'
    ) {
      response = event.delta ? response + event.content : event.content;
    }
  }
  const models = Object.fromEntries(
    Object.entries(terminal.stats?.models || {}).map(([name, raw]) => {
      const metrics = raw as Record<string, number>;
      return [
        name,
        {
          tokens: {
            prompt: metrics.input_tokens,
            candidates: metrics.output_tokens,
            total: metrics.total_tokens,
            cached: metrics.cached,
          },
        },
      ];
    }),
  );
  return { response, stats: { models } };
}
