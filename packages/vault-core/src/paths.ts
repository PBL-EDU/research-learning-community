import type { CardKind, LiteratureStatus } from "@rlc/contract";

/**
 * Vault 目录约定 v2：领域 → 文献 → 精读卡片。
 *
 * ```
 * 领域/<领域名>/
 * ├─ 文献综述.md
 * └─ 文献/<citekey>/
 *    ├─ 文献信息.md
 *    ├─ 略读报告.md
 *    ├─ 精读卡片/dr-xxxxxxx.md
 *    ├─ 实践卡片/pc-xxxxxxx.md
 *    ├─ 文章总结/sum-xxxxxxx.md
 *    └─ assets/
 * ```
 *
 * 为什么文献要成为独立一层：
 * - 精读卡片天然属于某篇文献，挂在主题下会让「这篇文献产出了几张卡片」无法回答；
 * - 文献有自己的状态（未读/略读/精读/读完），总览才能显示进度；
 * - 同一篇文献可能被多个主题引用，文献层是唯一实体。
 */
export const SYSTEM_DIR = "00-系统";
export const DOMAINS_DIR = "领域";
export const LITERATURE_DIR = "文献";
export const EXTRACT_DIR = "公众摘取";

/** Windows 不允许的字符 + Obsidian 链接里会出问题的字符。 */
const UNSAFE = /[\\/:*?"<>|#^[\]]/g;

export function safeSegment(input: string, fallback: string): string {
  const cleaned = input
    .replace(UNSAFE, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  return cleaned.length === 0 ? fallback : cleaned.slice(0, 60);
}

export function shortId(cardId: string): string {
  return cardId.replace(/-/g, "").slice(0, 7);
}

export function domainDir(domainName: string): string {
  return `${DOMAINS_DIR}/${safeSegment(domainName, "未命名领域")}`;
}

export function literatureDir(domainName: string, citekey: string): string {
  return `${domainDir(domainName)}/${LITERATURE_DIR}/${safeSegment(citekey, "未命名文献")}`;
}

/**
 * 文献信息文件：**文件名与文件夹同名**。
 *
 * 这样在 Obsidian 文件树里，文件夹 `johnstone-2006-44f2` 里的所有文件
 * 都以同一个前缀开头，一眼能对上属于哪篇文献。
 */
export function literatureNotePath(domainName: string, citekey: string): string {
  const key = safeSegment(citekey, "citekey");
  return `${literatureDir(domainName, citekey)}/${key}.md`;
}

export function skimReportPath(domainName: string, citekey: string): string {
  const key = safeSegment(citekey, "citekey");
  return `${literatureDir(domainName, citekey)}/${key}-略读.md`;
}

/** 整理后的全文（OCR + 分节 + 双语对照），与文献文件夹同名前缀。 */
export function fullTextPath(domainName: string, folder: string): string {
  const key = safeSegment(folder, "citekey");
  return `${literatureDir(domainName, folder)}/${key}-全文.md`;
}

/** 原文 PDF 的默认位置：直接放在文献文件夹里，不套子目录。 */
export function pdfPath(domainName: string, folder: string): string {
  return `${literatureDir(domainName, folder)}/原文.pdf`;
}

export function literatureReviewPath(domainName: string): string {
  return `${domainDir(domainName)}/文献综述.md`;
}

export function assetsDir(domainName: string, citekey: string): string {
  return `${literatureDir(domainName, citekey)}/assets`;
}

export function cardFilePath(
  kind: CardKind,
  domainName: string,
  citekey: string,
  cardId: string,
): string {
  const sid = shortId(cardId);
  if (kind === "domain_summary") {
    return `${domainDir(domainName)}/领域总结-阅读.md`;
  }

  // 卡片直接放在文献文件夹里，文件名带文献前缀，不再套「精读卡片/」子目录。
  const base = literatureDir(domainName, citekey);
  const key = safeSegment(citekey, "citekey");
  switch (kind) {
    case "deep_read":
      return `${base}/${key}-dr-${sid}.md`;
    case "practice":
      return `${base}/${key}-pc-${sid}.md`;
    case "article_summary":
      return `${base}/${key}-sum-${sid}.md`;
  }
}

export function domainSummaryPath(domainName: string, scope: "reading" | "practice"): string {
  return `${domainDir(domainName)}/领域总结-${scope === "reading" ? "阅读" : "实践"}.md`;
}

export function extractPath(date: string, short: string): string {
  return `${EXTRACT_DIR}/${date}-讨论摘取-${short}.md`;
}

export function systemFile(name: string): string {
  return `${SYSTEM_DIR}/${name}`;
}

export const OUTBOX_PATH = systemFile("publish-outbox.jsonl");



export interface CardLocation {
  domain: string;
  citekey: string | null;
  kind: "deep_read" | "practice" | "article_summary" | "domain_summary" | "unknown";
}

const FOLDER_KIND: Record<string, CardLocation["kind"]> = {
  "精读卡片": "deep_read",
  "实践卡片": "practice",
  "文章总结": "article_summary",
};

/** 新布局：卡片直接放在文献文件夹里，靠文件名后缀判断类型。 */
const FILE_KIND: Array<{ pattern: RegExp; kind: CardLocation["kind"] }> = [
  { pattern: /-dr-[0-9a-f]{6,8}\.md$/i, kind: "deep_read" },
  { pattern: /-pc-[0-9a-f]{6,8}\.md$/i, kind: "practice" },
  { pattern: /-sum-[0-9a-f]{6,8}\.md$/i, kind: "article_summary" },
];

/** 从文件路径反推归属，总览与迁移脚本都用它，避免各处手写正则。 */
export function parseCardPath(path: string): CardLocation | null {
  const parts = path.split("/");
  if (parts[0] !== DOMAINS_DIR || parts.length < 2) return null;
  const domain = parts[1] ?? "";
  if (domain.length === 0) return null;

  // 新布局：领域/<领域>/文献/<citekey>/<文件>
  if (parts.length === 5 && parts[2] === LITERATURE_DIR) {
    const citekey = parts[3] ?? "";
    const filename = parts[4] ?? "";
    const matched = FILE_KIND.find((item) => item.pattern.test(filename));
    return { domain, citekey, kind: matched?.kind ?? "unknown" };
  }

  // 旧布局（兼容）：领域/<领域>/文献/<citekey>/精读卡片/<文件>
  if (parts.length >= 6 && parts[2] === LITERATURE_DIR) {
    const citekey = parts[3] ?? "";
    const folder = parts[4] ?? "";
    return { domain, citekey, kind: FOLDER_KIND[folder] ?? "unknown" };
  }

  if (parts.length === 3) {
    return { domain, citekey: null, kind: "domain_summary" };
  }

  return { domain, citekey: null, kind: "unknown" };
}

export const STATUS_LABEL: Record<LiteratureStatus, string> = {
  to_read: "未开始",
  skimming: "略读中",
  reading: "精读中",
  deep_read: "已出卡片",
  done: "已读完",
  skipped: "已跳过",
};
