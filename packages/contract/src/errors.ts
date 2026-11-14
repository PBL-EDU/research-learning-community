import { z } from "zod";

/**
 * 错误码是跨端契约的一部分：插件按 code 决定「提示用户」还是「自动重试」，
 * 门户按 code 决定「引导登录」还是「展示 404」。
 * 所以它是封闭枚举，不允许服务端随手返回新字符串。
 */
export const ErrorCode = z.enum([
  // 卡片
  "CARD_SCHEMA_UNSUPPORTED",
  "CARD_INVALID",
  "CARD_NOT_PUBLISHABLE",
  // 资产
  "ASSET_TYPE_FORBIDDEN",
  "ASSET_TOO_LARGE",
  "ASSET_HASH_MISMATCH",
  // 发布
  "IDEMPOTENT_REPLAY",
  "PUBLICATION_NOT_FOUND",
  "PUBLICATION_WITHDRAWN",
  // 通用
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    /** 贯穿日志与前端报错的追踪 id，线上定位的起点。 */
    requestId: z.string().min(1),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
