import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type { AIValidationIssue } from '../../infrastructure/ai/adapter.js';

function parseTranslationMarkdown(markdown: string) {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

type Node = { type: string; value?: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Node[] };
export function translationSegments(markdown: string) {
  const segments: Array<{ id: string; text: string; start: number; end: number }> = [];
  const visit = (node: Node) => {
    if (node.type === 'text' && node.value?.trim()) {
      segments.push({ id: `text-${segments.length}`, text: node.value.trim(), start: node.position!.start.offset!, end: node.position!.end.offset! });
    }
    node.children?.forEach(visit);
  };
  visit(parseTranslationMarkdown(markdown));
  return segments;
}

export function translationSegmentIssues(source: ReturnType<typeof translationSegments>, result: unknown): AIValidationIssue[] {
  const segments = (result as { segments?: unknown } | null)?.segments;
  const issue = (message: string) => [{ path: 'segments', code: 'invalid_translation', message }];
  if (!Array.isArray(segments) || segments.length !== source.length)
    return issue(`必须返回全部 ${source.length} 个文本段，不得增删。`);
  const expected = new Set(source.map((segment) => segment.id));
  for (const segment of segments) {
    if (!segment || !expected.delete(segment.id) || typeof segment.text !== 'string' || !segment.text.trim() || /[\r\n]/.test(segment.text))
      return issue('文本段 ID 必须与输入一一对应且不能重复；译文不能为空或包含换行。');
  }
  return [];
}

export function renderTranslation(markdown: string, result: unknown): string {
  const source = translationSegments(markdown);
  const issues = translationSegmentIssues(source, result);
  if (issues.length) throw new Error(`中文翻译失败：${issues[0].message}`);
  const values = new Map((result as { segments: Array<{ id: string; text: string }> }).segments.map((segment) => [segment.id, segment.text.trim()]));
  let translated = markdown;
  for (const segment of [...source].reverse()) {
    const raw = markdown.slice(segment.start, segment.end);
    if (values.get(segment.id) === segment.text) continue;
    // Only replace visible text. Original spacing keeps inline delimiters valid.
    const text = values.get(segment.id)!.replace(/([\\`*_{}\[\]()#+\-.!<>|~&])/g, '\\$1');
    translated = translated.slice(0, segment.start) + raw.match(/^\s*/)![0] + text + raw.match(/\s*$/)![0] + translated.slice(segment.end);
  }
  return translated;
}
