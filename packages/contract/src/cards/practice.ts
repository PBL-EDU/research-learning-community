import { z } from "zod";
import { IsoDateTime, Uuid } from "../common";
import { CardEnvelope } from "../envelope";

/** 实践步骤：可勾选，完成时间用于判断「待复盘」。 */
export const PracticeStep = z.object({
  text: z.string().min(1).max(300),
  done: z.boolean().default(false),
  doneAt: IsoDateTime.optional(),
});
export type PracticeStep = z.infer<typeof PracticeStep>;

/** 实践计划：目标 + 步骤 + 资源 + 成功标准（成功标准必填，否则无法复盘）。 */
export const PracticePlan = z.object({
  goal: z.string().min(1).max(500),
  steps: z.array(PracticeStep).min(1).max(20),
  resources: z.array(z.string().min(1).max(200)).max(20).default([]),
  /** 计划开始日：日历打点与提醒用。 */
  scheduledFor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** 可选截止日。 */
  dueBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  successCriteria: z.array(z.string().min(1).max(300)).min(1).max(10),
});
export type PracticePlan = z.infer<typeof PracticePlan>;

/** 过程记录：追加型数组，天然可增量同步、可回放。 */
export const PracticeProcessEntry = z.object({
  /** 日记与卡片缓存的对账键，防止重复。 */
  entryId: Uuid,
  date: IsoDateTime,
  what: z.string().min(1).max(2000),
  evidence: z.string().max(500).optional(),
  obstacle: z.string().max(500).optional(),
  adjust: z.string().max(500).optional(),
  /** 来自哪篇每日笔记。 */
  sourcePath: z.string().max(500).optional(),
});
export type PracticeProcessEntry = z.infer<typeof PracticeProcessEntry>;

/** 实践总结。 */
export const PracticeSummary = z.object({
  outcome: z.string().min(1).max(2000),
  delta: z.string().max(1000).optional(),
  nextTime: z.string().max(1000).optional(),
});
export type PracticeSummary = z.infer<typeof PracticeSummary>;

/**
 * 实践卡片。plan 必填，process / summary 可后补——
 * 因为实践是「边走边记」，强制一次填完等于逼学生编造。
 */
export const PracticeCardV1 = CardEnvelope.extend({
  schema: z.literal("pc-card@1"),
  kind: z.literal("practice"),
  plan: PracticePlan,
  process: z.array(PracticeProcessEntry).max(200).default([]),
  summary: PracticeSummary.optional(),
  /** 引用哪张精读卡片（实践必须来自某个 Aha，否则是凭空立项）。 */
  linkedCards: z.array(Uuid).max(20).default([]),
});
export type PracticeCardV1 = z.infer<typeof PracticeCardV1>;
