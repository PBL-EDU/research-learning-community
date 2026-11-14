import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parseCard, type AnyCardV1, type CardParseResult } from "@rlc/contract";
import { renderCardBody } from "./render";

export interface SplitFrontmatter {
  frontmatter: string | null;
  body: string;
}

/** 只认文件开头的 `---` 块；正文里出现的 `---` 分隔线不受影响。 */
export function splitFrontmatter(markdown: string): SplitFrontmatter {
  const text = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---")) return { frontmatter: null, body: text };

  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.trim() === "---") {
      return {
        frontmatter: lines.slice(1, i).join("\n"),
        body: lines
          .slice(i + 1)
          .join("\n")
          .replace(/^\n+/, ""),
      };
    }
  }
  return { frontmatter: null, body: text };
}

/**
 * 文件 → 卡片。
 *
 * 总结类卡片的 `body` 字段存在 Markdown 正文里（否则 YAML 里会出现几千字长字符串，
 * Obsidian 的属性面板会被撑爆）。其余字段一律以 frontmatter 为准。
 */
export function cardFromMarkdown(markdown: string): CardParseResult {
  const { frontmatter, body } = splitFrontmatter(markdown);
  if (frontmatter === null) {
    return {
      ok: false,
      code: "CARD_SCHEMA_UNSUPPORTED",
      message: "文件缺少 YAML frontmatter",
      issues: [],
    };
  }

  let data: unknown;
  try {
    data = parseYaml(frontmatter);
  } catch (error) {
    return {
      ok: false,
      code: "CARD_INVALID",
      message: `frontmatter 不是合法 YAML：${(error as Error).message}`,
      issues: [],
    };
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const schema = record.schema;
    if (typeof schema === "string" && schema.startsWith("sum-") && !record.body) {
      record.body = body.trim();
    }
  }

  return parseCard(data);
}

/** 卡片 → 文件。正文由字段渲染，保证「改 frontmatter 就等于改卡片」。 */
export function cardToMarkdown(card: AnyCardV1): string {
  const { body, ...rest } = card as AnyCardV1 & { body?: string };
  const yaml = stringifyYaml(rest, { lineWidth: 0 }).trimEnd();
  const markdownBody = body ?? renderCardBody(card);
  return `---\n${yaml}\n---\n\n${markdownBody}\n`;
}

/**
 * 只改 frontmatter 的指定字段，正文原样保留。
 * 用于写回发布回执、AI 起草等场景——绝不能因为写个 id 就重排学生写的正文。
 */
export function patchFrontmatter(markdown: string, patch: Record<string, unknown>): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const current = frontmatter ? ((parseYaml(frontmatter) as Record<string, unknown>) ?? {}) : {};
  const merged = { ...current, ...patch };
  const yaml = stringifyYaml(merged, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body}`;
}

export function readFrontmatter(markdown: string): Record<string, unknown> | null {
  const { frontmatter } = splitFrontmatter(markdown);
  if (!frontmatter) return null;
  try {
    const parsed = parseYaml(frontmatter);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
