/**
 * 命名工具：领域 slug、citekey、稳定哈希。
 *
 * 放在 vault-core 而不是插件里，因为服务端与迁移脚本也会用到同一套规则——
 * 同一篇文献必须永远得到同一个 citekey，否则目录会分裂。
 */

export function slugifyAscii(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/** FNV-1a 32 位，只为稳定，不做安全用途。 */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function domainSlug(name: string): string {
  const ascii = slugifyAscii(name);
  if (ascii.length >= 2) return ascii;
  return `d-${stableHash(name.trim())}`;
}

export interface CitekeyInput {
  title: string;
  authors?: string[];
  year?: number;
  doi?: string;
}

/**
 * 文献引用键 = 第一作者（或标题前三词）- 年份 - 短哈希。
 *
 * 中文作者没有天然 ASCII 形式，所以顺序是「作者 → 标题 → lit」逐级回落，
 * 末尾 4 位哈希保证同作者同年不撞车。结果可直接做目录名。
 */
export function citekeyFor(input: CitekeyInput): string {
  const author = slugifyAscii(input.authors?.[0] ?? "");
  const titlePart = slugifyAscii(input.title).split("-").slice(0, 3).join("-");
  const base = author || titlePart || "lit";
  const year = input.year ? String(input.year) : "nd";
  const suffix = stableHash(input.doi ?? `${input.title}|${input.year ?? ""}`).slice(0, 4);
  return `${base}-${year}-${suffix}`
    .slice(0, 64)
    .replace(/-+$/g, "")
    .replace(/^[^a-z0-9]+/g, "");
}

/**
 * 文献文件夹名：用可读标题（截断），而不是 citekey。
 *
 * 学生要在文件树里认出「这是哪篇文献」，`johnstone-t-2006-44f2` 认不出来。
 * 规则：
 * - 去掉文件系统非法字符与首尾标点；
 * - 折叠连续空白；
 * - 超过 maxLength 截断（默认 30 字，避免目录名过长）。
 *
 * citekey 仍然保存在 frontmatter 里做机器标识，两者分工明确。
 */
export function literatureFolder(title: string, citekey: string, maxLength = 36): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();

  const base = cleaned.length > 0 ? cleaned : citekey;

  let truncated = base;
  if (base.length > maxLength) {
    const slice = base.slice(0, maxLength);
    const lastSpace = slice.lastIndexOf(" ");
    // 拉丁标题尽量在词边界截断；中文没有空格，直接按字数截。
    truncated =
      lastSpace >= Math.floor(maxLength * 0.55) ? slice.slice(0, lastSpace) : slice;
  }

  const finalName = truncated.trim().replace(/[.\s]+$/g, "");
  return finalName.length > 0 ? finalName : citekey;
}
