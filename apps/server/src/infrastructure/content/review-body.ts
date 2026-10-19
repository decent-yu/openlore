/** Keep article text while removing an explicitly labelled trailing navigation list. */
export function reviewBody(content: string): string {
  const lines = content.split(/\r?\n/);
  const navigation =
    /^(?:#{1,6}\s*)?(?:recent articles|recent posts|related articles|related posts|相关阅读|相关文章|最近文章|近期文章)\s*[:：]?\s*$/i;
  for (let index = 0; index < lines.length; index++) {
    if (!navigation.test(lines[index].trim())) continue;
    const tail = lines.slice(index + 1).filter((line) => line.trim());
    if (
      tail.every((line) =>
        /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\[[^\]]+\]\([^\n]+\)(?:\s*[-–—·|].*)?\s*$/.test(
          line,
        ),
      )
    ) {
      return lines.slice(0, index).join("\n").trim();
    }
  }
  return content.trim();
}

export function hasReviewableBody(content: string, title = ""): boolean {
  const body = reviewBody(content);
  return body.split(/\r?\n/).some((line) => {
    const value = line.replace(/^\s*#{1,6}\s*/, "").trim();
    if (!value || value === title.trim()) return false;
    // A standalone publication date is metadata, not article substance.
    if (/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/.test(value)) return false;
    if (
      /^(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})$/.test(
        value,
      )
    )
      return false;
    return true;
  });
}
