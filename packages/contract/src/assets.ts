import { z } from "zod";
import { Sha256Hex } from "./common";

/**
 * 资产白名单。
 *
 * 只放行位图，**不放行 SVG**：SVG 可携带脚本，一旦门户以 inline 方式渲染就是存储型 XSS。
 * mermaid 图在服务端转成 PNG 后再进这条链路。
 *
 * 更关键的是：这里没有 application/pdf。文献 PDF 永不上传（ADR + 版权红线 R1）。
 */
export const ASSET_MIME_ALLOWLIST = ["image/png", "image/jpeg", "image/webp"] as const;
export const AssetMime = z.enum(ASSET_MIME_ALLOWLIST);
export type AssetMime = z.infer<typeof AssetMime>;

export const ASSET_MAX_BYTES = 8 * 1024 * 1024;

export function isAllowedAssetMime(mime: string): mime is AssetMime {
  return (ASSET_MIME_ALLOWLIST as readonly string[]).includes(mime);
}

/** 发布请求里对资产的声明；二进制另走 multipart 同名对齐。 */
export const AssetDecl = z.object({
  localPath: z.string().min(1).max(300),
  role: z.enum(["visual", "cover", "inline"]),
  mime: AssetMime,
  sha256: Sha256Hex,
  bytes: z.number().int().positive().max(ASSET_MAX_BYTES),
});
export type AssetDecl = z.infer<typeof AssetDecl>;
