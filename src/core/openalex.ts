import { requestUrl } from "obsidian";
import { pickPdfUrl } from "./openalex-parse";

export type OaStatus = "pdf" | "oa-no-pdf" | "not-oa" | "error";

export interface OaResult {
  status: OaStatus;
  pdfUrl?: string;
  landingUrl?: string;
  message?: string;
}

/**
 * 查询某 DOI 的开放获取版本。
 *
 * 只下 OA：付费墙文献一律不碰——这不是技术限制，是版权边界。
 */
export async function lookupOpenAccess(doi: string): Promise<OaResult> {
  try {
    const response = await requestUrl({
      url: `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`,
      method: "GET",
      headers: { Accept: "application/json" },
      throw: false,
    });

    if (response.status === 404) return { status: "not-oa", message: "OpenAlex 查不到这个 DOI" };
    if (response.status !== 200) return { status: "error", message: `OpenAlex 返回 ${response.status}` };

    const picked = pickPdfUrl(response.json);
    if (picked.pdfUrl) {
      return { status: "pdf", pdfUrl: picked.pdfUrl, landingUrl: picked.landingUrl };
    }
    if (picked.isOa) {
      return {
        status: "oa-no-pdf",
        landingUrl: picked.landingUrl,
        message: "开放获取，但没有直接 PDF 链接",
      };
    }
    return { status: "not-oa", landingUrl: picked.landingUrl, message: "这篇不是开放获取" };
  } catch (error) {
    return { status: "error", message: (error as Error).message };
  }
}
