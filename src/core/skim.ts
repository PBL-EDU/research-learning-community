/**
 * 略读结论解析。
 *
 * AI 在报告末尾输出：
 * <!-- rlc:verdict {"decision":"deep_read","confidence":"高","reasons":["…"]} rlc:verdict -->
 *
 * 解析失败一律回落为 undecided —— 宁可让状态停在原地，
 * 也不要因为模型少写一个引号就把文献误标成「已跳过」。
 */
export type SkimDecisionValue = "deep_read" | "skip" | "undecided";
export type SkimConfidenceValue = "高" | "中" | "低";

export interface SkimVerdict {
  decision: SkimDecisionValue;
  confidence?: SkimConfidenceValue;
  reasons: string[];
}

const BLOCK = /<!--\s*rlc:verdict\s*([\s\S]*?)\s*rlc:verdict\s*-->/i;

export function parseSkimVerdict(markdown: string): SkimVerdict {
  const fallback: SkimVerdict = { decision: "undecided", reasons: [] };
  const match = markdown.match(BLOCK);
  if (!match) return fallback;

  let data: unknown;
  try {
    data = JSON.parse(match[1] ?? "");
  } catch {
    return fallback;
  }
  if (!data || typeof data !== "object") return fallback;

  const record = data as Record<string, unknown>;
  const decision =
    record.decision === "deep_read" || record.decision === "skip" || record.decision === "undecided"
      ? record.decision
      : "undecided";

  const confidence =
    record.confidence === "高" || record.confidence === "中" || record.confidence === "低"
      ? record.confidence
      : undefined;

  const reasons = Array.isArray(record.reasons)
    ? record.reasons
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];

  return { decision, confidence, reasons };
}

/** 去掉结论块，正文里不留机器标记。 */
export function stripSkimVerdict(markdown: string): string {
  return markdown.replace(BLOCK, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** 文献状态如何随结论推进。 */
export function statusForDecision(decision: SkimDecisionValue): "reading" | "skipped" | null {
  if (decision === "deep_read") return "reading";
  if (decision === "skip") return "skipped";
  return null;
}
