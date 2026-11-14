import { z } from "zod";
import { HttpUrl, IsoDateTime } from "./common";
import { DomainRef } from "./domain";
import { toIssues, type ContractIssue } from "./issues";

/**
 * 文献状态机。
 * 卡片挂在文献下，文献本身要有「读到哪一步」的状态，否则总览里看不出进度。
 */
export const LiteratureStatus = z.enum([
  "to_read", // 已加入，还没开始
  "skimming", // 略读中
  "reading", // 精读中
  "deep_read", // 已产出至少一张精读卡片
  "done", // 这篇读完了
  "skipped", // 略读后判断不值得精读
]);
export type LiteratureStatus = z.infer<typeof LiteratureStatus>;

export const LITERATURE_SCHEMA = "lit@1" as const;

/**
 * 文献笔记：Vault 里「领域/文献」这一层的实体。
 *
 * 它只存元数据与状态，不存原文。原文永不上传（版权红线），
 * 所以这里没有 pdf 路径字段，只有一个可选的本地路径用于个人标注。
 */
export const LiteratureNote = z
  .object({
    schema: z.literal(LITERATURE_SCHEMA),
    /** 目录名与引用键，同领域内唯一。由 vault-core 的 citekeyFor 生成。 */
    citekey: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "citekey 只能是小写字母、数字和连字符"),
    domain: DomainRef,
    title: z.string().min(1).max(300),
    /** 中文译名，用于侧栏悬停提示；由 AI 翻译一次后存下。 */
    titleZh: z.string().min(1).max(300).optional(),
    authors: z.array(z.string().min(1).max(80)).max(50).default([]),
    year: z.number().int().min(1500).max(2100).optional(),
    doi: z.string().regex(/^10\.\d{4,9}\/\S+$/, "DOI 形如 10.1000/xyz123").optional(),
    url: HttpUrl.optional(),
    status: LiteratureStatus.default("to_read"),
    /** 本地原文 PDF 的 Vault 相对路径。只存本地，永不上传（版权红线）。 */
    pdfPath: z.string().max(300).optional(),
    addedAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .refine((note) => Boolean(note.doi ?? note.url), {
    message: "文献至少要有 DOI 或链接——无法核验的文献不进综述",
    path: ["doi"],
  });
export type LiteratureNote = z.infer<typeof LiteratureNote>;

export const LITERATURE_REVIEW_SCHEMA = "lit-review@1" as const;

/** 领域文献综述的元信息。综述正文在 Markdown 里，这里只放可检索的字段。 */
export const LiteratureReviewMeta = z.object({
  schema: z.literal(LITERATURE_REVIEW_SCHEMA),
  domain: DomainRef,
  createdAt: IsoDateTime,
  model: z.string().max(80).optional(),
});
export type LiteratureReviewMeta = z.infer<typeof LiteratureReviewMeta>;

export type LiteratureParseResult =
  | { ok: true; note: LiteratureNote }
  | {
      ok: false;
      code: "LITERATURE_SCHEMA_UNSUPPORTED" | "LITERATURE_INVALID";
      message: string;
      issues: ContractIssue[];
    };

export function parseLiterature(input: unknown): LiteratureParseResult {
  if (input === null || typeof input !== "object") {
    return {
      ok: false,
      code: "LITERATURE_SCHEMA_UNSUPPORTED",
      message: "文献笔记必须是对象",
      issues: [],
    };
  }

  const schema = (input as { schema?: unknown }).schema;
  if (schema !== LITERATURE_SCHEMA) {
    return {
      ok: false,
      code: "LITERATURE_SCHEMA_UNSUPPORTED",
      message:
        typeof schema === "string"
          ? `不支持的文献版本 ${schema}，请升级插件`
          : "缺少 schema 版本锚点",
      issues: [],
    };
  }

  const result = LiteratureNote.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      code: "LITERATURE_INVALID",
      message: "文献字段校验失败",
      issues: toIssues(result.error),
    };
  }

  return { ok: true, note: result.data };
}
