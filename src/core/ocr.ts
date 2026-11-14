import { requestUrl } from "obsidian";
import type { OcrPage } from "./ocr-parse";

/**
 * DeepSeek OCR 工具接口。
 *
 * 不是 OpenAI 兼容路径：`POST {base}/tools/ocr`，multipart 传 file + purpose。
 * 文档：https://api-docs.deepseek.com/zh-cn/guides/ocr/
 *
 * 选 rich_layout_recognition 是为了拿到图注的版面信息（暂时只用文字，
 * 坐标留给下一版裁图）。
 */
export class OcrError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "OcrError";
  }
}

export function ocrEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/tools/ocr` : `${base}/v1/tools/ocr`;
}

const MAX_BYTES = 20 * 1024 * 1024;

function buildMultipart(
  filename: string,
  data: ArrayBuffer,
): { body: ArrayBuffer; boundary: string } {
  const boundary = `----rlcocr${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
  const encoder = new TextEncoder();
  const segments: Uint8Array[] = [];

  segments.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nrich_layout_recognition\r\n`,
    ),
  );
  segments.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
  );
  segments.push(new Uint8Array(data));
  segments.push(encoder.encode(`\r\n--${boundary}--\r\n`));

  const total = segments.reduce((sum, segment) => sum + segment.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const segment of segments) {
    body.set(segment, offset);
    offset += segment.byteLength;
  }

  return { body: body.buffer, boundary };
}

export interface OcrOptions {
  baseUrl: string;
  apiKey: string;
  filename?: string;
  data: ArrayBuffer;
}

export async function ocrPdf(options: OcrOptions): Promise<OcrPage[]> {
  if (options.data.byteLength > MAX_BYTES) {
    throw new OcrError(
      `PDF 有 ${(options.data.byteLength / 1024 / 1024).toFixed(1)}MB，超过 20MB 上限；先拆分或压缩再试`,
    );
  }

  const multipart = buildMultipart(options.filename ?? "原文.pdf", options.data);

  let response;
  try {
    response = await requestUrl({
      url: ocrEndpoint(options.baseUrl),
      method: "POST",
      contentType: `multipart/form-data; boundary=${multipart.boundary}`,
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: multipart.body,
      throw: false,
    });
  } catch (error) {
    throw new OcrError("OCR 请求失败，检查网络与接口地址", (error as Error).message);
  }

  // 响应体前可能有大量换行保活，先 trim 再当 JSON 解析。
  const text = response.text.trim();

  if (response.status >= 400) {
    throw new OcrError(`OCR 返回 ${response.status}`, text.slice(0, 400));
  }

  let json: {
    pages?: Array<{ index?: unknown; text?: unknown }>;
    error?: { message?: string };
    page_count?: number;
  };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new OcrError("OCR 返回的不是 JSON", text.slice(0, 300));
  }

  if (json.error) {
    throw new OcrError("OCR 失败", json.error.message ?? text.slice(0, 300));
  }

  const pages: OcrPage[] = [];
  for (const page of json.pages ?? []) {
    const index = typeof page.index === "number" ? page.index : pages.length;
    const content = typeof page.text === "string" ? page.text : "";
    pages.push({ index, text: content });
  }

  if (pages.length === 0) {
    throw new OcrError("OCR 没有返回页面文字：可能是加密 PDF、损坏文件，或服务端识别失败");
  }

  return pages;
}
