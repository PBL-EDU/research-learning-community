import { z } from "zod";

/**
 * 卡片 schema 版本锚点——这是整个系统的「兼容性开关」。
 *
 * 规则（写死在 parseCard 里）：服务端只接受它认识的版本；
 * 不认识就返回 CARD_SCHEMA_UNSUPPORTED 并提示升级插件，绝不"尽力解析"。
 * 理由：前端插件会长期存在 N-2 个版本，宽松解析会把脏数据写进数据库，
 * 而这种污染在事后几乎无法区分「用户填错」还是「版本不兼容」。
 */
export const CardSchemaTag = z.enum([
  "dr-card@1",
  "pc-card@1",
  "sum-article@1",
  "sum-domain@1",
]);
export type CardSchemaTag = z.infer<typeof CardSchemaTag>;

export const SUPPORTED_SCHEMAS: readonly CardSchemaTag[] = CardSchemaTag.options;

export function isSupportedSchema(value: unknown): value is CardSchemaTag {
  return typeof value === "string" && (SUPPORTED_SCHEMAS as readonly string[]).includes(value);
}
