import { z } from "zod";
import { HttpUrl } from "./common";

/**
 * 文献来源。
 *
 * 这里有一条产品红线级别的约束：doi 与 url 至少有一个。
 * 理由见架构文档 R3——AI 编造文献是本系统最大的质量风险，
 * 「无法核验的引文不许发布」必须在 schema 层拦住，而不是靠 UI 提示。
 */
export const LicenseHint = z
  .enum(["cc-by", "cc-by-sa", "cc0", "public-domain", "publisher", "unknown"])
  .default("unknown");
export type LicenseHint = z.infer<typeof LicenseHint>;

export const LiteratureSource = z
  .object({
    type: z.literal("literature"),
    citekey: z.string().min(1).max(64).optional(),
    /** DOI，形如 10.1000/xyz123 */
    doi: z.string().regex(/^10\.\d{4,9}\/\S+$/, "DOI 形如 10.1000/xyz123").optional(),
    title: z.string().min(1).max(300),
    authors: z.array(z.string().min(1).max(80)).max(50).default([]),
    year: z.number().int().min(1500).max(2100).optional(),
    url: HttpUrl.optional(),
    license: LicenseHint,
  })
  .refine((source) => Boolean(source.doi ?? source.url), {
    message: "文献必须至少有一个可核验的 DOI 或 URL（防止 AI 编造）",
    path: ["doi"],
  });
export type LiteratureSource = z.infer<typeof LiteratureSource>;
