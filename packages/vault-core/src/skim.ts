import { stringify as stringifyYaml } from "yaml";
import { SKIM_SCHEMA, type SkimConfidence, type SkimDecision } from "@rlc/contract";

export interface SkimReportDocumentInput {
  domainName: string;
  domainSlug: string;
  citekey: string;
  decision: SkimDecision;
  confidence?: SkimConfidence;
  createdAt: string;
  body: string;
  model?: string;
}

/** 略读报告文件：frontmatter 存结论，正文存四节分析。 */
export function skimReportDocument(input: SkimReportDocumentInput): string {
  const yaml = stringifyYaml(
    {
      schema: SKIM_SCHEMA,
      citekey: input.citekey,
      domain: { name: input.domainName, slug: input.domainSlug },
      decision: input.decision,
      ...(input.confidence ? { confidence: input.confidence } : {}),
      createdAt: input.createdAt,
      ...(input.model ? { model: input.model } : {}),
    },
    { lineWidth: 0 },
  ).trimEnd();

  return `---\n${yaml}\n---\n\n${input.body.trimEnd()}\n`;
}

/**
 * 从 Markdown 里抽出一节的内容（按标题层级找，遇到同级或更高级标题就停）。
 * 用于把文献笔记里的「## 摘要」喂给略读提示词。
 */
export function extractSection(markdown: string, heading: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const target = heading.trim();
  let startLine = -1;
  let targetLevel = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{2,6})\s+(.+?)\s*$/.exec(lines[i] ?? "");
    if (!match) continue;

    const level = (match[1] ?? "").length;
    const title = (match[2] ?? "").trim();

    if (startLine < 0) {
      if (title === target) {
        startLine = i + 1;
        targetLevel = level;
      }
      continue;
    }

    if (level <= targetLevel) {
      return lines.slice(startLine, i).join("\n").trim();
    }
  }

  return startLine < 0 ? "" : lines.slice(startLine).join("\n").trim();
}
