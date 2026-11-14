/**
 * OCR 输出清洗：把 DeepSeek rich_layout_recognition 的标记还原成可读文本。
 *
 * 真实格式（踩过两次坑）：
 *
 *   <｜ref｜>text<｜/ref｜><｜box｜>[[42,88,469,292]]<｜/box｜> 正文……
 *
 * 1. ref 里是**版面类型标签**，不是正文；
 * 2. 正文在坐标块之后；
 * 3. 坐标能用来修**双栏阅读顺序**——否则右栏的标题会插进左栏句子中间；
 * 4. OCR 正文里自带 `#`/`##`，必须先剥掉，否则和 AI 的标题叠成 `## #`。
 */

/** DeepSeek-OCR 的版面类型标签。 */
const LABELS = new Set([
  "title",
  "doc_title",
  "sub_title",
  "subtitle",
  "text",
  "paragraph",
  "abstract",
  "author",
  "affiliation",
  "image",
  "figure",
  "figure_caption",
  "figure_note",
  "table",
  "table_caption",
  "table_note",
  "caption",
  "footnote",
  "header",
  "footer",
  "page_header",
  "page_footer",
  "page_number",
  "reference",
  "equation",
  "equation_caption",
  "list",
  "list_item",
  "formula",
  "key",
  "value",
]);

const REF_START = "<|ref|>";
const REF_END = "<|/ref|>";
const COORD = /<\|(det|box)\|>\[\[([\d.,\s]+)\]\]<\|(?:\/)?\1\|>/;

export interface OcrBlock {
  type: string;
  text: string;
  /** [x1, y1, x2, y2]，0–1000 归一化坐标。 */
  box?: [number, number, number, number];
}

/** 去掉 OCR 自带的 Markdown 标题符号，交给 AI 重新分级。 */
function stripMarkers(text: string): string {
  return text
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** 把一页的原始输出拆成「类型 + 正文 + 坐标」块。 */
export function parseOcrBlocks(raw: string): OcrBlock[] {
  const text = raw.replace(/｜/g, "|").replace(/\r\n/g, "\n");
  const starts: number[] = [];

  const finder = /<\|ref\|>/g;
  let match: RegExpExecArray | null;
  while ((match = finder.exec(text)) !== null) {
    starts.push(match.index);
  }

  if (starts.length === 0) {
    const plain = stripMarkers(text.replace(/<\|[^|]*\|>/g, ""));
    return plain.length > 0 ? [{ type: "text", text: plain }] : [];
  }

  const blocks: OcrBlock[] = [];

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index] ?? 0;
    const refEnd = text.indexOf(REF_END, start + REF_START.length);
    if (refEnd < 0) continue;

    const typeRaw = text.slice(start + REF_START.length, refEnd).trim();
    const type = typeRaw.toLowerCase();

    let cursor = refEnd + REF_END.length;
    let box: [number, number, number, number] | undefined;

    const rest = text.slice(cursor);
    const coord = rest.match(COORD);
    if (coord) {
      cursor += coord[0].length;
      const numbers = (coord[2] ?? "")
        .split(",")
        .map((value) => Number.parseFloat(value.trim()))
        .filter((value) => Number.isFinite(value));
      if (numbers.length >= 4) {
        box = [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 0];
      }
    } else {
      const loose = rest.match(/^\s*<\|[^|]*\|>[\s\S]*?<\|[^|]*\|>/);
      if (loose) cursor += loose[0].length;
    }

    const nextStart = index + 1 < starts.length ? (starts[index + 1] ?? text.length) : text.length;
    const content = stripMarkers(text.slice(cursor, nextStart).replace(/<\|[^|]*\|>/g, ""));

    if (LABELS.has(type)) {
      blocks.push({ type, text: content, ...(box ? { box } : {}) });
    } else {
      blocks.push({ type: "text", text: stripMarkers(typeRaw), ...(box ? { box } : {}) });
    }
  }

  return blocks;
}

const COLUMN_CENTER = 500;

/**
 * 双栏页面：先读左栏（按 y），再读右栏。单栏页面按 y 排序。
 *
 * 判定要谨慎：只有左栏中心明显在左、右栏中心明显在右、且两边都有多个块时才分栏，
 * 否则宁可保持原顺序。
 */
export function orderBlocks(blocks: OcrBlock[]): OcrBlock[] {
  const boxed = blocks.filter((block) => block.box);
  if (boxed.length !== blocks.length || blocks.length < 4) return blocks;

  const centers = blocks.map((block) => {
    const box = block.box as [number, number, number, number];
    return (box[0] + box[2]) / 2;
  });

  const left = blocks.filter((block, index) => (centers[index] ?? 0) < COLUMN_CENTER);
  const right = blocks.filter((block, index) => (centers[index] ?? 0) >= COLUMN_CENTER);

  const twoColumn =
    left.length >= 3 &&
    right.length >= 3 &&
    Math.max(...left.map((block) => (block.box as number[])[2] ?? 0)) < 560 &&
    Math.min(...right.map((block) => (block.box as number[])[0] ?? 0)) > 440;

  const byY = (a: OcrBlock, b: OcrBlock): number =>
    ((a.box as number[])[1] ?? 0) - ((b.box as number[])[1] ?? 0);

  if (twoColumn) {
    return [...left.sort(byY), ...right.sort(byY)];
  }

  return [...blocks].sort(byY);
}

/** 抽取一页里可读的文字并按阅读顺序拼接。 */
export function pageText(raw: string): string {
  return orderBlocks(parseOcrBlocks(raw))
    .map((block) => block.text.trim())
    .filter((block) => block.length > 0)
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CAPTION = /^(图|表|Figure|Fig\.?|Table)\s*([0-9A-Za-z]+)[\s.、:：]/;

/** 把「图 1 …」这类图注行换成占位符，并返回占位符数量。 */
export function rewriteCaptions(text: string, pageNumber: number): { text: string; figures: number } {
  let figures = 0;
  const lines = text.split("\n").map((line) => {
    const trimmed = line.trim();
    const matched = trimmed.match(CAPTION);
    if (!matched) return line;
    if (trimmed.length > 200) return line;
    figures += 1;
    const kind = matched[1] ?? "";
    const number = matched[2] ?? "";
    const label = `${kind.startsWith("Fig") || kind === "Figure" ? "图" : kind} ${number}`;
    return `[FIG:${label}|第 ${pageNumber} 页]`;
  });

  return { text: lines.join("\n"), figures };
}

export interface OcrPage {
  index: number;
  text: string;
}

export interface CleanedDocument {
  /** 每页清洗后的文本，页与页之间用换行连接。 */
  text: string;
  pageCount: number;
  figures: number;
}

const SENTENCE_END = /[.!?。！？：:；;"'”’)\]]$/;

/**
 * 把整份 OCR 结果清洗成连续文本。
 *
 * 关键：页与页之间不强行分段。OCR 页尾常常停在句子中间，
 * 如果按页切开，AI 会在缝里"补"标题或改写句子（真踩过）。
 * 只有上一页以句末标点结束，才另起一段；否则直接用空格接上。
 */
export function cleanOcrPages(pages: OcrPage[]): CleanedDocument {
  let figures = 0;
  let text = "";

  for (const page of pages) {
    const raw = pageText(page.text);
    const rewritten = rewriteCaptions(raw, page.index + 1);
    figures += rewritten.figures;

    const body = rewritten.text.trim();
    if (body.length === 0) continue;

    if (text.length === 0) {
      text = body;
      continue;
    }

    text = SENTENCE_END.test(text)
      ? `${text}\n\n${body}`
      : `${text} ${body}`;
  }

  return {
    text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    pageCount: pages.length,
    figures,
  };
}

/** 粗略判断语言：CJK 字符占比超过 25% 视为中文文献，不再翻译。 */
export function looksChinese(text: string): boolean {
  const sample = text.slice(0, 4000);
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  const total = cjk + latin;
  if (total === 0) return false;
  return cjk / total > 0.25;
}

/** 按字符数切块，尽量在段落边界断开。 */
export function chunkText(text: string, maxChars = 5000): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const block of text.split(/\n{2,}/)) {
    if (current.length > 0 && current.length + block.length + 2 > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    current = current.length > 0 ? `${current}\n\n${block}` : block;
  }

  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}
