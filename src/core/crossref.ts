import { requestUrl } from "obsidian";
import { titleMatches } from "./review";

export type DoiVerdict = "verified" | "title-mismatch" | "not-found" | "network-error";

export interface DoiCheckResult {
  verdict: DoiVerdict;
  remoteTitle?: string;
}

/**
 * 用 Crossref 核验 DOI 是否真实存在、标题是否对得上。
 *
 * 这是「AI 提议文献」这个流程里唯一的硬闸：
 * 模型可以编标题、编作者、编 DOI，但编不出 Crossref 里真实存在的记录。
 */
export async function checkDoi(doi: string, expectedTitle: string): Promise<DoiCheckResult> {
  try {
    const response = await requestUrl({
      url: `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      method: "GET",
      headers: { Accept: "application/json" },
      throw: false,
    });

    if (response.status === 404) return { verdict: "not-found" };
    if (response.status !== 200) return { verdict: "network-error" };

    const remoteTitle = response.json?.message?.title?.[0];
    if (typeof remoteTitle !== "string" || remoteTitle.trim().length === 0) {
      return { verdict: "not-found" };
    }

    return {
      verdict: titleMatches(remoteTitle, expectedTitle) ? "verified" : "title-mismatch",
      remoteTitle,
    };
  } catch {
    return { verdict: "network-error" };
  }
}
