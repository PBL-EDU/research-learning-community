export function splitAuthors(input: string): string[] {
  return input
    .split(/[、,，;；\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseYear(input: string): number | undefined {
  const match = input.match(/\d{4}/);
  if (!match) return undefined;
  const year = Number.parseInt(match[0], 10);
  return year >= 1500 && year <= 2100 ? year : undefined;
}

/** 允许用户直接粘 doi.org 链接，统一成裸 DOI。 */
export function normalizeDoi(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
}

/** 从用户输入里猜出标签，去重后最多 10 个（与契约上限一致）。 */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(/[,，;；]+/)) {
    const tag = raw.trim().slice(0, 24);
    if (tag.length > 0) seen.add(tag);
    if (seen.size >= 10) break;
  }
  return [...seen];
}
