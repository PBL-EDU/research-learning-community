/**
 * 综述里的候选文献清单。
 *
 * 约定：AI 在综述末尾输出一个 HTML 注释块，学生看不见，程序解析它。
 * 用注释而不是表格，是为了让正文保持纯人类可读，同时程序拿到结构化数据。
 *
 * ```md
 * <!-- rlc:candidates
 * [{"title":"…","authors":["…"],"year":2015,"doi":"10.xxxx/…"}]
 * rlc:candidates -->
 * ```
 */
export interface ReviewCandidate {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  why?: string;
}

const BLOCK = /<!--\s*rlc:candidates\s*([\s\S]*?)\s*rlc:candidates\s*-->/i;
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;

export function parseCandidates(markdown: string): ReviewCandidate[] {
  const match = markdown.match(BLOCK);
  if (!match) return [];

  let data: unknown;
  try {
    data = JSON.parse(match[1] ?? "");
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const candidates: ReviewCandidate[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (title.length === 0) continue;

    const authors = Array.isArray(record.authors)
      ? record.authors
          .filter((author): author is string => typeof author === "string")
          .map((author) => author.trim())
          .filter((author) => author.length > 0)
      : [];

    const year = typeof record.year === "number" && record.year >= 1500 && record.year <= 2100
      ? Math.trunc(record.year)
      : undefined;

    const doi = typeof record.doi === "string" && DOI_PATTERN.test(record.doi.trim())
      ? record.doi.trim()
      : undefined;

    candidates.push({
      title,
      authors,
      ...(year ? { year } : {}),
      ...(typeof record.venue === "string" && record.venue.trim() ? { venue: record.venue.trim() } : {}),
      ...(doi ? { doi } : {}),
      ...(typeof record.why === "string" && record.why.trim() ? { why: record.why.trim() } : {}),
    });
  }

  return candidates;
}

/**
 * 去掉候选块，只留给人读的正文。
 *
 * 候选清单是机器的数据，不该留在学生保存的综述里——源码模式下它就是一串 JSON。
 * 解析后落盘到 00-系统/候选文献-<domain>.json，正文保持干净。
 */
export function stripCandidates(markdown: string): string {
  return markdown
    .replace(BLOCK, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

/**
 * 判断一份综述是不是「空模板」。
 *
 * 用途：新建领域后会立刻生成；如果生成失败或用户跳过，
 * 文件里只剩模板骨架。此时点领域名应该重新生成，而不是打开一个空文件。
 */
export function isReviewEmpty(markdown: string): boolean {
  if (parseCandidates(markdown).length > 0) return false;

  const withoutFrontmatter = markdown.replace(/^---[\s\S]*?\n---\s*/m, "");
  const meaningful = withoutFrontmatter
    .split("\n")
    .filter((line) => !/^#{1,6}\s/.test(line)) // 标题
    .filter((line) => !/^>/.test(line)) // 模板说明引用
    .filter((line) => !/^\s*[-*]\s/.test(line)) // 列表项
    .filter((line) => !/^（用/.test(line.trim())) // 「（用 [[文献/…]] 链接）」这类模板提示
    .join("")
    .replace(/[\s`[\]()（）]/g, "");

  return meaningful.length < 10;
}

/** 标题归一化：去掉标点、空格、引号，只留可比较的字符。 */
export function normalizeTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s\u3000"'“”‘’《》〈〉\-—_:：,，.。;；!！?？()（）[\]【】]/g, "");
}

/**
 * 宽松比对：完全相同，或一方包含另一方。
 * 宁可放过，也不要把「副标题差异」误判成伪造——误判的代价是学生不再信任核验。
 */
export function titleMatches(a: string, b: string): boolean {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (left.length < 4 || right.length < 4) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function hasDoi(candidate: ReviewCandidate): candidate is ReviewCandidate & { doi: string } {
  return typeof candidate.doi === "string" && DOI_PATTERN.test(candidate.doi);
}
