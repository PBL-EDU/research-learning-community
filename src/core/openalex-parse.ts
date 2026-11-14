/**
 * OpenAlex 响应解析（纯函数，不依赖 Obsidian，可在 Node 里单测）。
 */
export interface PickedPdf {
  pdfUrl?: string;
  landingUrl?: string;
  isOa: boolean;
}

/**
 * 优先 best_oa_location（平台认定的最佳开放获取位置），退化到 primary_location。
 * 没有 pdf_url 就不硬凑——宁可让用户去落地页。
 */
export function pickPdfUrl(payload: unknown): PickedPdf {
  const record = payload as
    | {
        open_access?: { is_oa?: unknown };
        best_oa_location?: { pdf_url?: unknown; landing_page_url?: unknown };
        primary_location?: { pdf_url?: unknown; landing_page_url?: unknown };
      }
    | null;

  const best = record?.best_oa_location;
  const primary = record?.primary_location;

  const pdfUrl =
    typeof best?.pdf_url === "string" && best.pdf_url.length > 0
      ? best.pdf_url
      : typeof primary?.pdf_url === "string" && primary.pdf_url.length > 0
        ? primary.pdf_url
        : undefined;

  const landingUrl =
    typeof best?.landing_page_url === "string" && best.landing_page_url.length > 0
      ? best.landing_page_url
      : typeof primary?.landing_page_url === "string" && primary.landing_page_url.length > 0
        ? primary.landing_page_url
        : undefined;

  return { pdfUrl, landingUrl, isOa: record?.open_access?.is_oa === true };
}
