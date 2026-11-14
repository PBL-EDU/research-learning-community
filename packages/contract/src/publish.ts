import { z } from "zod";
import { HttpUrl, IsoDateTime, Sha256Hex } from "./common";

export const Visibility = z.enum(["public", "community", "private"]);
export type Visibility = z.infer<typeof Visibility>;

/**
 * 发布回执。由插件在发布成功后回写到本地 frontmatter，学生不需要手填。
 *
 * 注意：这是唯一允许「服务器 → 本地」的写入方向，且只写这一段元数据。
 * Vault 正文永远不会被服务器反向覆盖（ADR-001）。
 */
export const PublishMeta = z.object({
  /** publication id，形如 pub_01Jxxxxxxxxxxxxxxxxxxxxxxx */
  id: z.string().regex(/^pub_[0-9A-Za-z]{20,32}$/, "publication id 形如 pub_01J...").optional(),
  url: HttpUrl.optional(),
  revision: z.number().int().min(1).optional(),
  hash: Sha256Hex.optional(),
  at: IsoDateTime.optional(),
  visibility: Visibility.optional(),
});
export type PublishMeta = z.infer<typeof PublishMeta>;
