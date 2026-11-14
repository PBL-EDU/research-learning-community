import {
  type AnyCardV1,
  type AssetDecl,
  type AssetMime,
  type PromoVariant,
  type PublishPayload,
  type Visibility,
} from "@rlc/contract";

export interface LocalAsset {
  /** Vault 相对路径，例如 领域/…/assets/dr-7f3a2c-aha.png */
  path: string;
  role: "visual" | "cover" | "inline";
  mime: AssetMime;
  bytes: number;
  sha256: string;
  data: ArrayBuffer;
}

export const MIME_BY_EXTENSION: Record<string, AssetMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** 白名单之外一律返回 null——PDF、SVG 都进不来。 */
export function guessMime(path: string): AssetMime | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] ?? null;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

export function toAssetDecls(assets: LocalAsset[]): AssetDecl[] {
  return assets.map((asset) => ({
    localPath: asset.path,
    role: asset.role,
    mime: asset.mime,
    sha256: asset.sha256,
    bytes: asset.bytes,
  }));
}

export interface BuildPayloadInput {
  card: AnyCardV1;
  /** 完整 Markdown（含 frontmatter），服务端逐字保存。 */
  bodyMd: string;
  visibility: Visibility;
  assets: LocalAsset[];
  /** 科普版（按读者画像），来自卡片旁的侧车文件。 */
  variants?: PromoVariant[];
}

export function buildPublishPayload(input: BuildPayloadInput): PublishPayload {
  const { card } = input;
  return {
    schema: card.schema,
    clientCardId: card.cardId,
    kind: card.kind,
    domain: card.domain,
    title: card.title,
    bodyMd: input.bodyMd,
    frontmatter: card as unknown as Record<string, unknown>,
    assets: toAssetDecls(input.assets),
    source: card.schema === "dr-card@1" ? card.source : undefined,
    visibility: input.visibility,
    acknowledge: {
      // 这两个 true 是产品红线：学生确实被问过，而不是前端默认勾选。
      noPdfUploaded: true,
      citeLengthUnder300: true,
    },
    variants: input.variants ?? [],
  };
}

export interface MultipartFile {
  filename: string;
  mime: string;
  data: ArrayBuffer;
}

export interface MultipartResult {
  body: ArrayBuffer;
  contentType: string;
}

function safeFilename(filename: string): string {
  return filename.replace(/["\r\n\\]/g, "_");
}

/**
 * 手写 multipart：requestUrl 不支持 FormData，
 * 所以这里自己拼 body。格式与浏览器 FormData 一致，服务端无需特殊处理。
 */
export function buildMultipart(payload: unknown, files: MultipartFile[]): MultipartResult {
  const boundary = `----rlc${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  const encoder = new TextEncoder();
  const segments: Uint8Array[] = [];

  segments.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n`,
    ),
  );
  segments.push(encoder.encode(JSON.stringify(payload)));
  segments.push(encoder.encode("\r\n"));

  for (const file of files) {
    segments.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="assets"; filename="${safeFilename(
          file.filename,
        )}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
      ),
    );
    segments.push(new Uint8Array(file.data));
    segments.push(encoder.encode("\r\n"));
  }

  segments.push(encoder.encode(`--${boundary}--\r\n`));

  const total = segments.reduce((sum, segment) => sum + segment.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const segment of segments) {
    body.set(segment, offset);
    offset += segment.byteLength;
  }

  return { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}
