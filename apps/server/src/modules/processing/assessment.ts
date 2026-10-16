/** Spread the budget across sections so conclusions and measurements aren't dropped. */
export function assessmentMaterial(
  title: string,
  content: string,
  metadata: Record<string, unknown>,
): string {
  const sections = content.split(/\n(?=#{1,6}\s)/);
  let body = content;
  if (content.length > 18000) {
    const budget = Math.max(
      300,
      Math.floor(16500 / Math.max(1, sections.length)),
    );
    body =
      sections
        .map((section) =>
          section.length > budget
            ? section.slice(0, budget) + "\n[本节节选]"
            : section,
        )
        .join("\n")
        .slice(0, 16500) +
      "\n[文末节选]\n" +
      content.slice(-1500);
  }
  return `Metadata: ${JSON.stringify(metadata)}\nTitle: ${title}\n\n${body}`;
}
export function hasGroundedEvidence(result: any, material: string): boolean {
  const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
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
