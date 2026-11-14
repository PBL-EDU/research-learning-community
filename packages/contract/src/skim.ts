import { z } from "zod";
import { IsoDateTime } from "./common";
import { DomainRef } from "./domain";

export const SKIM_SCHEMA = "skim@1" as const;

/** 略读结论：精读、跳过、或信息不足未定。 */
export const SkimDecision = z.enum(["deep_read", "skip", "undecided"]);
export type SkimDecision = z.infer<typeof SkimDecision>;

export const SkimConfidence = z.enum(["高", "中", "低"]);
export type SkimConfidence = z.infer<typeof SkimConfidence>;

/**
 * 略读报告的元信息。
 *
 * `decision` 不是给人看的装饰——它驱动文献状态机：
 * deep_read → 文献状态推进到「精读中」，skip → 推进到「已跳过」。
 */
export const SkimReportMeta = z.object({
  schema: z.literal(SKIM_SCHEMA),
  citekey: z.string().min(2).max(64),
  domain: DomainRef,
  decision: SkimDecision.default("undecided"),
  confidence: SkimConfidence.optional(),
  createdAt: IsoDateTime,
  model: z.string().max(80).optional(),
});
export type SkimReportMeta = z.infer<typeof SkimReportMeta>;
