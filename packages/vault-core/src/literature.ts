import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  LITERATURE_REVIEW_SCHEMA,
  parseLiterature,
  type LiteratureNote,
  type LiteratureParseResult,
} from "@rlc/contract";
import { splitFrontmatter } from "./frontmatter";

const LITERATURE_BODY = [
  "## 摘要",
  "",
  "（粘贴摘要；没有也没关系，略读报告会写「摘要未提供」）",
  "",
  "## 为什么读它",
  "",
  "",
  "## 读后判断",
  "",
  "- [ ] 值得精读",
  "- [ ] 只做略读",
  "",
].join("\n");

export function literatureToMarkdown(note: LiteratureNote): string {
  const yaml = stringifyYaml(note, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${LITERATURE_BODY}`;
}

/**
 * 新建文献时的文件内容。
 * 元数据进 frontmatter，正文留三段固定结构，学生只需要往下写。
 */
export function literatureTemplate(note: LiteratureNote): string {
  return literatureToMarkdown(note);
}

export function literatureFromMarkdown(markdown: string): LiteratureParseResult {
  const { frontmatter } = splitFrontmatter(markdown);
  if (frontmatter === null) {
    return {
      ok: false,
      code: "LITERATURE_SCHEMA_UNSUPPORTED",
      message: "文献文件缺少 YAML frontmatter",
      issues: [],
    };
  }

  let data: unknown;
  try {
    data = parseYaml(frontmatter);
  } catch (error) {
    return {
      ok: false,
      code: "LITERATURE_INVALID",
      message: `frontmatter 不是合法 YAML：${(error as Error).message}`,
      issues: [],
    };
  }

  return parseLiterature(data);
}

const DEFAULT_REVIEW_BODY = [
  "## 这个领域在争论什么",
  "",
  "",
  "## 主要脉络",
  "",
  "### 脉络一",
  "",
  "",
  "## 已有研究的空白",
  "",
  "",
  "## 对我而言，下一步读什么",
  "",
  "",
  "## 参考文献",
  "",
  "（用 `[[文献/<citekey>/文献信息]]` 链接到文献笔记，一条一行）",
  "",
].join("\n");

/** 领域文献综述的完整文件（frontmatter + 正文）。 */
export function literatureReviewDocument(input: {
  domainName: string;
  domainSlug: string;
  createdAt: string;
  body: string;
}): string {
  const yaml = stringifyYaml(
    {
      schema: LITERATURE_REVIEW_SCHEMA,
      domain: { name: input.domainName, slug: input.domainSlug },
      createdAt: input.createdAt,
    },
    { lineWidth: 0 },
  ).trimEnd();

  return `---\n${yaml}\n---\n\n${input.body.trimEnd()}\n`;
}

/** 领域文献综述的初始文件：结构先立起来，内容等文献够了再生成。 */
export function literatureReviewTemplate(input: {
  domainName: string;
  domainSlug: string;
  createdAt: string;
}): string {
  const header = [
    `# ${input.domainName} · 文献综述`,
    "",
    "> 这份综述只应引用本领域「文献」目录下已录入的文献。",
    "> 没有录入的文献不要写进来——无法核验的引用是大忌。",
    "",
  ].join("\n");

  return literatureReviewDocument({ ...input, body: `${header}\n${DEFAULT_REVIEW_BODY}` });
}
