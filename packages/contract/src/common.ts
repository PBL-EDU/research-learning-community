import { z } from "zod";

/**
 * 带时区的 ISO-8601 时间。服务端一律存 UTC，展示层再转 Asia/Shanghai。
 *
 * 故意不用 z.iso.datetime() / z.string().datetime() 这类与 Zod 主版本强绑定的
 * API：契约包是三端共用的地基，不能因为一次依赖升级就悄悄放宽校验。
 */
export const IsoDateTime = z.string().refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
  { message: "必须是带时区的 ISO-8601 时间，例如 2026-11-13T10:00:00+08:00" },
);
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** 领域 slug，用于门户路由 `/d/{slug}`。 */
export const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug 只允许小写字母、数字和连字符");
export type Slug = z.infer<typeof Slug>;

/** 对外展示的 handle（未成年人合规：公开页只出现 handle，不出现真名）。 */
export const Handle = z
  .string()
  .min(2)
  .max(32)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    "handle 只允许小写字母、数字、下划线和连字符，且以字母或数字开头",
  );
export type Handle = z.infer<typeof Handle>;

export const Uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "不是合法的 UUID",
  );
export type Uuid = z.infer<typeof Uuid>;

/** 只接受 http(s)，拒绝 `javascript:` 一类协议进入渲染链路。 */
export const HttpUrl = z.string().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}, { message: "必须是 http(s) URL" });
export type HttpUrl = z.infer<typeof HttpUrl>;

/** 资产去重与完整性校验统一用 `sha256:<hex>`。 */
export const Sha256Hex = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "必须是 sha256:<64 位小写 hex>");
export type Sha256Hex = z.infer<typeof Sha256Hex>;
