/** Initial review reads the article once; selection later consumes only its digest. */
export function assessmentMaterial(
  title: string,
  content: string,
  metadata: Record<string, unknown>,
): string {
  return `Metadata: ${JSON.stringify(metadata)}\nTitle: ${title}\n\n${content}`;
}
export function hasGroundedEvidence(result: any, material: string): boolean {
  // A quotation uses the visible anchor text, not the Markdown link destination.
  const normalized = (text: string) => text
    .replace(/\[([^\]\n]+)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(`+)([^`]*?)\1/g, '$2')
    .replace(/(?<!\w)(\*|_)(?=\S)([^\n]*?\S)\1(?!\w)/g, '$2')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1')
    .replace(/\s+/g, ' ')
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
