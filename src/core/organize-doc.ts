/**
 * 文献整理的纯函数部分：占位符渲染与文档拼装。
 *
 * 单独成文件是为了能在 vitest 里测试——organize.ts 会 import obsidian 的
 * requestUrl，测试环境里加载不了。
 */

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** 去掉正文开头重复的文献标题（OCR 常把首页大标题也识别进来）。 */
export function stripLeadingTitle(text: string, title: string): string {
  const normalizedTitle = title.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalizedTitle.length === 0) return text;

  const lines = text.split("\n");
  let index = 0;

  // 跳过开头的页标记与空行
  while (index < lines.length) {
    const line = (lines[index] ?? "").trim();
    if (line.length === 0 || /^<!--.*-->$/.test(line)) {
      index += 1;
      continue;
    }
    break;
  }

  const candidate = (lines[index] ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (candidate === normalizedTitle || candidate.startsWith(normalizedTitle)) {
    lines.splice(index, 1);
  }

  // 删除标题后，开头的页标记与空行也一并去掉。
  return lines
    .join("\n")
    .replace(/^(?:\s*<!--[^>]*-->\s*\n+|\s*\n+)+/, "")
    .trimStart();
}

/** 折叠多重井号：`## # 标题` / `### ## 标题` → 单层。 */
export function normalizeHeadings(markdown: string): string {
  return markdown
    .replace(/^(#{1,6})\s+#{1,6}\s+/gm, "$1 ")
    .replace(/^(#{1,6})\s*#{1,6}\s*$/gm, "$1 ");
}

/** 把 AI 输出里的占位符渲染成可读提示，并清掉页标记。 */
export function renderFigurePlaceholders(markdown: string): string {
  return normalizeHeadings(markdown)
    .replace(/<!--\s*第\s*\d+\s*页\s*-->/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(
      /\[FIG:([^|\]]+)\|([^\]]+)\]/g,
      (_match, label: string, page: string) => `> 📊 **${label}**（${page}，见原文）`,
    )
    .trim();
}

export function buildFullTextDocument(input: {
  title: string;
  citekey: string;
  authors: string[];
  year?: number;
  doi?: string;
  pages: number;
  figures: number;
  bilingual: boolean;
  body: string;
}): string {
  const frontmatter = [
    "---",
    "schema: lit-fulltext@1",
    `citekey: ${yamlString(input.citekey)}`,
    `title: ${yamlString(input.title)}`,
    `authors: [${input.authors.map(yamlString).join(", ")}]`,
    ...(input.year ? [`year: ${input.year}`] : []),
    ...(input.doi ? [`doi: ${yamlString(input.doi)}`] : []),
    `pages: ${input.pages}`,
    `figures: ${input.figures}`,
    `bilingual: ${input.bilingual}`,
    `extractedAt: ${yamlString(new Date().toISOString())}`,
    "---",
  ].join("\n");

  return [
    frontmatter,
    "",
    `# ${input.title}`,
    "",
    "> 由 PDF 自动整理：结构保真，图表以占位符标注；英文文献附逐段中文译文。",
    "",
    input.body.trim(),
    "",
  ].join("\n");
}
