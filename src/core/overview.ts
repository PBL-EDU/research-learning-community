import type { LiteratureStatus } from "@rlc/contract";

/**
 * 总览数据层：领域 → 文献 → 精读卡片。
 *
 * 与 Obsidian API 解耦，View 只负责画。卡片按 (领域, citekey) 挂到文献下，
 * 挂不上的进 orphans —— 宁可显式暴露「孤儿卡片」，也不要静默丢掉。
 */

export interface CardSummary {
  path: string;
  kind: string;
  title: string;
  domain: string;
  citekey: string | null;
  updatedAt?: string;
  /** 发布回执：有 id 说明已经发布过。 */
  publishId?: string;
  publishUrl?: string;
}

export interface LiteratureSummary {
  domain: string;
  citekey: string;
  /** 文献文件夹名（可读标题，截断），文件路径都用它。 */
  folder: string;
  title: string;
  /** AI 翻译的中文标题，悬停时展示。 */
  titleZh?: string;
  authors: string[];
  year?: number;
  doi?: string;
  url?: string;
  /** 本地原文 PDF 路径；有值说明已下载。 */
  pdfPath?: string;
  status: LiteratureStatus;
  notePath: string;
  cardCount: number;
  updatedAt?: string;
}

export interface LiteratureNode extends LiteratureSummary {
  cards: CardSummary[];
}

export interface DomainNode {
  domain: string;
  literatures: LiteratureNode[];
  cardTotal: number;
  literatureTotal: number;
  lastUpdated?: string;
}

export interface Overview {
  cardTotal: number;
  literatureTotal: number;
  domainTotal: number;
  deepRead: number;
  practice: number;
  summary: number;
  domains: DomainNode[];
  orphans: CardSummary[];
  recent: CardSummary[];
}

export const RECENT_LIMIT = 6;

export function timeOf(iso: string | undefined): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function buildOverview(
  cards: CardSummary[],
  literatures: LiteratureSummary[],
  extraDomains: string[] = [],
): Overview {
  const domains = new Map<string, DomainNode>();

  for (const literature of literatures) {
    let node = domains.get(literature.domain);
    if (!node) {
      node = {
        domain: literature.domain,
        literatures: [],
        cardTotal: 0,
        literatureTotal: 0,
        lastUpdated: undefined,
      };
      domains.set(literature.domain, node);
    }
    node.literatures.push({ ...literature, cards: [] });
  }

  // 刚建好、还没有文献的领域也要出现在总览里，否则用户没法点它触发生成。
  for (const name of extraDomains) {
    const trimmed = name.trim();
    if (trimmed.length === 0 || domains.has(trimmed)) continue;
    domains.set(trimmed, {
      domain: trimmed,
      literatures: [],
      cardTotal: 0,
      literatureTotal: 0,
      lastUpdated: undefined,
    });
  }

  const orphans: CardSummary[] = [];
  let deepRead = 0;
  let practice = 0;
  let summary = 0;

  for (const card of cards) {
    switch (card.kind) {
      case "deep_read":
        deepRead += 1;
        break;
      case "practice":
        practice += 1;
        break;
      case "article_summary":
      case "domain_summary":
        summary += 1;
        break;
      default:
        break;
    }

    const node = domains.get(card.domain);
    if (!node || !card.citekey) {
      orphans.push(card);
      continue;
    }
    // 卡片的 citekey 字段存的是文献文件夹名（可读标题），按 folder 匹配。
    const literature = node.literatures.find((item) => item.folder === card.citekey);
    if (!literature) {
      orphans.push(card);
      continue;
    }
    literature.cards.push(card);
  }

  const domainList = [...domains.values()];

  for (const node of domainList) {
    for (const literature of node.literatures) {
      literature.cards.sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
      literature.cardCount = literature.cards.length;
      node.cardTotal += literature.cardCount;
      if (timeOf(literature.updatedAt) > timeOf(node.lastUpdated)) {
        node.lastUpdated = literature.updatedAt;
      }
      const newestCard = literature.cards[0]?.updatedAt;
      if (timeOf(newestCard) > timeOf(node.lastUpdated)) node.lastUpdated = newestCard;
    }
    node.literatureTotal = node.literatures.length;
    node.literatures.sort((a, b) => b.cardCount - a.cardCount || a.title.localeCompare(b.title, "zh-CN"));
  }

  domainList.sort((a, b) => {
    const byTime = timeOf(b.lastUpdated) - timeOf(a.lastUpdated);
    if (byTime !== 0) return byTime;
    return a.domain.localeCompare(b.domain, "zh-CN");
  });

  return {
    cardTotal: cards.length,
    literatureTotal: literatures.length,
    domainTotal: domainList.length,
    deepRead,
    practice,
    summary,
    domains: domainList,
    orphans,
    recent: [...cards].sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt)).slice(0, RECENT_LIMIT),
  };
}

export function formatDay(iso: string | undefined): string {
  if (!iso) return "";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}
