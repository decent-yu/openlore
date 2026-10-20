import { expect, it } from 'vitest';
import { formatModelSpec, parseModelSpec } from '@openlore/contracts';

it('normalizes the one-line model and reasoning notation', () => {
  expect(parseModelSpec('GPT-6.1-Sol · high')).toEqual({
    model: 'gpt-6.1-sol',
    reasoning_effort: 'high',
  });
  expect(parseModelSpec('gemini-3.8-flash · medium')).toEqual({
    model: 'gemini-3.8-flash',
    reasoning_effort: 'medium',
  });
  expect(formatModelSpec('gpt-6.1-sol', 'high')).toBe('GPT-6.1-Sol · high');
});

it('rejects an unknown reasoning level instead of passing it to a CLI', () => {
  expect(() => parseModelSpec('GPT-6.1-Sol · turbo')).toThrow('不支持的思考级别');
});
