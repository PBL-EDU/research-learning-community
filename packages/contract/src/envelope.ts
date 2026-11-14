import { z } from "zod";
import { DomainRef } from "./domain";
import { IsoDateTime, Uuid } from "./common";
import { PublishMeta } from "./publish";
import { CardSchemaTag } from "./schema-tag";

/**
 * 四类卡片共用的信封。
 *
 * 设计要点：`schema` 与 `kind` 在每类卡片里被收窄成对应的字面量，
 * 信封本身只声明公共字段。这样 discriminatedUnion 能拿到精确的判别键。
 */
export const CardKind = z.enum([
  "deep_read",
  "practice",
  "article_summary",
  "domain_summary",
]);
export type CardKind = z.infer<typeof CardKind>;

export const CardEnvelope = z.object({
  schema: CardSchemaTag,
  /** 全局唯一，客户端生成，发布幂等键的一半。 */
  cardId: Uuid,
  kind: CardKind,
  domain: DomainRef,
  /** 主题（领域下的子分组），可选。 */
  theme: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(120),
  tags: z.array(z.string().min(1).max(24)).max(10).default([]),
  /** 发布回执，服务器唯一被允许反向写入本地的一段元数据。 */
  publish: PublishMeta.optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CardEnvelope = z.infer<typeof CardEnvelope>;
