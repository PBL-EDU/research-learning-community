import { z } from "zod";
import { Uuid } from "../common";
import { CardEnvelope } from "../envelope";
import { LiteratureSource } from "../source";

/**
 * 文章阅读总结：对整篇文献的阅读感悟，包含这篇文章产出的精读卡片。
 * body 是 Markdown 正文；cardIds 用于门户上「总结 ↔ 卡片」互链。
 */
export const ArticleSummaryCardV1 = CardEnvelope.extend({
  schema: z.literal("sum-article@1"),
  kind: z.literal("article_summary"),
  source: LiteratureSource,
  body: z.string().min(1).max(20000),
  overall: z.string().min(1).max(2000),
  cardIds: z.array(Uuid).max(50).default([]),
});
export type ArticleSummaryCardV1 = z.infer<typeof ArticleSummaryCardV1>;

/**
 * 领域总结：阅读总结或实践总结，必须索引到具体卡片。
 * 「没有 index 的总结只是感想」，这条在 schema 层强制执行。
 */
export const DomainSummaryCardV1 = CardEnvelope.extend({
  schema: z.literal("sum-domain@1"),
  kind: z.literal("domain_summary"),
  scope: z.enum(["reading", "practice"]),
  body: z.string().min(1).max(30000),
  index: z.array(Uuid).min(1).max(200),
});
export type DomainSummaryCardV1 = z.infer<typeof DomainSummaryCardV1>;
