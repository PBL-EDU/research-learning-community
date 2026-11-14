import { z } from "zod";
import { Sha256Hex } from "../common";

/**
 * 视觉图。两类：
 * - mermaid：结构图，由服务端渲染成 SVG/PNG 后发布（低成本、可控、不烧钱）
 * - image：AI 生图，保留 prompt 以便复现与重生成
 *
 * 注意：SVG 不进资产白名单（可携带脚本），mermaid 在服务端转成 PNG 再上传。
 */
export const VisualMermaid = z.object({
  kind: z.literal("mermaid"),
  path: z.string().min(1).max(300),
  /** 可选：把 mermaid 源码一起存进 frontmatter，便于重渲染时无需读附件。 */
  code: z.string().max(20000).optional(),
});
export type VisualMermaid = z.infer<typeof VisualMermaid>;

export const VisualImage = z.object({
  kind: z.literal("image"),
  path: z.string().min(1).max(300),
  prompt: z.string().max(2000).optional(),
  sha256: Sha256Hex.optional(),
});
export type VisualImage = z.infer<typeof VisualImage>;

export const Visual = z.discriminatedUnion("kind", [VisualMermaid, VisualImage]);
export type Visual = z.infer<typeof Visual>;
