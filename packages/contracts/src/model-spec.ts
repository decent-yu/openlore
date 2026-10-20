import { z } from 'zod';

export const ReasoningEffortSchema = z.enum([
  'none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

const DISPLAY_NAMES: Record<string, string> = {
  'gpt-6.1-sol': 'GPT-6.1-Sol',
  'gpt-6-astra': 'GPT-6-Astra',
  'gpt-6-luna': 'GPT-6-Luna',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
};
const MODEL_ALIASES = new Map(
  Object.entries(DISPLAY_NAMES).flatMap(([id, display]) => [
    [id, id], [display.toLowerCase(), id], [display.replaceAll('-', ' ').toLowerCase(), id],
  ]),
);

export function parseModelSpec(value: string | undefined | null): { model?: string; reasoning_effort?: ReasoningEffort } {
  const raw = value?.trim();
  if (!raw) return {};
  const parts = raw.split(/\s*·\s*/u);
  const effort = parts.length > 1 ? parts.at(-1)?.trim().toLowerCase() : undefined;
  const modelText = (parts.length > 1 ? parts.slice(0, -1).join(' · ') : raw).trim();
  const normalized = MODEL_ALIASES.get(modelText.toLowerCase()) || modelText;
  const parsedEffort = effort ? ReasoningEffortSchema.safeParse(effort) : null;
  if (effort && !parsedEffort?.success) throw new Error(`不支持的思考级别：${effort}`);
  return { model: normalized, reasoning_effort: parsedEffort?.success ? parsedEffort.data : undefined };
}

export function formatModelSpec(model?: string | null, effort?: string | null): string {
  if (!model) return '';
  return `${DISPLAY_NAMES[model] || model}${effort ? ` · ${effort}` : ''}`;
}
