import { z } from "zod";
import { isSupportedSchema } from "../schema-tag";
import { toIssues, type ContractIssue } from "../issues";
import { DeepReadCardV1 } from "./deep-read";
import { PracticeCardV1 } from "./practice";
import { ArticleSummaryCardV1, DomainSummaryCardV1 } from "./summary";

export { DeepReadCardV1 } from "./deep-read";
export type { DeepReadCardV1 as DeepReadCard } from "./deep-read";
export { PracticeCardV1, PracticePlan, PracticeProcessEntry, PracticeSummary } from "./practice";
export type { PracticeCardV1 as PracticeCard } from "./practice";
export { ArticleSummaryCardV1, DomainSummaryCardV1 } from "./summary";
export type {
  ArticleSummaryCardV1 as ArticleSummaryCard,
  DomainSummaryCardV1 as DomainSummaryCard,
} from "./summary";
export { Visual, VisualImage, VisualMermaid } from "./visual";
export type { Visual as VisualUnion } from "./visual";

/** 四类卡片的判别联合。判别键是 `schema`，不是 `kind`（kind 会随视图变化）。 */
export const AnyCardV1 = z.discriminatedUnion("schema", [
  DeepReadCardV1,
  PracticeCardV1,
  ArticleSummaryCardV1,
  DomainSummaryCardV1,
]);
export type AnyCardV1 = z.infer<typeof AnyCardV1>;

export type CardParseResult =
  | { ok: true; card: AnyCardV1 }
  | {
      ok: false;
      code: "CARD_SCHEMA_UNSUPPORTED" | "CARD_INVALID";
      message: string;
      issues: ContractIssue[];
    };

/**
 * 唯一的卡片入口。三端（插件、服务端、门户）都必须走这里，
 * 不允许任何一端直接调用某个具体卡片的 schema.parse。
 */
export function parseCard(input: unknown): CardParseResult {
  if (input === null || typeof input !== "object") {
    return {
      ok: false,
      code: "CARD_SCHEMA_UNSUPPORTED",
      message: "卡片必须是对象，且带 schema 版本锚点",
      issues: [],
    };
  }

  const rawSchema = (input as { schema?: unknown }).schema;
  if (!isSupportedSchema(rawSchema)) {
    return {
      ok: false,
      code: "CARD_SCHEMA_UNSUPPORTED",
      message:
        typeof rawSchema === "string"
          ? `不支持的卡片版本 ${rawSchema}，请升级 Obsidian 插件后再发布`
          : "缺少 schema 版本锚点，无法判断卡片格式",
      issues: [],
    };
  }

  const result = AnyCardV1.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      code: "CARD_INVALID",
      message: "卡片字段校验失败",
      issues: toIssues(result.error),
    };
  }

  return { ok: true, card: result.data };
}
