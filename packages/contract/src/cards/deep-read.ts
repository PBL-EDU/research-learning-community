import { z } from "zod";
import { CardEnvelope } from "../envelope";
import { LiteratureSource } from "../source";
import { Visual } from "./visual";

/**
 * 原文摘录硬上限。
 * 版权红线：公开发布的内容里，单段摘录不得超过 300 字。
 * 这个数字同时出现在 schema、发布前校验和公众号质检清单里，改一处必须改三处。
 */
export const QUOTE_MAX_LENGTH = 300;

/** Aha 五点——精读卡片的核心。 */
export const Aha = z.object({
  /** 原文摘录（≤300 字，版权红线） */
  quote: z
    .string()
    .min(1)
    .max(QUOTE_MAX_LENGTH, `原文摘录不得超过 ${QUOTE_MAX_LENGTH} 字（版权红线）`),
  /** 我的生活/教学体验 */
  experience: z.string().min(1).max(2000),
  /** Aha：为什么它推翻了我原来的想法 */
  insight: z.string().min(1).max(2000),
  /** 新启发 */
  inspiration: z.string().min(1).max(2000),
  /** 对生活的意义 */
  meaning: z.string().min(1).max(2000),
});
export type Aha = z.infer<typeof Aha>;

/** 观念价值：它改变了什么认知。 */
export const ConceptValue = z.object({
  level: z.enum(["高", "中", "低"]),
  note: z.string().min(1).max(500),
});
export type ConceptValue = z.infer<typeof ConceptValue>;

/** 行动指导：必须可执行，不是口号。 */
export const ActionGuidance = z.object({
  action: z.string().min(1).max(300),
  trigger: z.string().max(200).optional(),
  metric: z.string().max(200).optional(),
});
export type ActionGuidance = z.infer<typeof ActionGuidance>;

export const DeepReadCardV1 = CardEnvelope.extend({
  schema: z.literal("dr-card@1"),
  kind: z.literal("deep_read"),
  source: LiteratureSource,
  aha: Aha,
  conceptValue: ConceptValue,
  /** 至少一条可执行动作：没有行动指导的精读卡片，不允许发布。 */
  actionGuidance: z.array(ActionGuidance).min(1).max(5),
  visuals: z.array(Visual).max(3).default([]),
});
export type DeepReadCardV1 = z.infer<typeof DeepReadCardV1>;
