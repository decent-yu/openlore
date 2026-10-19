/** Initial review reads the article once; selection later consumes only its digest. */
export function assessmentMaterial(
  title: string,
  content: string,
  metadata: Record<string, unknown>,
): string {
  return `=== 元信息（不可作为正文证据） ===\nMetadata: ${JSON.stringify(metadata)}\nTitle: ${title}\n\n=== 正文（唯一可引用区域） ===\n${content}\n=== 正文结束 ===`;
}
export interface EvidenceIssue {
  path: string;
  code: string;
  message: string;
}
export function evidenceIssues(result: any, material: string): EvidenceIssue[] {
  if (!Array.isArray(result?.evidence_refs) || !result.evidence_refs.length)
    return [
      {
        path: "evidence_refs",
        code: "missing_evidence",
        message:
          "缺少正文引用，请引用正文区域中至少16字符的原句；元信息和导航不是正文证据。",
      },
    ];
  return result.evidence_refs.flatMap((quote: unknown, index: number) =>
    hasGroundedEvidence({ evidence_refs: [quote] }, material)
      ? []
      : [
          {
            path: `evidence_refs[${index}]`,
            code: "ungrounded_evidence",
            message: `第 ${index + 1} 条引用无法在正文区域逐字核验或不足16字符：${typeof quote === "string" ? quote.slice(0, 200) : "引用必须是字符串"}。请仅修正此项，不引用 Title、Metadata 或导航。`,
          },
        ],
  );
}
export function hasGroundedEvidence(result: any, material: string): boolean {
  // A quotation uses the visible anchor text, not the Markdown link destination.
  const normalized = (text: string) =>
    text
      .replace(/\[([^\]\n]+)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, "$1")
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(`+)([^`]*?)\1/g, "$2")
      .replace(/(?<!\w)(\*|_)(?=\S)([^\n]*?\S)\1(?!\w)/g, "$2")
      .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  return (
    Array.isArray(result.evidence_refs) &&
    result.evidence_refs.length > 0 &&
    result.evidence_refs.every(
      (quote: unknown) =>
        typeof quote === "string" &&
        normalized(quote).length >= 16 &&
        normalized(material).includes(normalized(quote)),
    )
  );
}
